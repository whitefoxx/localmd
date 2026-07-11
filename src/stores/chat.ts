import { defineStore } from 'pinia'
import { ref, computed, reactive, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useReviewStore } from '@/stores/review'
import { usePlanStore } from '@/stores/plan'
import { buildSystemPrompt } from '@/agent/prompt'
import { runAnthropicTurn } from '@/agent/anthropic'
import { runOpenAITurn } from '@/agent/openai'
import { loadKbImage, toDataUrl, imageUrlForProvider } from '@/agent/vision'
import { extractMentions } from '@/lib/mentions'
import { trimAnthropicHistory, trimOpenAIHistory } from '@/lib/history'
import { loadSkill } from '@/lib/skills'
import { fileKind } from '@/lib/filetypes'
import * as fs from '@/lib/fs'
import * as idb from '@/lib/idb'
import type { AgentEvent } from '@/agent/types'
import type { BetaMessageParam, BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta'
import type OpenAI from 'openai'

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; name: string; detail: string }

/** A file the user attached to a message (pasted screenshot / upload). Already
 *  saved into the KB — `path` is its KB location. */
export interface Attachment {
  path: string
  image: boolean
}

export interface UiMessage {
  id: number
  role: 'user' | 'assistant'
  parts: MessagePart[]
  attachments?: Attachment[]
  error?: string
}

interface ChatSession {
  id: string
  kb: string
  title: string
  /** Primary profile id the histories were built with. */
  profileId: string
  provider: string
  uiMessages: UiMessage[]
  anthropicHistory: BetaMessageParam[]
  openaiHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  createdAt: number
  updatedAt: number
}

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
}

/** Text files this small are inlined into the message when @-mentioned;
 *  larger ones the agent reads via tools. */
const INLINE_MENTION_CHARS = 16_000

let nextId = 1

export const useChatStore = defineStore('chat', () => {
  const kb = useKbStore()

  const current = ref<ChatSession | null>(null)
  const sessions = ref<SessionSummary[]>([])
  const running = ref(false)
  const historyOpen = ref(false)

  let controller: AbortController | null = null

  const messages = computed<UiMessage[]>(() => current.value?.uiMessages ?? [])

  // Sessions are per-KB: reload the list (and drop the open one) on KB switch.
  watch(
    () => kb.name,
    async (name) => {
      stop()
      current.value = null
      historyOpen.value = false
      sessions.value = name ? summarize(await idb.listSessions(name)) : []
    },
    { immediate: true },
  )

  function summarize(list: idb.StoredSession[]): SessionSummary[] {
    return list.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt }))
  }

  function newSession(): void {
    stop()
    current.value = null
    historyOpen.value = false
    usePlanStore().clear()
  }

  async function openSession(id: string): Promise<void> {
    stop()
    const stored = await idb.getSession(id)
    if (!stored) return
    current.value = stored as unknown as ChatSession
    nextId = Math.max(0, ...current.value.uiMessages.map((m) => m.id)) + 1
    historyOpen.value = false
    usePlanStore().clear()
  }

  async function removeSession(id: string): Promise<void> {
    await idb.deleteSession(id)
    if (current.value?.id === id) current.value = null
    if (kb.name) sessions.value = summarize(await idb.listSessions(kb.name))
  }

  async function persist(): Promise<void> {
    const s = current.value
    if (!s || !s.uiMessages.length) return
    s.updatedAt = Date.now()
    // JSON round-trip strips Vue reactivity proxies before structured clone.
    await idb.saveSession(JSON.parse(JSON.stringify(s)) as idb.StoredSession)
    if (kb.name) sessions.value = summarize(await idb.listSessions(kb.name))
  }

  function stop(): void {
    controller?.abort()
    controller = null
    // Writes paused for approval must not dangle after the turn dies.
    useReviewStore().rejectAwaiting()
  }

  /** A leading /skill-name invocation forces that skill: the full SKILL.md
   *  is inlined so the model executes it without a use_skill round trip. */
  async function expandSlashSkill(trimmed: string): Promise<string> {
    const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(trimmed)
    if (!m) return trimmed
    const skill = await loadSkill(m[1])
    if (!skill) return trimmed // unknown /token — send as-is
    const resources = skill.resources.length
      ? `\nBundled resources (read with read_file when referenced): ${skill.resources.join(', ')}`
      : ''
    return (
      `Execute the "${skill.name}" skill now. Skill instructions:\n\n${skill.body}${resources}\n\n` +
      (m[2]?.trim() ? `User input for this run: ${m[2].trim()}` : 'No additional user input.')
    )
  }

  /** Model-facing message text: user text + notes about attachments and
   *  @-mentioned files (small text files inlined; documents pointed at their
   *  index workflow; images listed — they travel separately as image parts
   *  or through view_image). */
  async function buildModelText(
    trimmed: string,
    attachments: Attachment[],
    mentioned: string[],
    imagePaths: string[],
    imagesTravelInline: boolean,
    visionAvailable: boolean,
  ): Promise<string> {
    let out = trimmed
    const uploaded = attachments.filter((a) => !a.image).map((a) => a.path)
    if (uploaded.length) {
      out += `\n\n[用户随消息上传了文件(已保存到知识库): ${uploaded.join(', ')} — 用 read_file 查看内容]`
    }
    if (imagePaths.length) {
      if (imagesTravelInline) {
        out += `\n\n[消息附带图片(已保存到知识库): ${imagePaths.join(', ')}]`
      } else if (visionAvailable) {
        out += `\n\n[消息附带图片(已保存到知识库): ${imagePaths.join(', ')} — 用 view_image 工具查看内容]`
      } else {
        out += `\n\n[消息附带图片(已保存到知识库): ${imagePaths.join(', ')} — 当前未配置视觉模型,无法查看图片内容,如需可提示用户在设置里配置]`
      }
    }
    const textMentions = mentioned.filter((p) => !imagePaths.includes(p))
    if (textMentions.length) {
      const blocks: string[] = []
      for (const p of textMentions) {
        const kind = fileKind(p)
        if (kind === 'pdf' || kind === 'epub') {
          blocks.push(`@${p}: ${kind.toUpperCase()} 文档 — 通过 read_file 走结构化索引读取。`)
          continue
        }
        const content = await fs.tryReadFile(p)
        if (content === null) {
          blocks.push(`@${p}: (文件不存在)`)
        } else if (content.length <= INLINE_MENTION_CHARS) {
          blocks.push(`@${p} 的内容:\n\`\`\`\n${content}\n\`\`\``)
        } else {
          blocks.push(`@${p}: 文件较大(${content.length} 字符) — 用 read_file 读取。`)
        }
      }
      out += `\n\n<referenced_files>\n${blocks.join('\n\n')}\n</referenced_files>`
    }
    return out
  }

  async function send(text: string, attachments: Attachment[] = []): Promise<void> {
    const trimmed = text.trim()
    if ((!trimmed && !attachments.length) || running.value || !kb.name) return
    const settings = useSettingsStore()
    const files = useFilesStore()
    const primary = settings.primary
    if (!primary) return

    const providerKind = primary.provider === 'anthropic' ? 'anthropic' : 'openai'

    if (!current.value) {
      current.value = {
        id: crypto.randomUUID(),
        kb: kb.name,
        title: (trimmed || attachments[0]?.path || 'chat').slice(0, 40),
        profileId: primary.id,
        provider: providerKind,
        uiMessages: [],
        anthropicHistory: [],
        openaiHistory: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    }
    const session = current.value

    // Switching the primary profile mid-conversation would replay an
    // incompatible (or differently-priced) history — start the wire history
    // fresh; the UI transcript stays.
    if (session.profileId !== primary.id || session.provider !== providerKind) {
      session.profileId = primary.id
      session.provider = providerKind
      session.anthropicHistory = []
      session.openaiHistory = []
    }

    const mentioned = extractMentions(trimmed, files.allFiles)
    const imagePaths = [
      ...attachments.filter((a) => a.image).map((a) => a.path),
      ...mentioned.filter((p) => fileKind(p) === 'image' && !/\.svg$/i.test(p)),
    ].filter((p, i, arr) => arr.indexOf(p) === i)

    const inline = settings.visionInline
    const modelText = await buildModelText(
      await expandSlashSkill(trimmed),
      attachments,
      mentioned,
      imagePaths,
      inline,
      settings.visionAvailable,
    )

    session.uiMessages.push({
      id: nextId++,
      role: 'user',
      parts: [{ type: 'text', text: trimmed }],
      attachments: attachments.length ? [...attachments] : undefined,
    })
    // reactive() is load-bearing: onEvent mutates this object from outside the
    // store's proxy — a raw object would render nothing until the turn ends
    // (no streaming). Mutating through the proxy triggers per-delta updates.
    const assistant: UiMessage = reactive({ id: nextId++, role: 'assistant', parts: [] })
    session.uiMessages.push(assistant)
    void persist()

    const onEvent = (e: AgentEvent): void => {
      const parts = assistant.parts
      const last = parts[parts.length - 1]
      if (e.type === 'text') {
        if (last?.type === 'text') last.text += e.delta
        else parts.push({ type: 'text', text: e.delta })
      } else if (e.type === 'thinking') {
        if (last?.type === 'thinking') last.text += e.delta
        else parts.push({ type: 'thinking', text: e.delta })
      } else {
        parts.push({ type: 'tool', name: e.name, detail: e.detail })
      }
    }

    running.value = true
    controller = new AbortController()
    try {
      const system = await buildSystemPrompt()
      // Inline images: load bytes fresh from the KB at send time.
      const inlineImages = inline
        ? (await Promise.all(imagePaths.map((p) => loadKbImage(p)))).filter(
            (i): i is NonNullable<typeof i> => i !== null,
          )
        : []

      if (providerKind === 'anthropic') {
        // Old turns' large tool results/images become stubs before replay.
        session.anthropicHistory = trimAnthropicHistory(session.anthropicHistory)
        const content: BetaContentBlockParam[] = [{ type: 'text', text: modelText }]
        for (const img of inlineImages) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mediaType as 'image/png',
              data: img.base64,
            },
          })
        }
        session.anthropicHistory = await runAnthropicTurn({
          apiKey: primary.apiKey,
          model: primary.model,
          maxTokens: primary.maxTokens,
          system,
          messages: [
            ...session.anthropicHistory,
            { role: 'user', content: inlineImages.length ? content : modelText },
          ],
          onEvent,
          signal: controller.signal,
          allowSubagent: true,
        })
      } else {
        session.openaiHistory = trimOpenAIHistory(session.openaiHistory)
        const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
          { type: 'text', text: modelText },
        ]
        for (const img of inlineImages) {
          content.push({
            type: 'image_url',
            image_url: { url: imageUrlForProvider(primary, toDataUrl(img)) },
          })
        }
        session.openaiHistory = await runOpenAITurn({
          profile: primary,
          system,
          messages: [
            ...session.openaiHistory,
            { role: 'user', content: inlineImages.length ? content : modelText },
          ],
          vision: settings.vision
            ? { profile: settings.vision, inline }
            : inline
              ? { profile: primary, inline }
              : undefined,
          onEvent,
          signal: controller.signal,
          allowSubagent: true,
        })
      }
    } catch (err) {
      const name = (err as Error).name
      const msg = (err as Error).message
      if (name === 'AbortError' || name === 'APIUserAbortError') {
        assistant.error = 'Stopped.'
      } else if (name === 'APIConnectionError' || /connection error/i.test(msg)) {
        assistant.error =
          'Connection error — the endpoint could not be reached from the browser. ' +
          'This usually means the Base URL does not allow browser (CORS) access, or the network blocks it. ' +
          'Open Settings and pick a preset endpoint — those are verified to work in browsers.'
      } else {
        assistant.error = msg
      }
    } finally {
      running.value = false
      controller = null
      void persist()
    }
  }

  return {
    messages,
    sessions,
    running,
    historyOpen,
    currentSessionId: computed(() => current.value?.id ?? null),
    send,
    stop,
    newSession,
    openSession,
    removeSession,
  }
})
