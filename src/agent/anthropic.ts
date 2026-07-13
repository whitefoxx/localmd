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
// NB: explicit .mjs — Rollup fails to resolve the bare subpath through the
// package's `./helpers/*` export pattern (the zod helper resolves, this one
// doesn't); the `./helpers/*.mjs` entry works for both dev and build.
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema.mjs'
import { z } from 'zod'
import type {
  BetaMessageParam,
  BetaToolResultContentBlockParam,
} from '@anthropic-ai/sdk/resources/beta'
import { TOOLS, externalToolSpecs } from './tools'
import { loadKbImage } from './vision'
import { mapLimit } from '@/lib/async'
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

  // Assigned after the runner is created; enable_tools uses it to add newly
  // activated external tools to the SAME turn via setMessagesParams.
  interface RunnerParamsRef {
    setMessagesParams(mutator: (p: { tools?: unknown[] }) => { tools?: unknown[] }): void
  }
  let runnerRef: RunnerParamsRef | null = null
  const externalNames = new Set<string>()
  // Monotonic id per turn correlating an external tool's start with its result
  // so the UI can show a loading spinner + timer (MCP calls range from instant
  // to minutes). Subagents wrap onEvent and strip ids, so ids never collide.
  let toolSeq = 0

  const makeExternalTool = (ext: ReturnType<typeof externalToolSpecs>[number]) =>
    betaTool({
      name: ext.name,
      description: ext.description,
      inputSchema: ext.jsonSchema as never,
      run: async (args) => {
        const a = (args ?? {}) as Record<string, unknown>
        const id = toolSeq++
        opts.onEvent({ type: 'tool', name: ext.name, detail: ext.describeCall(a), id })
        let ok = false
        try {
          const result = await ext.run(a)
          ok = !result.startsWith('Error')
          return result
        } finally {
          opts.onEvent({ type: 'tool_result', id, ok })
        }
      },
    }) as never

  const syncExternalTools = (): void => {
    const added = externalToolSpecs().filter((e) => !externalNames.has(e.name))
    if (!added.length || !runnerRef) return
    for (const e of added) externalNames.add(e.name)
    const newTools = added.map(makeExternalTool)
    runnerRef.setMessagesParams((p) => ({
      ...p,
      tools: [...(p.tools ?? []), ...newTools],
    }))
  }

  const tools = TOOLS.map((t) =>
    betaZodTool({
      name: t.name,
      description: t.description,
      inputSchema: t.schema,
      run: async (args) => {
        opts.onEvent({ type: 'tool', name: t.name, detail: t.describeCall(args) })
        try {
          const result = await t.run(args)
          if (t.name === 'enable_tools') syncExternalTools()
          return result
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

  // Remote MCP tools (raw JSON schemas — betaTool skips the zod round trip).
  // Only currently-active ones; deferred tools join via enable_tools.
  for (const ext of externalToolSpecs()) {
    externalNames.add(ext.name)
    tools.push(makeExternalTool(ext))
  }

  if (opts.allowSubagent) {
    tools.push(
      betaZodTool({
        name: 'run_subagent',
        description:
          'Delegate scoped, self-contained subtasks to subagents with fresh contexts and the same KB tools (they cannot spawn subagents). Use it for work that would flood your context — surveying many files, summarizing long documents, independent research questions. INDEPENDENT tasks run in parallel — pass them together in one call. Each task description must be complete and self-contained; you receive only the final answers.',
        inputSchema: z.object({
          tasks: z
            .array(z.string())
            .min(1)
            .max(5)
            .describe('1-5 self-contained subtask descriptions; independent tasks run concurrently'),
        }),
        run: async ({ tasks }) => {
          opts.onEvent({
            type: 'tool',
            name: 'run_subagent',
            detail:
              tasks.length === 1
                ? `subagent: ${tasks[0].slice(0, 80)}`
                : `subagents ×${tasks.length}`,
          })
          const results = await mapLimit(tasks, 3, async (task, i) => {
            const tag = tasks.length > 1 ? `[${i + 1}]` : ''
            const history = await runAnthropicTurn({
              ...opts,
              system: opts.system + SUBAGENT_SYSTEM_SUFFIX,
              messages: [{ role: 'user', content: task }],
              allowSubagent: false,
              onEvent: (e) => {
                // Surface tool activity (indented) and usage; the subagent's
                // text comes back as this tool's result.
                if (e.type === 'tool') {
                  opts.onEvent({ type: 'tool', name: e.name, detail: `  ↳${tag} ${e.detail}` })
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
          })
          if (tasks.length === 1) {
            const r = results[0]
            return r instanceof Error ? `Subagent failed: ${r.message}` : r
          }
          return tasks
            .map((t, i) => {
              const r = results[i]
              const body = r instanceof Error ? `(failed: ${r.message})` : r
              return `## 子任务 ${i + 1}: ${t.slice(0, 60)}\n\n${body}`
            })
            .join('\n\n')
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
  runnerRef = runner as unknown as RunnerParamsRef

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
