/**
 * Conversation-history hygiene for long agent sessions. The wire history is
 * append-only and replayed every turn — old tool results (a read_file can be
 * 100k chars) and images dominate token cost while contributing little after
 * the model has acted on them. Before each send we TRIM: messages older than
 * the last `keepTurns` real user turns get their large tool results, images,
 * and large tool-call inputs replaced with short stubs. The model can always
 * re-run a tool if it genuinely needs the content again.
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

/** Rough token estimate for threshold checks (CJK ≈1 token/char, EN ≈0.3). */
export function estimateChars(history: unknown): number {
  return JSON.stringify(history).length
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
      const content = asParts.map((part) =>
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
