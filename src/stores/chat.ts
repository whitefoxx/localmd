import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useKbStore } from '@/stores/kb'
import { buildSystemPrompt } from '@/agent/prompt'
import { runAnthropicTurn } from '@/agent/anthropic'
import { runOpenAITurn } from '@/agent/openai'
import * as idb from '@/lib/idb'
import type { AgentEvent } from '@/agent/types'
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta'
import type OpenAI from 'openai'

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; name: string; detail: string }

export interface UiMessage {
  id: number
  role: 'user' | 'assistant'
  parts: MessagePart[]
  error?: string
}

interface ChatSession {
  id: string
  kb: string
  title: string
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
  }

  async function openSession(id: string): Promise<void> {
    stop()
    const stored = await idb.getSession(id)
    if (!stored) return
    current.value = stored as unknown as ChatSession
    nextId = Math.max(0, ...current.value.uiMessages.map((m) => m.id)) + 1
    historyOpen.value = false
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
  }

  async function send(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || running.value || !kb.name) return
    const { settings } = useSettingsStore()

    if (!current.value) {
      current.value = {
        id: crypto.randomUUID(),
        kb: kb.name,
        title: trimmed.slice(0, 40),
        provider: settings.provider,
        uiMessages: [],
        anthropicHistory: [],
        openaiHistory: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    }
    const session = current.value

    // Switching provider mid-conversation would replay an incompatible history.
    if (session.provider !== settings.provider) {
      session.provider = settings.provider
      session.anthropicHistory = []
      session.openaiHistory = []
    }

    session.uiMessages.push({
      id: nextId++,
      role: 'user',
      parts: [{ type: 'text', text: trimmed }],
    })
    const assistant: UiMessage = { id: nextId++, role: 'assistant', parts: [] }
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
      if (settings.provider === 'anthropic') {
        session.anthropicHistory = await runAnthropicTurn({
          apiKey: settings.anthropicApiKey,
          model: settings.anthropicModel,
          system,
          messages: [...session.anthropicHistory, { role: 'user', content: trimmed }],
          onEvent,
          signal: controller.signal,
        })
      } else {
        session.openaiHistory = await runOpenAITurn({
          apiKey: settings.openaiApiKey,
          baseURL: settings.openaiBaseUrl,
          model: settings.openaiModel,
          system,
          messages: [...session.openaiHistory, { role: 'user', content: trimmed }],
          onEvent,
          signal: controller.signal,
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
