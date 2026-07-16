import { defineStore } from 'pinia'
import { ref, computed, reactive, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useReviewStore } from '@/stores/review'
import { usePlanStore } from '@/stores/plan'
import { useMcpStore } from '@/stores/mcp'
import { useGitStore } from '@/stores/git'
import * as g from '@/lib/git'
import { withGitLock, GitBusyError } from '@/lib/gitlock'
import { buildSystemPrompt } from '@/agent/prompt'
import { runTurn } from '@/agent/run'
import { runMockTurn } from '@/agent/mock'
import { loadKbImage, toDataUrl } from '@/agent/vision'
import { extractMentions } from '@/lib/mentions'
import {
  trimHistory,
  estimateChars,
  COMPACT_AT_CHARS,
  splitForCompaction,
  renderTranscript,
  compactedPrefix,
} from '@/lib/history'
import { summarize as summarizeHistory, generateTitle } from '@/agent/summarize'
import { loadSkill } from '@/lib/skills'
import { pdfPage } from '@/lib/viewMemory'
import { fileKind } from '@/lib/filetypes'
import * as fs from '@/lib/fs'
import * as idb from '@/lib/idb'
import type { AgentEvent } from '@/agent/types'
import type { ModelMessage } from 'ai'

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  /** `status`/`startedAt`/`elapsedMs` are set only for id-bearing tool calls
   *  (external MCP tools) so the UI can show a loading spinner + timer;
   *  instant built-in tools stay status-less and render as a plain line. */
  | {
      type: 'tool'
      name: string
      detail: string
      id?: number
      status?: 'running' | 'done' | 'error'
      startedAt?: number
      elapsedMs?: number
      /** Raw call arguments, kept for MCP tools so the UI can expand the full
       *  params (describeCall truncates them to a one-line summary). */
      args?: Record<string, unknown>
    }
  /** A created artifact (interactive HTML) — a clickable card that opens the
   *  file at `path`. `pending` = still being generated (loading card). */
  | { type: 'artifact'; title: string; path: string; pending?: boolean }

/** A file the user attached to a message (pasted screenshot / upload). Already
 *  saved into the KB — `path` is its KB location. */
export interface Attachment {
  path: string
  image: boolean
}

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
}

export interface UiMessage {
  id: number
  role: 'user' | 'assistant'
  parts: MessagePart[]
  attachments?: Attachment[]
  usage?: TokenUsage
  error?: string
}

interface ChatSession {
  id: string
  kb: string
  title: string
  /** Primary profile id the history was built with. */
  profileId: string
  /** 'mock' for the E2E provider, 'sdk' for every real provider. */
  provider: string
  uiMessages: UiMessage[]
  /** Unified AI SDK wire history (all providers share one shape). Opaque to the
   *  store — passed to runTurn/runMockTurn and stored verbatim. Typed loosely so
   *  Vue's reactive unwrap doesn't recurse the deep ModelMessage union (TS2589);
   *  cast to ModelMessage[] at the boundaries. */
  history: unknown[]
  createdAt: number
  updatedAt: number
}

/** An open chat tab: a session plus its runtime `running` flag. Multiple tabs
 *  run concurrently; `running` is not persisted. */
interface OpenSession extends ChatSession {
  running: boolean
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

  /** Max concurrent chat tabs. Creating/opening past this recycles the oldest
   *  idle tab; if every tab is running, the action is refused (with a flash). */
  const MAX_TABS = 6

  // Open chat tabs run concurrently. Each carries its own `running` flag; the
  // per-session AbortController lives in a non-reactive map. Switching the
  // active tab never touches another tab's in-flight turn.
  const tabs = ref<OpenSession[]>([])
  const activeId = ref<string | null>(null)
  const sessions = ref<SessionSummary[]>([])
  const historyOpen = ref(false)
  const limitMsg = ref('')

  const controllers = new Map<string, AbortController>()

  const active = computed(() => tabs.value.find((t) => t.id === activeId.value) ?? null)
  const messages = computed<UiMessage[]>(() => active.value?.uiMessages ?? [])
  const running = computed(() => active.value?.running ?? false)

  // Sessions are per-KB: on KB switch, reload the list and auto-open the most
  // recent session (if any) so the user resumes where they left off.
  watch(
    () => kb.name,
    async (name) => {
      stopAll()
      tabs.value = []
      activeId.value = null
      historyOpen.value = false
      // Per-session subsystem state belongs to the old KB's sessions.
      usePlanStore().reset()
      useMcpStore().clearActivated()
      if (!name) {
        sessions.value = []
        return
      }
      const stored = await idb.listSessions(name) // sorted newest-first
      if (kb.name !== name) return // KB switched again while we awaited
      sessions.value = summarize(stored)
      if (stored.length) adoptSession(stored[0])
    },
    { immediate: true },
  )

  function summarize(list: idb.StoredSession[]): SessionSummary[] {
    return list.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt }))
  }

  function makeEmptySession(): OpenSession {
    return reactive({
      id: crypto.randomUUID(),
      kb: kb.name ?? '',
      title: 'New chat',
      profileId: '',
      provider: '',
      uiMessages: [],
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      running: false,
    }) as OpenSession
  }

  /** Add a tab, honoring MAX_TABS by recycling the oldest idle tab. Returns
   *  false (and flashes a message) when every existing tab is busy. */
  function addTab(s: OpenSession): boolean {
    if (tabs.value.length >= MAX_TABS) {
      const victim = tabs.value.find((t) => !t.running)
      if (!victim) {
        limitMsg.value = `最多同时打开 ${MAX_TABS} 个会话`
        window.setTimeout(() => (limitMsg.value = ''), 3000)
        return false
      }
      closeTab(victim.id)
    }
    tabs.value.push(s)
    return true
  }

  function activateTab(id: string): void {
    if (tabs.value.some((t) => t.id === id)) activeId.value = id
    historyOpen.value = false
  }

  function closeTab(id: string): void {
    controllers.get(id)?.abort()
    controllers.delete(id)
    // Release the session's per-subsystem state (paused approvals, plan,
    // deferred-tool activations, turn-write collection).
    useReviewStore().rejectAwaiting(id)
    useReviewStore().clearTurn(id)
    usePlanStore().clear(id)
    useMcpStore().clearActivated(id)
    const i = tabs.value.findIndex((t) => t.id === id)
    if (i < 0) return
    tabs.value.splice(i, 1)
    if (activeId.value === id) {
      activeId.value = tabs.value[Math.min(i, tabs.value.length - 1)]?.id ?? null
    }
  }

  function newSession(): void {
    // Reuse an existing empty draft tab rather than piling up blank tabs.
    const empty = tabs.value.find((t) => !t.uiMessages.length && !t.running)
    if (empty) activeId.value = empty.id
    else {
      const s = makeEmptySession()
      if (!addTab(s)) return
      activeId.value = s.id
    }
    historyOpen.value = false
    // plan/mcp state is keyed per session — a fresh session starts empty.
  }

  /** Open a stored session as a tab (deduped: focus it if already open). */
  function adoptSession(stored: idb.StoredSession): void {
    const existing = tabs.value.find((t) => t.id === stored.id)
    if (existing) {
      activeId.value = existing.id
      historyOpen.value = false
      return
    }
    const s = reactive({ ...(stored as unknown as ChatSession), running: false }) as OpenSession
    // Legacy sessions persisted before the unified SDK history have no `history`
    // field (they carried separate anthropic/openai wire histories). Start their
    // wire history fresh — the UI transcript is intact; only cross-turn model
    // context for that old conversation is lost, and rebuilds on the next send.
    if (!Array.isArray(s.history)) s.history = []
    // A session persisted mid-stream (reload during a turn) can carry unsettled
    // parts: stop forever-spinning tool calls and drop never-written artifacts.
    for (const m of s.uiMessages) {
      for (const p of m.parts) if (p.type === 'tool' && p.status === 'running') p.status = 'error'
      m.parts = m.parts.filter((p) => !(p.type === 'artifact' && p.pending))
    }
    if (!addTab(s)) return
    const maxId = s.uiMessages.reduce((a, m) => Math.max(a, m.id), 0)
    nextId = Math.max(nextId, maxId + 1)
    activeId.value = s.id
    historyOpen.value = false
  }

  async function openSession(id: string): Promise<void> {
    const existing = tabs.value.find((t) => t.id === id)
    if (existing) {
      activeId.value = existing.id
      historyOpen.value = false
      return
    }
    const stored = await idb.getSession(id)
    if (!stored) return
    adoptSession(stored)
  }

  async function removeSession(id: string): Promise<void> {
    closeTab(id)
    await idb.deleteSession(id)
    if (kb.name) sessions.value = summarize(await idb.listSessions(kb.name))
  }

  async function persist(session: OpenSession): Promise<void> {
    if (!session.uiMessages.length) return
    session.updatedAt = Date.now()
    // JSON round-trip strips Vue reactivity proxies before structured clone.
    const snapshot = JSON.parse(JSON.stringify(session)) as idb.StoredSession & { running?: boolean }
    delete snapshot.running
    await idb.saveSession(snapshot)
    if (kb.name) sessions.value = summarize(await idb.listSessions(kb.name))
  }

  /** Stop a single session's turn (the active one by default). Only that
   *  session's paused approvals are rejected — others keep waiting. */
  function stop(id: string | null = activeId.value): void {
    if (!id) return
    controllers.get(id)?.abort()
    controllers.delete(id)
    const t = tabs.value.find((x) => x.id === id)
    if (t) t.running = false
    // Writes paused for approval must not dangle after the turn dies.
    useReviewStore().rejectAwaiting(id)
  }

  function stopAll(): void {
    for (const c of controllers.values()) c.abort()
    controllers.clear()
    for (const t of tabs.value) t.running = false
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
    // What the user is looking at right now — lets "总结这个文件" work
    // without an explicit @-mention.
    const files = useFilesStore()
    const viewing = files.currentPath
    if (viewing) {
      const page = fileKind(viewing) === 'pdf' ? pdfPage.get(viewing) : undefined
      out += `\n\n[用户当前正在查看: ${viewing}${page ? ` (第 ${page} 页)` : ''}]`
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
    if ((!trimmed && !attachments.length) || !kb.name) return
    const settings = useSettingsStore()
    const files = useFilesStore()
    const primary = settings.primary
    if (!primary) return

    // Every real provider runs through the one AI SDK loop; only the E2E mock
    // takes a separate path.
    const providerKind = primary.provider === 'mock' ? 'mock' : 'sdk'

    // Send goes to the active tab (creating one if none). Other tabs may be
    // mid-turn; only THIS tab being busy blocks a new send.
    let session = active.value
    if (!session) {
      session = makeEmptySession()
      if (!addTab(session)) return
      activeId.value = session.id
    }
    if (session.running) return

    if (!session.uiMessages.length) {
      session.title = (trimmed || attachments[0]?.path || 'chat').slice(0, 40)
    }

    // Switching the primary profile mid-conversation would replay an
    // incompatible (or differently-priced) history — start the wire history
    // fresh; the UI transcript stays. (Also fills profile on a fresh session.)
    if (session.profileId !== primary.id || session.provider !== providerKind) {
      session.profileId = primary.id
      session.provider = providerKind
      session.history = []
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
    void persist(session)
    // Throttle streaming persistence so a reload mid-turn keeps the partial
    // reply (the turn-end persist never runs if the tab is closed first).
    let lastStreamPersist = Date.now()

    const onEvent = (e: AgentEvent): void => {
      const parts = assistant.parts
      const last = parts[parts.length - 1]
      if (e.type === 'text') {
        if (last?.type === 'text') last.text += e.delta
        else parts.push({ type: 'text', text: e.delta })
      } else if (e.type === 'thinking') {
        if (last?.type === 'thinking') last.text += e.delta
        else parts.push({ type: 'thinking', text: e.delta })
      } else if (e.type === 'usage') {
        const u = (assistant.usage ??= { input: 0, output: 0, cacheRead: 0 })
        u.input += e.input
        u.output += e.output
        u.cacheRead += e.cacheRead
      } else if (e.type === 'tool_result') {
        const p = parts.find((x): x is Extract<MessagePart, { type: 'tool' }> =>
          x.type === 'tool' && x.id === e.id,
        )
        if (p) {
          p.status = e.ok ? 'done' : 'error'
          p.elapsedMs = Date.now() - (p.startedAt ?? Date.now())
        }
      } else if (e.type === 'artifact') {
        if (e.pending) {
          parts.push({ type: 'artifact', title: '', path: '', pending: true })
        } else {
          // Fill in the pending card from this turn, if any; else add one.
          const p = [...parts].reverse().find((x) => x.type === 'artifact' && x.pending)
          if (p && p.type === 'artifact') {
            p.title = e.title
            p.path = e.path
            p.pending = false
          } else {
            parts.push({ type: 'artifact', title: e.title, path: e.path })
          }
        }
      } else {
        // Only id-bearing tool calls get the loading/timer treatment.
        parts.push(
          e.id != null
            ? { type: 'tool', name: e.name, detail: e.detail, id: e.id, args: e.args, status: 'running', startedAt: Date.now() }
            : { type: 'tool', name: e.name, detail: e.detail, args: e.args },
        )
      }
      const t = Date.now()
      if (t - lastStreamPersist > 1000) {
        lastStreamPersist = t
        void persist(session)
      }
    }

    session.running = true
    const controller = new AbortController()
    controllers.set(session.id, controller)
    useReviewStore().beginTurn(session.id) // collect this turn's writes for checkpointing
    try {
      const system = await buildSystemPrompt(session.id)
      // Inline images: load bytes fresh from the KB at send time.
      const inlineImages = inline
        ? (await Promise.all(imagePaths.map((p) => loadKbImage(p)))).filter(
            (i): i is NonNullable<typeof i> => i !== null,
          )
        : []

      if (providerKind === 'mock') {
        // E2E test provider: deterministic scripted turns, no network.
        const hist: ModelMessage[] = [
          ...(session.history as ModelMessage[]),
          { role: 'user', content: modelText },
        ]
        session.history = hist
        session.history = await runMockTurn({
          system,
          messages: [...hist],
          sessionId: session.id,
          onEvent,
          signal: controller.signal,
        })
      } else {
        // Old turns' large tool results/images become stubs before replay.
        let hist = trimHistory(session.history as ModelMessage[])
        // Still huge after trimming → replace the old prefix with a summary.
        if (estimateChars(hist) > COMPACT_AT_CHARS) {
          const split = splitForCompaction(hist)
          if (split) {
            onEvent({ type: 'tool', name: 'compact', detail: '历史过长,压缩上下文…' })
            try {
              const summary = await summarizeHistory(
                primary,
                renderTranscript(split.old),
                controller.signal,
              )
              const prefix = compactedPrefix(summary)
              hist = [
                { role: 'user', content: prefix.user },
                { role: 'assistant', content: prefix.assistant },
                ...split.recent,
              ]
            } catch {
              /* summarizer failed — carry on with the full history */
            }
          }
        }
        // A multimodal primary gets images inline in the user message; the AI
        // SDK formats them per provider (Anthropic blocks, OpenAI/Google parts).
        const content = inlineImages.length
          ? [
              { type: 'text' as const, text: modelText },
              ...inlineImages.map((img) => ({
                type: 'image' as const,
                image: toDataUrl(img),
                mediaType: img.mediaType,
              })),
            ]
          : modelText
        // Commit the user turn to the wire history BEFORE running, so an
        // interrupted turn (reload mid-stream) still replays it next time. Pass
        // a COPY to runTurn so the committed history stays clean on abort (just
        // the user message, no dangling tool calls).
        hist = [...hist, { role: 'user', content }]
        session.history = hist
        void persist(session)
        session.history = await runTurn({
          profile: primary,
          system,
          messages: [...hist],
          vision: settings.vision
            ? { profile: settings.vision, inline }
            : inline
              ? { profile: primary, inline }
              : undefined,
          sessionId: session.id,
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
      session.running = false
      controllers.delete(session.id)
      // A tool still "running" means the turn died mid-call (abort/error) before
      // its tool_result — settle it so the spinner doesn't spin forever.
      for (const p of assistant.parts) {
        if (p.type === 'tool' && p.status === 'running') {
          p.status = assistant.error ? 'error' : 'done'
          p.elapsedMs = Date.now() - (p.startedAt ?? Date.now())
        }
      }
      // A still-pending artifact means the turn died before the file was
      // written — drop the loading card so it doesn't spin forever.
      assistant.parts = assistant.parts.filter((p) => !(p.type === 'artifact' && p.pending))
      void persist(session)
      void checkpoint(session, trimmed, assistant)
      void autoTitle(session, trimmed, assistant)
    }
  }

  /** After the FIRST exchange, replace the sliced-text title with a short
   *  model-generated one (fire-and-forget; failures keep the fallback). */
  async function autoTitle(
    session: OpenSession,
    userText: string,
    assistant: UiMessage,
  ): Promise<void> {
    if (session.uiMessages.length > 2) return // only the first turn
    const settings = useSettingsStore()
    if (!settings.primary) return
    const reply = assistant.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join(' ')
    if (!reply) return
    const title = await generateTitle(settings.primary, userText, reply)
    if (title) {
      session.title = title
      void persist(session)
    }
  }

  /** Auto-commit this turn's agent writes as a revertable checkpoint. The whole
   *  read-status→commit sequence runs under the git lock so concurrent sessions
   *  checkpoint strictly one after another; a contended session says so in its
   *  transcript, and gives up (keeping its changes) if the wait drags on. */
  async function checkpoint(
    session: OpenSession,
    userText: string,
    assistant: UiMessage,
  ): Promise<void> {
    const settings = useSettingsStore()
    if (settings.state.checkpointMode !== 'auto') return
    const written = useReviewStore().turnWritesFor(session.id)
    if (!written.length) return
    try {
      const committed = await withGitLock(
        async () => {
          if (!(await g.isRepo())) return null
          const changes = (await g.changedFiles()).filter(
            (c) => written.includes(c.path) && !c.oversized,
          )
          if (!changes.length) return null
          const author = await g.resolveAuthor({
            name: settings.state.gitName || 'browser-md',
            email: settings.state.gitEmail || 'browser-md@local',
          })
          const summary = userText.replace(/\s+/g, ' ').slice(0, 50) || 'agent edits'
          const oid = await g.commitPaths(changes, `checkpoint: ${summary}`, author)
          return { oid, count: changes.length }
        },
        {
          timeoutMs: 30_000,
          onWait: () =>
            assistant.parts.push({
              type: 'tool',
              name: 'checkpoint',
              detail: '等待另一个会话的 git 操作完成…',
            }),
        },
      )
      if (!committed) return
      assistant.parts.push({
        type: 'tool',
        name: 'checkpoint',
        detail: `checkpoint ${committed.oid.slice(0, 7)} (${committed.count} file(s))`,
      })
      void useGitStore().refresh()
      void persist(session) // the checkpoint line must survive a reload
    } catch (err) {
      if (err instanceof GitBusyError) {
        assistant.parts.push({
          type: 'tool',
          name: 'checkpoint',
          detail: '跳过 checkpoint:另一会话的 git 操作耗时过久——本回合改动仍在工作区,稍后可在 Git 面板手动提交',
        })
        void persist(session)
      }
      /* other checkpoint failures must never break the turn */
    }
  }

  /** Session-wide token totals (sum of every assistant message's usage). */
  const sessionUsage = computed<TokenUsage>(() => {
    const total = { input: 0, output: 0, cacheRead: 0 }
    for (const m of messages.value) {
      if (!m.usage) continue
      total.input += m.usage.input
      total.output += m.usage.output
      total.cacheRead += m.usage.cacheRead
    }
    return total
  })

  return {
    messages,
    tabs,
    sessions,
    running,
    historyOpen,
    limitMsg,
    sessionUsage,
    currentSessionId: computed(() => active.value?.id ?? null),
    send,
    stop,
    newSession,
    openSession,
    removeSession,
    activateTab,
    closeTab,
  }
})
