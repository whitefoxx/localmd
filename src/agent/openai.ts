/**
 * OpenAI-compatible provider: a thin manual tool-use loop over the Chat
 * Completions API. Chat Completions (not Responses) is deliberate — it's the
 * lingua franca implemented by OpenAI-compatible endpoints (DeepSeek, Moonshot,
 * Qwen, Ollama, …), so one loop covers them all via a custom baseURL.
 */
import OpenAI from 'openai'
import { z } from 'zod'
import { TOOLS } from './tools'
import type { AgentEventHandler } from './types'

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

export interface OpenAITurnOptions {
  apiKey: string
  baseURL: string
  model: string
  system: string
  /** Conversation history including the newest user message (no system msg). */
  messages: ChatMessage[]
  onEvent: AgentEventHandler
  signal: AbortSignal
}

const MAX_ITERATIONS = 25

/** Runs one agent turn; returns the updated conversation history. */
export async function runOpenAITurn(opts: OpenAITurnOptions): Promise<ChatMessage[]> {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL || undefined,
    dangerouslyAllowBrowser: true,
  })

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOLS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: z.toJSONSchema(t.schema) as Record<string, unknown>,
    },
  }))

  const history: ChatMessage[] = [...opts.messages]

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = await client.chat.completions.create(
      {
        model: opts.model,
        messages: [{ role: 'system', content: opts.system }, ...history],
        tools,
        stream: true,
      },
      { signal: opts.signal },
    )

    let text = ''
    const calls: { id: string; name: string; args: string }[] = []

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (!delta) continue
      if (delta.content) {
        text += delta.content
        opts.onEvent({ type: 'text', delta: delta.content })
      }
      for (const tc of delta.tool_calls ?? []) {
        const slot = (calls[tc.index] ??= { id: '', name: '', args: '' })
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name = tc.function.name
        if (tc.function?.arguments) slot.args += tc.function.arguments
      }
    }

    if (!calls.length) {
      history.push({ role: 'assistant', content: text })
      return history
    }

    history.push({
      role: 'assistant',
      content: text || null,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.args },
      })),
    })

    for (const call of calls) {
      const spec = TOOLS.find((t) => t.name === call.name)
      let result: string
      if (!spec) {
        result = `Error: unknown tool ${call.name}`
      } else {
        try {
          const args = JSON.parse(call.args || '{}')
          opts.onEvent({ type: 'tool', name: call.name, detail: spec.describeCall(args) })
          result = await spec.run(args)
        } catch (err) {
          result = `Error: ${(err as Error).message}`
        }
      }
      history.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }

  history.push({ role: 'assistant', content: '[Stopped: too many tool iterations]' })
  return history
}
