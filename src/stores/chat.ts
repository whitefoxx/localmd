import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { buildSystemPrompt } from '@/agent/prompt'
import { runAnthropicTurn } from '@/agent/anthropic'
import { runOpenAITurn } from '@/agent/openai'
import type { AgentEvent } from '@/agent/types'
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta'
import type OpenAI from 'openai'

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail: string }

export interface UiMessage {
  id: number
  role: 'user' | 'assistant'
  parts: MessagePart[]
  error?: string
}

let nextId = 1

export const useChatStore = defineStore('chat', () => {
  const messages = ref<UiMessage[]>([])
  const running = ref(false)

  /** Provider-native history, opaque to the UI. Reset on clear/provider switch. */
  let anthropicHistory: BetaMessageParam[] = []
  let openaiHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
  let historyProvider: string | null = null
  let controller: AbortController | null = null

  function clear(): void {
    stop()
    messages.value = []
    anthropicHistory = []
    openaiHistory = []
  }

  function stop(): void {
    controller?.abort()
    controller = null
  }

  async function send(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || running.value) return
    const { settings } = useSettingsStore()

    // Switching provider mid-conversation would replay an incompatible history.
    if (historyProvider && historyProvider !== settings.provider) {
      anthropicHistory = []
      openaiHistory = []
    }
    historyProvider = settings.provider

    messages.value.push({ id: nextId++, role: 'user', parts: [{ type: 'text', text: trimmed }] })
    const assistant: UiMessage = { id: nextId++, role: 'assistant', parts: [] }
    messages.value.push(assistant)

    const onEvent = (e: AgentEvent): void => {
      const parts = assistant.parts
      if (e.type === 'text') {
        const last = parts[parts.length - 1]
        if (last?.type === 'text') last.text += e.delta
        else parts.push({ type: 'text', text: e.delta })
      } else {
        parts.push({ type: 'tool', name: e.name, detail: e.detail })
      }
    }

    running.value = true
    controller = new AbortController()
    try {
      const system = await buildSystemPrompt()
      if (settings.provider === 'anthropic') {
        anthropicHistory = await runAnthropicTurn({
          apiKey: settings.anthropicApiKey,
          model: settings.anthropicModel,
          system,
          messages: [...anthropicHistory, { role: 'user', content: trimmed }],
          onEvent,
          signal: controller.signal,
        })
      } else {
        openaiHistory = await runOpenAITurn({
          apiKey: settings.openaiApiKey,
          baseURL: settings.openaiBaseUrl,
          model: settings.openaiModel,
          system,
          messages: [...openaiHistory, { role: 'user', content: trimmed }],
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
    }
  }

  return { messages, running, send, stop, clear }
})
