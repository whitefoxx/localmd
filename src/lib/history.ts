/**
 * Conversation-history hygiene for long agent sessions. The wire history is
 * append-only and replayed every turn — old tool results (a read_file can be
 * 100k chars) and images dominate token cost while contributing little after
 * the model has acted on them. TRIM replaces them with short stubs.
 *
 * The governing observation: a turn's tool results are its WORKING SET, and
 * the assistant's own reply is the digest that survives — the model read 200k
 * chars of comments and wrote 5k of analysis; after the turn, the 5k is what
 * later turns need. So tool traffic keeps a tighter window (the last turn
 * only) than conversation media, and stubbing it is safe: built-in tools are
 * deterministic to re-run, and external results are stored to `.trace/`
 * before the stub destroys them (see lib/toolResults.ts), so the stub can
 * point at a file recallable with one read_file.
 *
 * Trimming is a BATCH event, not a per-turn sweep: every provider prices
 * cached prefix tokens at a fraction of fresh ones (prefix-match caching), so
 * rewriting history bytes every turn would invalidate the cache from the
 * rewrite point and cost more than the chars it saves. The caller trims only
 * when context pressure crosses TRIM_AT_TOKENS (measured by lib/tokenMeter),
 * stubbing everything outside the keep window in one go; between events the
 * history is byte-stable.
 *
 * Pure functions over the AI SDK's unified ModelMessage shape; unit-tested.
 * The one effect — storing what a trim is about to destroy — stays with the
 * caller: `trimCandidates` names the doomed results, the caller stores them,
 * and `recallPaths` carries the resulting locations back into the stubs.
 */
import type { ModelMessage } from 'ai'

export interface TrimOptions {
  /** Recent real user turns whose images and reasoning stay untouched. */
  keepTurns?: number
  /** Recent real user turns whose tool traffic stays untouched. Defaults
   *  tighter than keepTurns: results are the turn's working set, and the
   *  assistant reply that follows them is the digest that survives. */
  toolKeepTurns?: number
  /** Tool results / inputs above this length get stubbed. */
  maxChars?: number
  /** toolCallId → KB path holding the full result (stored by the caller via
   *  `trimCandidates` before this trim destroys it); the stub names the path
   *  so recall is one deterministic read_file, not a re-call. */
  recallPaths?: ReadonlyMap<string, string>
  /**
   * Emergency override: protect only the last N MESSAGES instead of the last
   * `toolKeepTurns` user turns.
   *
   * The turn-based windows deliberately protect everything after the newest
   * user message — that is the turn in flight, and routine hygiene must not
   * reach into it. A context overflow is the case where it must: the bulk that
   * did not fit is precisely the tool results this turn just accumulated, and
   * a turn-based cutoff would find nothing to free. Counted in messages
   * because mid-turn there is no next user turn to count to.
   */
  keepLastMessages?: number
}

const DEFAULTS = { keepTurns: 2, toolKeepTurns: 1, maxChars: 1500 }

const stub = (chars: number, path?: string) =>
  path
    ? `[Earlier tool result trimmed (was ${chars} chars) — full content saved at ${path}; read_file it if you still need it]`
    : `[Earlier tool result trimmed (was ${chars} chars) — if you still need its content, call the relevant tool again]`
const IMG_STUB = '[Earlier image trimmed — to view it again, call view_image]'
const INPUT_STUB = '[trimmed]'

/* base64 image payloads live under these keys (user image parts / tool-result
 * file parts); they are not text tokens, so the size estimate replaces them
 * with a fixed-size marker instead of counting megabytes of base64. */
const MEDIA_KEYS = new Set(['image', 'data', 'base64'])
const MEDIA_MARK = '[media]'

/** Serialize history for sizing. Media payloads collapse to a constant — an
 *  inline screenshot must not look like 300k chars of text and trigger
 *  trimming/compaction spuriously. lib/tokenMeter prices the result. */
export function serializeForSizing(history: unknown): string {
  return JSON.stringify(history, (key, value) =>
    MEDIA_KEYS.has(key) && typeof value === 'string' && value.length > 1024 ? MEDIA_MARK : value,
  )
}


/* A user message (not a tool-result carrier — those are role:'tool'). */
function isRealUserTurn(m: ModelMessage): boolean {
  return m.role === 'user'
}

/** Index of the first message that must stay untouched. */
function cutoffIndex(history: ModelMessage[], keepTurns: number): number {
  let seen = 0
  for (let i = history.length - 1; i >= 0; i--) {
    if (isRealUserTurn(history[i])) {
      seen++
      if (seen >= keepTurns) return i
    }
  }
  return 0
}

/** Where tool traffic stops being trimmable. `keepLastMessages` overrides the
 *  turn-based window for the mid-turn emergency case; it never protects LESS
 *  than nothing, and a value past the history simply protects all of it. */
function toolCutoffIndex(
  history: ModelMessage[],
  toolKeepTurns: number,
  keepLastMessages?: number,
): number {
  if (keepLastMessages === undefined) return cutoffIndex(history, toolKeepTurns)
  return Math.max(0, history.length - keepLastMessages)
}

type AnyPart = { type: string; [k: string]: unknown }

function trimToolCallInput(input: unknown, maxChars: number): unknown {
  if (!input || typeof input !== 'object') return input
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = typeof v === 'string' && v.length > maxChars ? INPUT_STUB : v
  }
  return out
}

/** Shrink a tool-result part's output: large text → stub; any non-text content
 *  part (image/file media) → text stub. Robust to the exact media part naming. */
function trimToolResultOutput(output: unknown, maxChars: number, path?: string): unknown {
  const o = output as AnyPart | undefined
  if (!o || typeof o !== 'object') return output
  if (o.type === 'text' && typeof o.value === 'string' && o.value.length > maxChars) {
    return { type: 'text', value: stub(o.value.length, path) }
  }
  if (o.type === 'content' && Array.isArray(o.value)) {
    const value = (o.value as AnyPart[]).map((part) => {
      if (part.type !== 'text') return { type: 'text', text: IMG_STUB } // media/file
      if (typeof part.text === 'string' && part.text.length > maxChars) {
        return { type: 'text', text: stub(part.text.length) }
      }
      return part
    })
    return { type: 'content', value }
  }
  return output
}

export function trimHistory(history: ModelMessage[], opts: TrimOptions = {}): ModelMessage[] {
  const { keepTurns, toolKeepTurns, maxChars, recallPaths } = { ...DEFAULTS, ...opts }
  // Two windows: tool traffic survives toolKeepTurns (tight — the last turn),
  // images and reasoning survive keepTurns (wider — a follow-up may still be
  // about the picture, and view_image cannot recall a pasted image).
  const mediaCutoff = cutoffIndex(history, keepTurns)
  const toolCutoff = toolCutoffIndex(history, toolKeepTurns, opts.keepLastMessages)
  return history.map((m, i) => {
    if (i >= toolCutoff || typeof m.content === 'string') return m
    const old = i < mediaCutoff

    const asParts = m.content as unknown as AnyPart[]
    if (m.role === 'tool') {
      const content = asParts.map((part) =>
        part.type === 'tool-result'
          ? {
              ...part,
              output: trimToolResultOutput(
                part.output,
                maxChars,
                recallPaths?.get(String(part.toolCallId)),
              ),
            }
          : part,
      )
      return { ...m, content } as unknown as ModelMessage
    }
    if (m.role === 'user') {
      if (!old) return m
      const content = asParts.map((part) =>
        part.type === 'image' || part.type === 'file' ? { type: 'text', text: IMG_STUB } : part,
      )
      return { ...m, content } as unknown as ModelMessage
    }
    if (m.role === 'assistant') {
      // Old chain-of-thought is dead weight on replay (official providers strip
      // it server-side; openai-compatible reasoning models may re-bill it) —
      // drop it, unless the message would end up empty.
      const kept = old ? asParts.filter((part) => part.type !== 'reasoning') : asParts
      const content = (kept.length ? kept : asParts).map((part) =>
        part.type === 'tool-call'
          ? { ...part, input: trimToolCallInput(part.input, maxChars) }
          : part,
      )
      return { ...m, content } as unknown as ModelMessage
    }
    return m
  })
}

export interface TrimCandidate {
  toolCallId: string
  toolName: string
  text: string
}

/**
 * The text tool results the next trimHistory call will stub — so the caller
 * can store the irreproducible ones (external MCP/HTTP results re-rank,
 * refuse, or bill on a re-call) before the stub destroys their content, and
 * hand the paths back via `recallPaths`.
 *
 * Only `text` outputs qualify: external results are always strings, and the
 * content-array shape is built-in media (view_image), cheap to re-run.
 * Already-stubbed results fall under maxChars and drop out on their own.
 */
export function trimCandidates(history: ModelMessage[], opts: TrimOptions = {}): TrimCandidate[] {
  const { toolKeepTurns, maxChars } = { ...DEFAULTS, ...opts }
  const toolCutoff = toolCutoffIndex(history, toolKeepTurns, opts.keepLastMessages)
  const out: TrimCandidate[] = []
  for (const m of history.slice(0, toolCutoff)) {
    if (m.role !== 'tool' || typeof m.content === 'string') continue
    for (const part of m.content as unknown as AnyPart[]) {
      if (part.type !== 'tool-result') continue
      const o = part.output as AnyPart | undefined
      if (o?.type === 'text' && typeof o.value === 'string' && o.value.length > maxChars) {
        out.push({
          toolCallId: String(part.toolCallId),
          toolName: String(part.toolName ?? ''),
          text: o.value,
        })
      }
    }
  }
  return out
}

/* ── compaction: summarize old turns when the history gets huge ──────────── */

/* The threshold that fires compaction is COMPACT_AT_TOKENS in
 * lib/tokenMeter — the character version it replaced could not tell 70k
 * tokens of English from 250k of Chinese. */

/** Real user turns kept verbatim after compaction. */
export const COMPACT_KEEP_TURNS = 2
/** Transcript cap fed to the summarizer. */
const TRANSCRIPT_CAP = 60_000

function clip(s: string, n = 200): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function partText(part: AnyPart): string {
  switch (part.type) {
    case 'text':
      return String(part.text ?? '')
    case 'reasoning':
      return ''
    case 'image':
    case 'file':
      return '[image]'
    case 'tool-call':
      return `[call ${part.toolName}: ${clip(JSON.stringify(part.input))}]`
    case 'tool-result': {
      const o = part.output as AnyPart | undefined
      const body =
        o?.type === 'text' ? String(o.value ?? '') : clip(JSON.stringify(o?.value ?? o ?? ''))
      return `[tool result: ${clip(body)}]`
    }
    default:
      return ''
  }
}

function roleLabel(role: string): string {
  return role === 'user' ? 'User' : role === 'assistant' ? 'Assistant' : role === 'tool' ? 'Tool' : role
}

/** Plain-text transcript of the history, for the summarizer. */
export function renderTranscript(history: ModelMessage[]): string {
  const lines = history.map((m) => {
    const body =
      typeof m.content === 'string'
        ? m.content
        : (m.content as unknown as AnyPart[]).map(partText).join(' ')
    return `${roleLabel(m.role)}: ${body}`
  })
  const text = lines.join('\n')
  return text.length > TRANSCRIPT_CAP ? `${text.slice(0, TRANSCRIPT_CAP)}\n…[remainder truncated]` : text
}

export interface Split {
  old: ModelMessage[]
  recent: ModelMessage[]
}

/** Split history at the keepTurns-th-from-last real user turn. Returns null
 *  when there's nothing before that point to compact. */
export function splitForCompaction(
  history: ModelMessage[],
  keepTurns = COMPACT_KEEP_TURNS,
): Split | null {
  const cutoff = cutoffIndex(history, keepTurns)
  if (cutoff <= 0) return null
  return { old: history.slice(0, cutoff), recent: history.slice(cutoff) }
}

/** The message pair that replaces the compacted prefix (user summary + assistant
 *  ack keeps role alternation valid). */
export function compactedPrefix(summary: string): { user: string; assistant: string } {
  return {
    user: `[System injection: the following is an automatic summary of the earlier part of this session; the original messages have been removed to save context]\n\n${summary}\n\n[End of summary — continue based on it and the messages that follow]`,
    assistant: 'Understood the earlier progress; continuing.',
  }
}
