/**
 * Conversation-history hygiene for long agent sessions. The wire history is
 * append-only and replayed every turn — old tool results (a read_file can be
 * 100k chars) and images dominate token cost while contributing little after
 * the model has acted on them. TRIM replaces them with short stubs; the model
 * can always re-run a tool if it genuinely needs the content again.
 *
 * Trimming is a BATCH event, not a per-turn sweep: every provider prices
 * cached prefix tokens at a fraction of fresh ones (prefix-match caching), so
 * rewriting history bytes every turn would invalidate the cache from the
 * rewrite point and cost more than the chars it saves. The caller trims only
 * when the serialized size crosses TRIM_AT_CHARS, stubbing everything outside
 * the keep window in one go; between events the history is byte-stable.
 *
 * Pure functions over the AI SDK's unified ModelMessage shape; unit-tested.
 */
import type { ModelMessage } from 'ai'

export interface TrimOptions {
  /** Recent real user turns to leave untouched. */
  keepTurns?: number
  /** Tool results / inputs above this length get stubbed. */
  maxChars?: number
}

const DEFAULTS: Required<TrimOptions> = { keepTurns: 2, maxChars: 1500 }

const stub = (chars: number) =>
  `[Earlier tool result trimmed (was ${chars} chars) — if you still need its content, call the relevant tool again]`
const IMG_STUB = '[Earlier image trimmed — to view it again, call view_image]'
const INPUT_STUB = '[trimmed]'

/** Trim when the serialized history exceeds this many characters. Kept well
 *  below COMPACT_AT_CHARS so stubbing gets a chance before summarization. */
export const TRIM_AT_CHARS = 60_000

/* base64 image payloads live under these keys (user image parts / tool-result
 * file parts); they are not text tokens, so the size estimate replaces them
 * with a fixed-size marker instead of counting megabytes of base64. */
const MEDIA_KEYS = new Set(['image', 'data', 'base64'])
const MEDIA_MARK = '[media]'

/** Rough token estimate for threshold checks (CJK ≈1 token/char, EN ≈0.3).
 *  Media payloads count as a constant — an inline screenshot must not look
 *  like 300k chars of text and trigger trimming/compaction spuriously. */
export function estimateChars(history: unknown): number {
  return JSON.stringify(history, (key, value) =>
    MEDIA_KEYS.has(key) && typeof value === 'string' && value.length > 1024 ? MEDIA_MARK : value,
  ).length
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
function trimToolResultOutput(output: unknown, maxChars: number): unknown {
  const o = output as AnyPart | undefined
  if (!o || typeof o !== 'object') return output
  if (o.type === 'text' && typeof o.value === 'string' && o.value.length > maxChars) {
    return { type: 'text', value: stub(o.value.length) }
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
  const { keepTurns, maxChars } = { ...DEFAULTS, ...opts }
  const cutoff = cutoffIndex(history, keepTurns)
  return history.map((m, i) => {
    if (i >= cutoff || typeof m.content === 'string') return m

    const asParts = m.content as unknown as AnyPart[]
    if (m.role === 'tool') {
      const content = asParts.map((part) =>
        part.type === 'tool-result'
          ? { ...part, output: trimToolResultOutput(part.output, maxChars) }
          : part,
      )
      return { ...m, content } as unknown as ModelMessage
    }
    if (m.role === 'user') {
      const content = asParts.map((part) =>
        part.type === 'image' || part.type === 'file' ? { type: 'text', text: IMG_STUB } : part,
      )
      return { ...m, content } as unknown as ModelMessage
    }
    if (m.role === 'assistant') {
      // Old chain-of-thought is dead weight on replay (official providers strip
      // it server-side; openai-compatible reasoning models may re-bill it) —
      // drop it, unless the message would end up empty.
      const kept = asParts.filter((part) => part.type !== 'reasoning')
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

/* ── compaction: summarize old turns when the history gets huge ──────────── */

/** Compact when the serialized history exceeds this many characters
 *  (~50-60k tokens for mixed CJK/EN — inside every provider's window). */
export const COMPACT_AT_CHARS = 150_000
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
