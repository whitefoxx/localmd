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
  httpToolSpecs,
  allHttpToolSpecs,
  externalToolSpecs,
  allExternalToolSpecs,
  inactiveBuiltinNames,
  type ExternalToolSpec,
  type ToolCtx,
} from './tools'
import { toLanguageModel } from './model'
import { mapLimit, untilAborted } from '@/lib/async'
import { sdkKindFor, DEFAULT_MAX_TOKENS } from '@/lib/providers'
import { withMovingBreakpoint } from '@/lib/promptCache'
import { trimHistory } from '@/lib/history'
import { estimateTokens } from '@/lib/tokenMeter'
import { isContextOverflow } from '@/lib/providerError'
import { STOPPED_RESULT } from '@/lib/present'
import { needsLicence, lockedToolResult } from '@/lib/licence'
import { useLicenceStore } from '@/stores/licence'
import { loadKbImage, visionDescribe, type KbImage } from './vision'
import { generateKbImage } from './imagegen'
import type { SystemPromptParts } from './prompt'
import type { LlmProfile } from '@/stores/settings'
import type { AgentEventHandler } from './types'

const MAX_ITERATIONS = 25
/** How many times one turn may prune and retry after a context overflow.
 *  Two is enough for the real case (a turn that ingested too much) and small
 *  enough that a misclassified error cannot cost much. */
const MAX_OVERFLOW_RECOVERIES = 2
/** How much of the tail an overflow prune spares, per attempt. The first pass
 *  keeps the newest call/result pair — the model's live working set — and
 *  stubs everything older, including earlier results of this same turn. If
 *  that still does not fit, the second spares nothing: at that point the
 *  choice is a degraded turn or no turn, and a stubbed result names a
 *  `.trace/` path the model can read back. */
const OVERFLOW_KEEP_MESSAGES = [2, 0]
const MAX_IMAGES_PER_CALL = 5

/**
 * Whether this call must be refused for want of a licence.
 *
 * Asked at call time, not at registration time: the tool list is part of the
 * provider's cache prefix, so a key pasted or expiring mid-session must not
 * change which tools were serialized. Only the answer changes.
 *
 * Tolerates the store being unavailable (tests, and any non-app caller) by
 * treating that as unlocked — a missing Pinia instance is our problem, and the
 * failure mode that matters is charging someone twice, not gating too little.
 */
function licenceLocked(name: string): boolean {
  if (!needsLicence(name)) return false
  try {
    return useLicenceStore().restricted
  } catch {
    return false
  }
}

/* Subagent framing rides in the task's user message, NOT the system prompt:
 * a subagent request whose tools + system are byte-identical to the main
 * loop's shares its prompt-cache prefix, so spinning one up is cheap. */
const SUBAGENT_TASK_PREFACE = `[You are running as a SUBAGENT on one scoped task. Work autonomously with the tools; do not ask the user questions. Your final message is returned verbatim to the main agent as a tool result — make it a complete, self-contained answer. run_subagent is unavailable to you.]

Task: `

/* 1h TTL to survive the user's think-read-write gaps between turns; the full
 * rationale (and the rule that this must match the moving breakpoint's TTL)
 * lives in lib/promptCache.ts. */
const CACHE_BREAKPOINT = {
  anthropic: { cacheControl: { type: 'ephemeral' as const, ttl: '1h' as const } },
}

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
  /** Peek whether the user has queued a mid-turn steer message. When it returns
   *  true the step loop stops at the next clean boundary (tool results settled,
   *  no dangling call) so the caller can append the steer and continue. */
  steerPending?: () => boolean
  /** Save the oversized tool results an overflow prune is about to stub, so the
   *  stubs can name a `.trace/` path to read back. Supplied by the chat store
   *  (the effect belongs with it); without it the prune still works and the
   *  stubs fall back to "call the tool again". */
  stashTrimmable?: (
    messages: ModelMessage[],
    opts: { keepLastMessages: number; keepTurns: number },
  ) => Promise<Map<string, string>>
}

function isAbort(err: unknown): boolean {
  const name = (err as Error)?.name
  return name === 'AbortError' || name === 'APIUserAbortError'
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
  // Per-call: each execute adds the SDK's own abortSignal, which is the turn's
  // signal — a tool must be cancellable, not merely started by a live turn.
  const ctx: ToolCtx = { sessionId: opts.sessionId, emit: opts.onEvent, signal: opts.signal }
  // Monotonic id per turn correlating a tool's start with its result so the UI
  // can show a spinner + timer (git push / image gen etc. can be slow — the user
  // needs to see it's working). Subagents wrap onEvent and drop ids.
  let toolSeq = 0
  const nextToolId = (): number => toolSeq++

  // Built-in + view_image + run_subagent tools (always active).
  const tools: ToolSet = {}
  for (const t of TOOLS) {
    tools[t.name] = tool({
      description: t.description,
      inputSchema: t.schema,
      execute: async (input, { abortSignal }) => {
        const id = nextToolId()
        opts.onEvent({ type: 'tool', name: t.name, detail: t.describeCall(input), id })
        let ok = false
        let out = ''
        try {
          // Refused here rather than by withholding the tool: the registered
          // list is part of the cache prefix, and the attempt belongs in the
          // transcript so the user sees what the agent wanted to do.
          if (licenceLocked(t.name)) {
            out = lockedToolResult(t.name)
            return out
          }
          const signal = abortSignal ?? opts.signal
          const result = await untilAborted(t.run(input, { ...ctx, signal }), signal)
          ok = !(typeof result === 'string' && result.startsWith('Error'))
          out = typeof result === 'string' ? result : JSON.stringify(result)
          return result
        } catch (err) {
          out = isAbort(err) ? STOPPED_RESULT : `Error: ${(err as Error).message}`
          return out
        } finally {
          opts.onEvent({ type: 'tool_result', id, ok, result: out })
        }
      },
    })
  }
  // A tool whose schema is plain JSON Schema rather than Zod: the installed
  // HTTP tools and every external MCP tool.
  const registerDynamic = (ext: ExternalToolSpec): void => {
    tools[ext.name] = dynamicTool({
      description: ext.description,
      inputSchema: jsonSchema(ext.jsonSchema),
      execute: async (input, { abortSignal }) => {
        const args = (input ?? {}) as Record<string, unknown>
        const id = nextToolId()
        opts.onEvent({ type: 'tool', name: ext.name, detail: ext.describeCall(args), id, args })
        let ok = false
        let out = ''
        try {
          const signal = abortSignal ?? opts.signal
          const result = await untilAborted(ext.run(args, signal), signal)
          ok = !result.startsWith('Error')
          out = result
          return result
        } catch (err) {
          out = isAbort(err) ? STOPPED_RESULT : `Error: ${(err as Error).message}`
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
    : buildSubagentStub(SUBAGENT_IN_SUBAGENT)
  const staticNames = Object.keys(tools)

  // Installed HTTP tools (Settings → Tools). Registered in full — active AND
  // deferred — so a big bundle's tool can be enabled mid-turn, but only the
  // active ones are sent each step (the prefix audit priced one KB's bundles
  // at ~28% of the always-on prefix, which is what deferral saves).
  // A tool may not shadow a built-in: the KB's own file and a model-authored
  // spec both reach this list, and read_file must stay read_file.
  const registeredHttp = new Set<string>()
  for (const httpTool of allHttpToolSpecs(opts.sessionId)) {
    if (httpTool.name in tools) continue
    registerDynamic(httpTool)
    registeredHttp.add(httpTool.name)
  }

  // Register EVERY external tool (active + deferred) so a deferred one can be
  // gated into the active set mid-turn; only active names are sent each step.
  for (const ext of allExternalToolSpecs(opts.sessionId)) registerDynamic(ext)

  // Tools sent to the model this step: built-ins (minus the git family when
  // the KB is not a repository — re-checked per step, so git_init unlocks the
  // rest within the same turn) + currently-active installed tools +
  // currently-active externals. The shadow filter keeps a skipped
  // (built-in-colliding) name from being listed twice.
  const activeToolNames = (): string[] => {
    const inactive = inactiveBuiltinNames()
    return [
      ...staticNames.filter((n) => !inactive.has(n)),
      ...httpToolSpecs(opts.sessionId)
        .map((s) => s.name)
        .filter((n) => registeredHttp.has(n)),
      ...externalToolSpecs(opts.sessionId).map((e) => e.name),
    ]
  }

  // Anthropic caches nothing it isn't told to: besides the two system-block
  // breakpoints, mark the last message each step so the ever-growing history
  // is written to cache once and re-read at 0.1× on every subsequent step and
  // turn. Other providers cache by prefix automatically — for them the marks
  // are inert and the win comes from keeping the prefix bytes stable.
  const movingBreakpoint = sdkKindFor(opts.profile.provider) === 'anthropic'

  /* One pass of the model loop over `messages`. Extracted so a context-overflow
   * failure can prune and re-enter it — everything above (tool registration,
   * the active-name gate) is per-turn and deliberately NOT rebuilt, so a retry
   * cannot change the tool set the provider already cached. */
  const runSegment = async (
    messages: ModelMessage[],
  ): Promise<{ steps: ModelMessage[]; error: unknown; aborted: boolean; stepCount: number }> => {
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
    messages,
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
    // One generic knob; each provider package turns it into its own parameter.
    // Undefined sends nothing at all, so a profile that never set it keeps
    // exactly the request shape it had before.
    reasoning: opts.profile.reasoning,
    abortSignal: opts.signal,
    onError: ({ error }) => {
      streamError ??= error
    },
  })

  let aborted = false
  let steps = 0
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
        steps++
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

    // Steps completed before the failure still hold real work (tool results
    // the user paid for). They are recoverable even when the stream errored,
    // so read them defensively rather than assuming either outcome.
    let done: ModelMessage[] = []
    try {
      done = (await result.steps).flatMap((s) => s.response.messages)
    } catch (err) {
      streamError ??= err
    }
    return { steps: done, error: streamError, aborted, stepCount: steps }
  }

  let messages = opts.messages
  let recoveries = 0
  let segment = await runSegment(messages)

  // Context overflow is the one provider failure with a repair: the turn grew
  // past the window mid-flight (25 steps of tool results on top of a ~20k
  // prefix reaches it easily), and dropping that bulk makes the same request
  // fit. Every other error belongs to the caller untouched.
  while (
    segment.error &&
    !segment.aborted &&
    recoveries < MAX_OVERFLOW_RECOVERIES &&
    isContextOverflow(segment.error)
  ) {
    const before = [...messages, ...segment.steps]
    // Counted in MESSAGES, not turns. The turn-based window protects
    // everything after the newest user message — which mid-turn is the whole
    // turn, i.e. exactly the tool results that just overflowed the window. A
    // turn-based prune here would free nothing and the retry would be refused.
    const emergency = {
      keepLastMessages: OVERFLOW_KEEP_MESSAGES[recoveries] ?? 0,
      keepTurns: 1,
    }
    const recallPaths = await opts.stashTrimmable?.(before, emergency)
    const pruned = trimHistory(before, { ...emergency, recallPaths })
    // Retry ONLY on measurable shrinkage. Without this the loop would re-send
    // the same oversized request and burn the cap for nothing — a single
    // over-window message (one huge paste) is not repairable by trimming.
    if (estimateTokens(pruned) >= estimateTokens(before)) break
    recoveries++
    opts.onEvent({
      type: 'tool',
      name: 'compact',
      detail: 'Context limit hit — dropping older tool output and retrying…',
    })
    messages = pruned
    segment = await runSegment(messages)
  }

  const { error: streamError, aborted, stepCount } = segment
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

  // Ran to the cap rather than to a conclusion — say so, or the user reads an
  // interrupted turn as a finished one.
  if (stepCount >= MAX_ITERATIONS) opts.onEvent({ type: 'limit', steps: stepCount })

  // `response.messages` is the LAST step's messages, not the turn's. On any
  // multi-step turn that is just the closing assistant text, so persisting it
  // drops every tool call and result the turn made: the next turn sees the
  // model's own summary and no record of what it actually read, and the
  // tool-result stubbing in lib/history.ts never has anything to stub. The
  // steps hold the whole turn — this is how the SDK assembles history for the
  // next step internally. See run.test.ts, which pins the distinction.
  //
  // `messages` rather than `opts.messages`: after an overflow recovery the
  // pruned history is what the surviving steps were actually generated
  // against, and persisting the unpruned one would put the turn straight back
  // over the window.
  return [...messages, ...segment.steps]
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

const SUBAGENT_IN_SUBAGENT =
  'Error: run_subagent is unavailable — you ARE a subagent. Do the work directly with your other tools.'

/** The name registered with its real description and schema but an execute that
 *  only explains itself. Two callers want this — a subagent (depth stays 1) and
 *  an unlicensed browser — and both need the wire bytes to match the working
 *  tool, so the cache prefix does not move when the reason does. */
function buildSubagentStub(message: string): ToolSet[string] {
  return tool({
    description: SUBAGENT_DESCRIPTION,
    inputSchema: subagentSchema,
    execute: async () => message,
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
              // comes back as this tool's result. Approval pauses pass through
              // whole — the card must reach the transcript or the subagent
              // hangs on a decision nobody was shown.
              if (e.type === 'tool') {
                opts.onEvent({ type: 'tool', name: e.name, detail: `  ↳${tag} ${e.detail}`, args: e.args })
              } else if (e.type === 'usage') {
                // Tagged, because this prices the subagent's own throwaway
                // context. It belongs in the turn's cost and nowhere near any
                // measure of how large THIS conversation has grown.
                opts.onEvent({ ...e, subagent: true })
              } else if (e.type === 'approval' || e.type === 'approval_result') {
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
