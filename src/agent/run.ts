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
import {
  TOOLS,
  webSearch,
  webFetch,
  externalToolSpecs,
  allExternalToolSpecs,
  type ToolSpec,
  type ToolCtx,
} from './tools'
import { toLanguageModel } from './model'
import { mapLimit } from '@/lib/async'
import { sdkKindFor } from '@/lib/providers'
import { withMovingBreakpoint } from '@/lib/promptCache'
import { loadKbImage, visionDescribe, type KbImage } from './vision'
import { generateKbImage } from './imagegen'
import type { SystemPromptParts } from './prompt'
import type { LlmProfile } from '@/stores/settings'
import type { AgentEventHandler } from './types'

const MAX_ITERATIONS = 25
const MAX_IMAGES_PER_CALL = 5
const DEFAULT_MAX_TOKENS = 8192

/* Subagent framing rides in the task's user message, NOT the system prompt:
 * a subagent request whose tools + system are byte-identical to the main
 * loop's shares its prompt-cache prefix, so spinning one up is cheap. */
const SUBAGENT_TASK_PREFACE = `[You are running as a SUBAGENT on one scoped task. Work autonomously with the tools; do not ask the user questions. Your final message is returned verbatim to the main agent as a tool result — make it a complete, self-contained answer. run_subagent is unavailable to you.]

Task: `

const CACHE_BREAKPOINT = { anthropic: { cacheControl: { type: 'ephemeral' as const } } }

export interface RunTurnOptions {
  profile: LlmProfile
  system: SystemPromptParts
  /** Full conversation history including the newest user message. */
  messages: ModelMessage[]
  /** Vision slot: undefined = no image understanding; inline = the primary is
   *  multimodal and gets images back directly from view_image. */
  vision?: { profile: LlmProfile; inline: boolean }
  /** Image-generation slot: when set, offer the generate_image tool. */
  image?: LlmProfile
  /** Chat session this turn belongs to — scopes tool side effects. */
  sessionId: string
  onEvent: AgentEventHandler
  signal: AbortSignal
  /** Offer run_subagent (disabled inside subagents — depth 1 only). */
  allowSubagent?: boolean
  /** Offer the built-in web_search / web_fetch tools (Jina AI Reader fallback). */
  jinaReader?: boolean
  /** Peek whether the user has queued a mid-turn steer message. When it returns
   *  true the step loop stops at the next clean boundary (tool results settled,
   *  no dangling call) so the caller can append the steer and continue. */
  steerPending?: () => boolean
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
  // Monotonic id per turn correlating a tool's start with its result so the UI
  // can show a spinner + timer (git push / image gen etc. can be slow — the user
  // needs to see it's working). Subagents wrap onEvent and drop ids.
  let toolSeq = 0
  const nextToolId = (): number => toolSeq++

  // Built-in + view_image + run_subagent tools (always active). The Jina web
  // tools ride along only when enabled (a fallback for when the browser
  // extension isn't connected).
  const tools: ToolSet = {}
  const builtins: ToolSpec[] = opts.jinaReader ? [...TOOLS, webSearch, webFetch] : TOOLS
  for (const t of builtins) {
    tools[t.name] = tool({
      description: t.description,
      inputSchema: t.schema,
      execute: async (input) => {
        const id = nextToolId()
        opts.onEvent({ type: 'tool', name: t.name, detail: t.describeCall(input), id })
        let ok = false
        let out = ''
        try {
          const result = await t.run(input, ctx)
          ok = !(typeof result === 'string' && result.startsWith('Error'))
          out = typeof result === 'string' ? result : JSON.stringify(result)
          return result
        } catch (err) {
          out = `Error: ${(err as Error).message}`
          return out
        } finally {
          opts.onEvent({ type: 'tool_result', id, ok, result: out })
        }
      },
    })
  }
  if (opts.vision) tools['view_image'] = buildViewImageTool(opts.vision, opts, nextToolId)
  if (opts.image) tools['generate_image'] = buildGenerateImageTool(opts.image, opts, nextToolId)
  // Registered in subagents too (as a refusing stub) so the serialized tool
  // list — and with it the provider's prompt-cache prefix — matches the main
  // loop's byte for byte.
  tools['run_subagent'] = opts.allowSubagent
    ? buildSubagentTool(opts, nextToolId)
    : buildSubagentStub()
  const staticNames = Object.keys(tools)

  // Register EVERY external tool (active + deferred) so a deferred one can be
  // gated into the active set mid-turn; only active names are sent each step.
  for (const ext of allExternalToolSpecs(opts.sessionId)) {
    tools[ext.name] = dynamicTool({
      description: ext.description,
      inputSchema: jsonSchema(ext.jsonSchema),
      execute: async (input) => {
        const args = (input ?? {}) as Record<string, unknown>
        const id = nextToolId()
        opts.onEvent({ type: 'tool', name: ext.name, detail: ext.describeCall(args), id, args })
        let ok = false
        let out = ''
        try {
          const result = await ext.run(args)
          ok = !result.startsWith('Error')
          out = result
          return result
        } finally {
          opts.onEvent({ type: 'tool_result', id, ok, result: out })
        }
      },
    })
  }

  // Tools sent to the model this step: built-ins + currently-active externals.
  const activeToolNames = (): string[] => [
    ...staticNames,
    ...externalToolSpecs(opts.sessionId).map((e) => e.name),
  ]

  // Anthropic caches nothing it isn't told to: besides the two system-block
  // breakpoints, mark the last message each step so the ever-growing history
  // is written to cache once and re-read at 0.1× on every subsequent step and
  // turn. Other providers cache by prefix automatically — for them the marks
  // are inert and the win comes from keeping the prefix bytes stable.
  const movingBreakpoint = sdkKindFor(opts.profile.provider) === 'anthropic'

  let streamError: unknown = null
  const result = streamText({
    model,
    // The system prompt must go through `instructions`, NOT a system message in
    // `messages` (the SDK rejects those). Two system messages become two cache
    // breakpoints: the stable block survives KB/session/locale changes, the
    // dynamic block only invalidates itself. Other providers ignore the
    // providerOptions and see a plain two-part system prompt.
    instructions: [
      { role: 'system', content: opts.system.stable, providerOptions: CACHE_BREAKPOINT },
      ...(opts.system.dynamic
        ? [{ role: 'system' as const, content: opts.system.dynamic, providerOptions: CACHE_BREAKPOINT }]
        : []),
    ],
    messages: opts.messages,
    tools,
    activeTools: activeToolNames(),
    // Re-gate before each step so an enable_tools activation takes effect now,
    // and move the message cache breakpoint to the step's last message.
    prepareStep: ({ messages }) => ({
      activeTools: activeToolNames(),
      ...(movingBreakpoint ? { messages: withMovingBreakpoint(messages) } : {}),
    }),
    // Stop at the iteration cap, or early when the user queues a steer message —
    // evaluated after each completed step, so the turn ends cleanly (all tool
    // results present) and the caller can append the steer and run another turn.
    stopWhen: [stepCountIs(MAX_ITERATIONS), () => opts.steerPending?.() ?? false],
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
  cacheWrite: number
} {
  return {
    type: 'usage',
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheRead: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWrite: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
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
  nextToolId: () => number,
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
        const id = nextToolId()
        opts.onEvent({ type: 'tool', name: 'view_image', detail: `view ${paths.join(', ')}`, id })
        let ok = false
        let out = ''
        try {
          const { images, missing } = await loadImages(paths)
          if (!images.length) {
            out = `no readable images: ${missing.join(', ')}`
            return {
              error: `no readable images (not found or unsupported format): ${missing.join(', ')}`,
            }
          }
          ok = true
          // Don't put base64 in the transcript — just a summary of what was sent.
          out = `Returned ${images.length} image(s) to the model${missing.length ? ` (skipped ${missing.length} unreadable)` : ''}`
          return {
            images,
            note: missing.length ? `(unreadable, skipped: ${missing.join(', ')})` : '',
          }
        } finally {
          opts.onEvent({ type: 'tool_result', id, ok, result: out })
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
      'Look at the actual contents of image files in the knowledge base (visual understanding). Pass KB-relative paths, e.g. ["raw/images/capture-123.png"]. Only call this when you need to analyze image content.',
    inputSchema: viewImageSchema,
    execute: async ({ paths, purpose }) => {
      const id = nextToolId()
      opts.onEvent({ type: 'tool', name: 'view_image', detail: `view ${paths.join(', ')}`, id })
      let ok = false
      let out = ''
      try {
        const { images, missing } = await loadImages(paths)
        if (!images.length) {
          out = `Error: no readable images: ${missing.join(', ')}`
          return `Error: no readable images (not found or unsupported format): ${missing.join(', ')}`
        }
        const note = missing.length ? `\n\n(unreadable, skipped: ${missing.join(', ')})` : ''
        try {
          const desc = await visionDescribe(vision.profile, images, purpose ?? '', opts.signal)
          ok = true
          out = `${desc}${note}`
          return out
        } catch (err) {
          out = `Vision model (${vision.profile.model}) call failed: ${(err as Error).message}`
          return out
        }
      } finally {
        opts.onEvent({ type: 'tool_result', id, ok, result: out })
      }
    },
  })
}

/* ── generate_image ──────────────────────────────────────────────────────── */

function buildGenerateImageTool(
  profile: LlmProfile,
  opts: RunTurnOptions,
  nextToolId: () => number,
): ToolSet[string] {
  return tool({
    description:
      'Generate an image from a text prompt and save it into the knowledge base (raw/images/). Use it when the user asks for a picture, illustration, diagram-as-image, icon, cover, etc. The saved image is shown to the user as a card — do not describe or paste it back.',
    inputSchema: z.object({
      prompt: z.string().describe('Detailed description of the image to generate'),
      size: z
        .string()
        .optional()
        .describe('Optional size like "1024x1024" (provider-dependent)'),
    }),
    execute: async ({ prompt, size }) => {
      const id = nextToolId()
      opts.onEvent({ type: 'tool', name: 'generate_image', detail: `image: ${prompt.slice(0, 60)}`, id })
      let ok = false
      let out = ''
      try {
        const { path } = await generateKbImage(profile, prompt, { size, signal: opts.signal })
        // Reflect the new file in the tree, then show the image inline in chat.
        const { useFilesStore } = await import('@/stores/files')
        await useFilesStore().refreshTree()
        opts.onEvent({ type: 'image', path })
        ok = true
        out = `Generated image and saved it to ${path}`
        return `Generated image and saved it to ${path} (already shown to the user as an image card). Use view_image if you need to inspect it; do not paste the contents back.`
      } catch (err) {
        out = `Image generation failed (${profile.model}): ${(err as Error).message}`
        return out
      } finally {
        opts.onEvent({ type: 'tool_result', id, ok, result: out })
      }
    },
  })
}

/* ── run_subagent ────────────────────────────────────────────────────────── */

/* Description and schema are shared with the subagent-side stub — the tool
 * must serialize identically in both so the cache prefix matches. */
const SUBAGENT_DESCRIPTION =
  'Delegate scoped, self-contained subtasks to subagents with fresh contexts and the same KB tools (they cannot spawn subagents). Use it for work that would flood your context — surveying many files, summarizing long documents, independent research questions. INDEPENDENT tasks run in parallel — pass them together in one call. Each task description must be complete and self-contained; you receive only the final answers.'

const subagentSchema = z.object({
  tasks: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe('1-5 self-contained subtask descriptions; independent tasks run concurrently'),
})

/** What a subagent gets under the run_subagent name: same wire bytes, no
 *  recursion — depth stays 1 and the refusal costs one cheap step at most. */
function buildSubagentStub(): ToolSet[string] {
  return tool({
    description: SUBAGENT_DESCRIPTION,
    inputSchema: subagentSchema,
    execute: async () =>
      'Error: run_subagent is unavailable — you ARE a subagent. Do the work directly with your other tools.',
  })
}

function buildSubagentTool(opts: RunTurnOptions, nextToolId: () => number): ToolSet[string] {
  return tool({
    description: SUBAGENT_DESCRIPTION,
    inputSchema: subagentSchema,
    execute: async ({ tasks }) => {
      const id = nextToolId()
      opts.onEvent({
        type: 'tool',
        name: 'run_subagent',
        detail: tasks.length === 1 ? `subagent: ${tasks[0].slice(0, 80)}` : `subagents ×${tasks.length}`,
        id,
      })
      let ok = false
      let out = ''
      try {
        const results = await mapLimit(tasks, 3, async (task: string, i: number) => {
          const tag = tasks.length > 1 ? `[${i + 1}]` : ''
          const history = await runTurn({
            ...opts,
            messages: [{ role: 'user', content: SUBAGENT_TASK_PREFACE + task }],
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
        // Per-task failures come back embedded in the text, so reaching here is
        // a successful tool call.
        ok = true
        if (tasks.length === 1) {
          const r = results[0]
          out = r instanceof Error ? `Subagent failed: ${r.message}` : r
        } else {
          out = tasks
            .map((t, i) => {
              const r = results[i]
              const body = r instanceof Error ? `(failed: ${r.message})` : r
              return `## Subtask ${i + 1}: ${t.slice(0, 60)}\n\n${body}`
            })
            .join('\n\n')
        }
        return out
      } finally {
        opts.onEvent({ type: 'tool_result', id, ok, result: out })
      }
    },
  })
}
