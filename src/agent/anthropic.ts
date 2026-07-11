/**
 * Anthropic provider: the SDK's beta tool runner drives the tool-use loop.
 * Runs fully in the browser — dangerouslyAllowBrowser makes the SDK send the
 * anthropic-dangerous-direct-browser-access CORS header automatically.
 *
 * Claude models are multimodal: user-attached images arrive as image blocks
 * in `messages`, and a view_image tool lets the agent open any KB image
 * itself (tool results carry image blocks natively).
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type {
  BetaMessageParam,
  BetaToolResultContentBlockParam,
} from '@anthropic-ai/sdk/resources/beta'
import { TOOLS } from './tools'
import { loadKbImage } from './vision'
import type { AgentEventHandler } from './types'

export interface AnthropicTurnOptions {
  apiKey: string
  model: string
  maxTokens?: number
  system: string
  /** Full conversation history including the newest user message. */
  messages: BetaMessageParam[]
  onEvent: AgentEventHandler
  signal: AbortSignal
  /** Offer the run_subagent tool (disabled inside subagents — depth 1 only). */
  allowSubagent?: boolean
}

const SUBAGENT_SYSTEM_SUFFIX = `

You are running as a SUBAGENT on one scoped task. Work autonomously with the tools; do not ask the user questions. Your final message is returned verbatim to the main agent as a tool result — make it a complete, self-contained answer. You cannot spawn further subagents.`

const viewImageSchema = z.object({
  paths: z.array(z.string()).describe('KB-relative image paths, e.g. ["raw/images/chart.png"]'),
})

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

  tools.push(
    betaZodTool({
      name: 'view_image',
      description:
        'Look at image files from the knowledge base (screenshots, figures, photos). Pass KB-relative paths; the images are returned to you visually. Only call this when you actually need to see image content.',
      inputSchema: viewImageSchema,
      run: async ({ paths }): Promise<string | BetaToolResultContentBlockParam[]> => {
        opts.onEvent({ type: 'tool', name: 'view_image', detail: `view ${paths.join(', ')}` })
        const blocks: BetaToolResultContentBlockParam[] = []
        const missing: string[] = []
        for (const p of paths.slice(0, 5)) {
          const img = await loadKbImage(p)
          if (!img) {
            missing.push(p)
            continue
          }
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mediaType as 'image/png',
              data: img.base64,
            },
          })
        }
        if (!blocks.length) {
          return `Error: no readable images (not found or unsupported format): ${missing.join(', ')}`
        }
        if (missing.length) {
          blocks.push({ type: 'text', text: `(unreadable, skipped: ${missing.join(', ')})` })
        }
        return blocks
      },
    }),
  )

  if (opts.allowSubagent) {
    tools.push(
      betaZodTool({
        name: 'run_subagent',
        description:
          'Delegate a scoped, self-contained subtask to a subagent with its own fresh context and the same KB tools (it cannot spawn subagents). Use it for work that would flood your context — e.g. surveying many files, summarizing a long document, or an independent research question. Give it the full task description and any context it needs; you receive only its final answer.',
        inputSchema: z.object({
          task: z.string().describe('Complete, self-contained task description for the subagent'),
        }),
        run: async ({ task }) => {
          opts.onEvent({ type: 'tool', name: 'run_subagent', detail: `subagent: ${task.slice(0, 80)}` })
          try {
            const history = await runAnthropicTurn({
              ...opts,
              system: opts.system + SUBAGENT_SYSTEM_SUFFIX,
              messages: [{ role: 'user', content: task }],
              allowSubagent: false,
              onEvent: (e) => {
                // Surface tool activity (indented) and usage; the subagent's
                // text comes back as this tool's result.
                if (e.type === 'tool') {
                  opts.onEvent({ type: 'tool', name: e.name, detail: `  ↳ ${e.detail}` })
                } else if (e.type === 'usage') {
                  opts.onEvent(e)
                }
              },
            })
            const last = history[history.length - 1]
            const text =
              typeof last?.content === 'string'
                ? last.content
                : (last?.content ?? [])
                    .filter((b): b is { type: 'text'; text: string } =>
                      typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text',
                    )
                    .map((b) => b.text)
                    .join('')
            return text || '(subagent returned no text)'
          } catch (err) {
            return `Subagent failed: ${(err as Error).message}`
          }
        },
      }),
    )
  }

  const runner = client.beta.messages.toolRunner(
    {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      // A cache breakpoint on the system block caches the whole prefix —
      // tool definitions included (they precede system in the prompt). The
      // system prompt embeds AGENTS.md/CLAUDE.md, so this is the bulk of
      // every request; reads show up as cacheRead in the usage display.
      system: [
        { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
      ],
      messages: opts.messages,
      tools,
      stream: true,
      max_iterations: 25,
    },
    { signal: opts.signal },
  )

  for await (const stream of runner) {
    let input = 0
    let output = 0
    let cacheRead = 0
    for await (const event of stream) {
      if (event.type === 'message_start') {
        input = event.message.usage.input_tokens ?? 0
        cacheRead = event.message.usage.cache_read_input_tokens ?? 0
      } else if (event.type === 'message_delta') {
        output = event.usage.output_tokens ?? output
      }
      if (event.type !== 'content_block_delta') continue
      if (event.delta.type === 'text_delta') {
        opts.onEvent({ type: 'text', delta: event.delta.text })
      } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
        opts.onEvent({ type: 'thinking', delta: event.delta.thinking })
      }
    }
    if (input || output) opts.onEvent({ type: 'usage', input, output, cacheRead })
  }

  const final = await runner.done()
  const history = [...runner.params.messages]
  if (history[history.length - 1]?.role !== 'assistant') {
    history.push({ role: 'assistant', content: final.content })
  }
  return history
}
