/**
 * Anthropic provider: the SDK's beta tool runner drives the tool-use loop.
 * Runs fully in the browser — dangerouslyAllowBrowser makes the SDK send the
 * anthropic-dangerous-direct-browser-access CORS header automatically.
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta'
import { TOOLS } from './tools'
import type { AgentEventHandler } from './types'

export interface AnthropicTurnOptions {
  apiKey: string
  model: string
  system: string
  /** Full conversation history including the newest user message. */
  messages: BetaMessageParam[]
  onEvent: AgentEventHandler
  signal: AbortSignal
}

/** Runs one agent turn; returns the updated conversation history. */
export async function runAnthropicTurn(opts: AnthropicTurnOptions): Promise<BetaMessageParam[]> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    dangerouslyAllowBrowser: true,
  })

  const tools = TOOLS.map((t) =>
    betaZodTool({
      name: t.name,
      description: t.description,
      inputSchema: t.schema,
      run: async (args) => {
        opts.onEvent({ type: 'tool', name: t.name, detail: t.describeCall(args) })
        try {
          return await t.run(args)
        } catch (err) {
          return `Error: ${(err as Error).message}`
        }
      },
    }),
  )

  const runner = client.beta.messages.toolRunner(
    {
      model: opts.model,
      max_tokens: 8192,
      system: opts.system,
      messages: opts.messages,
      tools,
      stream: true,
      max_iterations: 25,
    },
    { signal: opts.signal },
  )

  for await (const stream of runner) {
    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue
      if (event.delta.type === 'text_delta') {
        opts.onEvent({ type: 'text', delta: event.delta.text })
      } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
        opts.onEvent({ type: 'thinking', delta: event.delta.thinking })
      }
    }
  }

  const final = await runner.done()
  const history = [...runner.params.messages]
  if (history[history.length - 1]?.role !== 'assistant') {
    history.push({ role: 'assistant', content: final.content })
  }
  return history
}
