/**
 * The single agent turn loop, built on the AI SDK. One `streamText` multi-step
 * tool loop replaces the two hand-written loops (Anthropic tool runner + OpenAI
 * Chat Completions) — every provider goes through the same code path, and the
 * AI SDK owns the wire-protocol differences.
 *
 * Tools come from the shared zod `TOOLS` plus view_image, run_subagent, and the
 * session's external MCP tools. Deferred MCP tools activate mid-turn via
 * enable_tools: all external tools are registered up front and `prepareStep`
 * gates each step's `activeTools` to the currently-active set, so a newly
 * enabled tool becomes callable in the same turn (the SDK can gate a fixed tool
 * set but not grow it per step).
 *
 * Vision: a multimodal primary gets images back inline from view_image (file
 * tool-result parts); otherwise the tool sub-calls the vision-slot model and
 * returns its text description.
 */
import {
  streamText,
  tool,
  dynamicTool,
  jsonSchema,
  stepCountIs,
  type ModelMessage,
  type ToolSet,
  type LanguageModelUsage,
} from 'ai'
import { z } from 'zod'
import { TOOLS, externalToolSpecs, allExternalToolSpecs, type ToolCtx } from './tools'
import { toLanguageModel } from './model'
import { mapLimit } from '@/lib/async'
import { loadKbImage, visionDescribe, type KbImage } from './vision'
import type { LlmProfile } from '@/stores/settings'
import type { AgentEventHandler } from './types'

const MAX_ITERATIONS = 25
const MAX_IMAGES_PER_CALL = 5
const DEFAULT_MAX_TOKENS = 8192

const SUBAGENT_SYSTEM_SUFFIX = `

You are running as a SUBAGENT on one scoped task. Work autonomously with the tools; do not ask the user questions. Your final message is returned verbatim to the main agent as a tool result — make it a complete, self-contained answer. You cannot spawn further subagents.`

export interface RunTurnOptions {
  profile: LlmProfile
  system: string
  /** Full conversation history including the newest user message. */
  messages: ModelMessage[]
  /** Vision slot: undefined = no image understanding; inline = the primary is
   *  multimodal and gets images back directly from view_image. */
  vision?: { profile: LlmProfile; inline: boolean }
  /** Chat session this turn belongs to — scopes tool side effects. */
  sessionId: string
  onEvent: AgentEventHandler
  signal: AbortSignal
  /** Offer run_subagent (disabled inside subagents — depth 1 only). */
  allowSubagent?: boolean
}

/** Extract the plain text of the last assistant message (for subagent replies). */
function lastAssistantText(history: ModelMessage[]): string {
  const last = [...history].reverse().find((m) => m.role === 'assistant')
  if (!last) return ''
  if (typeof last.content === 'string') return last.content
  return last.content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

const viewImageSchema = z.object({
  paths: z.array(z.string()).describe('KB-relative image paths, e.g. ["raw/images/chart.png"]'),
  purpose: z.string().optional().describe('What you want to know about the images'),
})

/** Runs one agent turn; returns the updated conversation history. */
export async function runTurn(opts: RunTurnOptions): Promise<ModelMessage[]> {
  const model = toLanguageModel(opts.profile)
  const ctx: ToolCtx = { sessionId: opts.sessionId, emit: opts.onEvent }
  // Monotonic id per turn correlating an external tool's start with its result
  // so the UI can show a spinner + timer. Subagents wrap onEvent and drop ids.
  let toolSeq = 0

  // Built-in + view_image + run_subagent tools (always active).
  const tools: ToolSet = {}
  for (const t of TOOLS) {
    tools[t.name] = tool({
      description: t.description,
      inputSchema: t.schema,
      execute: async (input) => {
        opts.onEvent({ type: 'tool', name: t.name, detail: t.describeCall(input) })
        try {
          return await t.run(input, ctx)
        } catch (err) {
          return `Error: ${(err as Error).message}`
        }
      },
    })
  }
  if (opts.vision) tools['view_image'] = buildViewImageTool(opts.vision, opts)
  if (opts.allowSubagent) tools['run_subagent'] = buildSubagentTool(opts)
  const staticNames = Object.keys(tools)

  // Register EVERY external tool (active + deferred) so a deferred one can be
  // gated into the active set mid-turn; only active names are sent each step.
  for (const ext of allExternalToolSpecs(opts.sessionId)) {
    tools[ext.name] = dynamicTool({
      description: ext.description,
      inputSchema: jsonSchema(ext.jsonSchema),
      execute: async (input) => {
        const args = (input ?? {}) as Record<string, unknown>
        const id = toolSeq++
        opts.onEvent({ type: 'tool', name: ext.name, detail: ext.describeCall(args), id, args })
        let ok = false
        try {
          const result = await ext.run(args)
          ok = !result.startsWith('Error')
          return result
        } finally {
          opts.onEvent({ type: 'tool_result', id, ok })
        }
      },
    })
  }

  // Tools sent to the model this step: built-ins + currently-active externals.
  const activeToolNames = (): string[] => [
    ...staticNames,
    ...externalToolSpecs(opts.sessionId).map((e) => e.name),
  ]

  let streamError: unknown = null
  const result = streamText({
    model,
    // The system prompt must go through `instructions`, NOT a system message in
    // `messages` (the SDK rejects those). As an array of system messages it
    // still carries Anthropic's cache breakpoint over the prefix (tools +
    // system); other providers ignore the providerOptions.
    instructions: [
      {
        role: 'system',
        content: opts.system,
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      },
    ],
    messages: opts.messages,
    tools,
    activeTools: activeToolNames(),
    // Re-gate before each step so an enable_tools activation takes effect now.
    prepareStep: () => ({ activeTools: activeToolNames() }),
    stopWhen: stepCountIs(MAX_ITERATIONS),
    maxOutputTokens: opts.profile.maxTokens ?? DEFAULT_MAX_TOKENS,
    abortSignal: opts.signal,
    onError: ({ error }) => {
      streamError ??= error
    },
  })

  let aborted = false
  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta':
        opts.onEvent({ type: 'text', delta: part.text })
        break
      case 'reasoning-delta':
        // Reasoning-model chain of thought (DeepSeek, Claude thinking, …).
        opts.onEvent({ type: 'thinking', delta: part.text })
        break
      case 'tool-input-start':
        // create_artifact's HTML streams as tool input for a while — show a
        // loading card now; the tool's execute emits the filled-in card later.
        if (part.toolName === 'create_artifact') {
          opts.onEvent({ type: 'artifact', title: '', path: '', pending: true })
        }
        break
      case 'finish-step':
        opts.onEvent(usageEvent(part.usage))
        break
      case 'abort':
        aborted = true
        break
      case 'error':
        streamError ??= part.error
        break
    }
  }

  if (streamError) throw streamError
  // The AI SDK ends the stream gracefully on abort (emits an 'abort' part) and
  // response.messages may hold a half-finished turn — a tool-call with no result
  // would poison the next replay. Throw so the caller keeps the pre-run history
  // clean (just the user message), matching the previous "Stopped" behavior.
  if (aborted || opts.signal.aborted) {
    const err = new Error('Aborted')
    err.name = 'AbortError'
    throw err
  }

  const response = await result.response
  return [...opts.messages, ...response.messages]
}

function usageEvent(usage: LanguageModelUsage): {
  type: 'usage'
  input: number
  output: number
  cacheRead: number
} {
  return {
    type: 'usage',
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheRead: usage.inputTokenDetails?.cacheReadTokens ?? 0,
  }
}

/* ── view_image ──────────────────────────────────────────────────────────── */

async function loadImages(paths: string[]): Promise<{ images: KbImage[]; missing: string[] }> {
  const images: KbImage[] = []
  const missing: string[] = []
  for (const p of paths.slice(0, MAX_IMAGES_PER_CALL)) {
    const img = await loadKbImage(p)
    if (img) images.push(img)
    else missing.push(p)
  }
  return { images, missing }
}

function buildViewImageTool(
  vision: { profile: LlmProfile; inline: boolean },
  opts: RunTurnOptions,
): ToolSet[string] {
  if (vision.inline) {
    // Multimodal primary: return the images as file tool-result parts; the AI
    // SDK formats them for the provider (Anthropic image blocks, OpenAI/Google
    // image parts, …).
    return tool({
      description:
        'Look at image files from the knowledge base (screenshots, figures, photos). Pass KB-relative paths; the images are returned to you visually. Only call this when you actually need to see image content.',
      inputSchema: viewImageSchema,
      execute: async ({ paths }) => {
        opts.onEvent({ type: 'tool', name: 'view_image', detail: `view ${paths.join(', ')}` })
        const { images, missing } = await loadImages(paths)
        if (!images.length) {
          return {
            error: `no readable images (not found or unsupported format): ${missing.join(', ')}`,
          }
        }
        return {
          images,
          note: missing.length ? `(unreadable, skipped: ${missing.join(', ')})` : '',
        }
      },
      toModelOutput: ({ output }) => {
        const out = output as { error?: string; images?: KbImage[]; note?: string }
        if (out.error || !out.images) return { type: 'text', value: `Error: ${out.error}` }
        return {
          type: 'content',
          value: [
            ...out.images.map((img) => ({
              type: 'file' as const,
              data: { type: 'data' as const, data: img.base64 },
              mediaType: img.mediaType,
            })),
            ...(out.note ? [{ type: 'text' as const, text: out.note }] : []),
          ],
        }
      },
    })
  }

  // Text-only primary: sub-call the vision-slot model, return its description.
  return tool({
    description:
      '查看知识库中图片文件的实际内容(视觉理解)。传 KB 相对路径,如 ["raw/images/capture-123.png"]。仅当需要分析图片内容时调用。',
    inputSchema: viewImageSchema,
    execute: async ({ paths, purpose }) => {
      opts.onEvent({ type: 'tool', name: 'view_image', detail: `view ${paths.join(', ')}` })
      const { images, missing } = await loadImages(paths)
      if (!images.length) {
        return `Error: no readable images (not found or unsupported format): ${missing.join(', ')}`
      }
      const note = missing.length ? `\n\n(unreadable, skipped: ${missing.join(', ')})` : ''
      try {
        const desc = await visionDescribe(vision.profile, images, purpose ?? '', opts.signal)
        return `${desc}${note}`
      } catch (err) {
        return `视觉模型(${vision.profile.model})调用失败:${(err as Error).message}`
      }
    },
  })
}

/* ── run_subagent ────────────────────────────────────────────────────────── */

function buildSubagentTool(opts: RunTurnOptions): ToolSet[string] {
  return tool({
    description:
      'Delegate scoped, self-contained subtasks to subagents with fresh contexts and the same KB tools (they cannot spawn subagents). Use it for work that would flood your context — surveying many files, summarizing long documents, independent research questions. INDEPENDENT tasks run in parallel — pass them together in one call. Each task description must be complete and self-contained; you receive only the final answers.',
    inputSchema: z.object({
      tasks: z
        .array(z.string())
        .min(1)
        .max(5)
        .describe('1-5 self-contained subtask descriptions; independent tasks run concurrently'),
    }),
    execute: async ({ tasks }) => {
      opts.onEvent({
        type: 'tool',
        name: 'run_subagent',
        detail: tasks.length === 1 ? `subagent: ${tasks[0].slice(0, 80)}` : `subagents ×${tasks.length}`,
      })
      const results = await mapLimit(tasks, 3, async (task: string, i: number) => {
        const tag = tasks.length > 1 ? `[${i + 1}]` : ''
        const history = await runTurn({
          ...opts,
          system: opts.system + SUBAGENT_SYSTEM_SUFFIX,
          messages: [{ role: 'user', content: task }],
          allowSubagent: false,
          onEvent: (e) => {
            // Surface tool activity (indented) and usage; the subagent's text
            // comes back as this tool's result.
            if (e.type === 'tool') {
              opts.onEvent({ type: 'tool', name: e.name, detail: `  ↳${tag} ${e.detail}`, args: e.args })
            } else if (e.type === 'usage') {
              opts.onEvent(e)
            }
          },
        })
        return lastAssistantText(history) || '(subagent returned no text)'
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
  })
}
