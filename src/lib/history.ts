/**
 * Conversation-history hygiene for long agent sessions. The wire history is
 * append-only and replayed every turn — old tool results (a read_file can be
 * 100k chars) and images dominate token cost while contributing little after
 * the model has acted on them. Before each send we TRIM: messages older than
 * the last `keepTurns` real user turns get their large tool results, images,
 * and large tool inputs replaced with short stubs. The model can always
 * re-run a tool if it genuinely needs the content again.
 *
 * Pure functions over both providers' history shapes; unit-tested.
 */
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta'
import type OpenAI from 'openai'

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

export interface TrimOptions {
  /** Recent real user turns to leave untouched. */
  keepTurns?: number
  /** Tool results / inputs above this length get stubbed. */
  maxChars?: number
}

const DEFAULTS: Required<TrimOptions> = { keepTurns: 2, maxChars: 1500 }

const stub = (chars: number) =>
  `[之前的工具结果已修剪(原 ${chars} 字符)——如仍需其内容,重新调用相应工具]`
const IMG_STUB = '[之前的图片已修剪——如需重看,调用 view_image]'
const INPUT_STUB = '[已修剪]'

/** Rough token estimate for threshold checks (CJK ≈1 token/char, EN ≈0.3). */
export function estimateChars(history: unknown): number {
  return JSON.stringify(history).length
}

/* ── Anthropic ───────────────────────────────────────────────────────────── */

type BetaBlock = { type: string; [k: string]: unknown }

function isRealUserTurn(m: BetaMessageParam): boolean {
  if (m.role !== 'user') return false
  if (typeof m.content === 'string') return true
  return !m.content.some((b) => (b as BetaBlock).type === 'tool_result')
}

/** Index of the first message that must stay untouched. */
function anthropicCutoff(history: BetaMessageParam[], keepTurns: number): number {
  let seen = 0
  for (let i = history.length - 1; i >= 0; i--) {
    if (isRealUserTurn(history[i])) {
      seen++
      if (seen >= keepTurns) return i
    }
  }
  return 0
}

function trimToolInput(input: unknown, maxChars: number): unknown {
  if (!input || typeof input !== 'object') return input
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = typeof v === 'string' && v.length > maxChars ? INPUT_STUB : v
  }
  return out
}

export function trimAnthropicHistory(
  history: BetaMessageParam[],
  opts: TrimOptions = {},
): BetaMessageParam[] {
  const { keepTurns, maxChars } = { ...DEFAULTS, ...opts }
  const cutoff = anthropicCutoff(history, keepTurns)
  return history.map((m, i) => {
    if (i >= cutoff || typeof m.content === 'string') return m
    const content = m.content.map((raw) => {
      const b = raw as BetaBlock
      if (b.type === 'image') return { type: 'text', text: IMG_STUB } as typeof raw
      if (b.type === 'tool_use') {
        return { ...b, input: trimToolInput(b.input, maxChars) } as typeof raw
      }
      if (b.type === 'tool_result') {
        const c = b.content
        if (typeof c === 'string' && c.length > maxChars) {
          return { ...b, content: stub(c.length) } as typeof raw
        }
        if (Array.isArray(c)) {
          const inner = c.map((ib: BetaBlock) => {
            if (ib.type === 'image') return { type: 'text', text: IMG_STUB }
            if (ib.type === 'text' && typeof ib.text === 'string' && ib.text.length > maxChars) {
              return { type: 'text', text: stub(ib.text.length) }
            }
            return ib
          })
          return { ...b, content: inner } as unknown as typeof raw
        }
      }
      return raw
    })
    return { ...m, content }
  })
}

/* ── OpenAI-compatible ───────────────────────────────────────────────────── */

type OaiPart = { type: string; text?: string; [k: string]: unknown }

function isInjectedImageMessage(m: OpenAIMessage): boolean {
  return (
    m.role === 'user' &&
    Array.isArray(m.content) &&
    (m.content[0] as OaiPart | undefined)?.type === 'text' &&
    ((m.content[0] as OaiPart).text ?? '').startsWith('(view_image')
  )
}

function isRealOpenAIUserTurn(m: OpenAIMessage): boolean {
  return m.role === 'user' && !isInjectedImageMessage(m)
}

function openaiCutoff(history: OpenAIMessage[], keepTurns: number): number {
  let seen = 0
  for (let i = history.length - 1; i >= 0; i--) {
    if (isRealOpenAIUserTurn(history[i])) {
      seen++
      if (seen >= keepTurns) return i
    }
  }
  return 0
}

export function trimOpenAIHistory(
  history: OpenAIMessage[],
  opts: TrimOptions = {},
): OpenAIMessage[] {
  const { keepTurns, maxChars } = { ...DEFAULTS, ...opts }
  const cutoff = openaiCutoff(history, keepTurns)
  return history.map((m, i) => {
    if (i >= cutoff) return m
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > maxChars) {
      return { ...m, content: stub(m.content.length) }
    }
    if (m.role === 'user' && Array.isArray(m.content)) {
      const content = (m.content as OaiPart[]).map((p) =>
        p.type === 'image_url' ? { type: 'text' as const, text: IMG_STUB } : p,
      )
      return { ...m, content } as OpenAIMessage
    }
    if (m.role === 'assistant' && m.tool_calls) {
      const tool_calls = m.tool_calls.map((tc) =>
        'function' in tc && tc.function.arguments.length > maxChars
          ? {
              ...tc,
              function: {
                ...tc.function,
                arguments: JSON.stringify({ trimmed: `原 ${tc.function.arguments.length} 字符` }),
              },
            }
          : tc,
      )
      return { ...m, tool_calls } as OpenAIMessage
    }
    return m
  })
}

/* ── compaction (A2): summarize old turns when the history gets huge ─────── */

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

function blockText(b: { type: string; [k: string]: unknown }): string {
  if (b.type === 'text') return String(b.text ?? '')
  if (b.type === 'image') return '[图片]'
  if (b.type === 'tool_use') return `[调用 ${b.name}: ${clip(JSON.stringify(b.input))}]`
  if (b.type === 'tool_result') {
    const c = b.content
    return `[工具结果: ${clip(typeof c === 'string' ? c : JSON.stringify(c))}]`
  }
  return ''
}

/** Plain-text transcript of Anthropic messages, for the summarizer. */
export function renderAnthropicTranscript(history: BetaMessageParam[]): string {
  const lines = history.map((m) => {
    const body =
      typeof m.content === 'string'
        ? m.content
        : m.content.map((b) => blockText(b as BetaBlock)).join(' ')
    return `${m.role === 'user' ? '用户' : '助手'}: ${body}`
  })
  const text = lines.join('\n')
  return text.length > TRANSCRIPT_CAP ? `${text.slice(0, TRANSCRIPT_CAP)}\n…[后续已截断]` : text
}

/** Plain-text transcript of OpenAI-compatible messages. */
export function renderOpenAITranscript(history: OpenAIMessage[]): string {
  const lines = history.map((m) => {
    if (m.role === 'tool') return `工具结果: ${clip(typeof m.content === 'string' ? m.content : '')}`
    let body = ''
    if (typeof m.content === 'string') body = m.content
    else if (Array.isArray(m.content)) {
      body = (m.content as OaiPart[]).map((p) => (p.type === 'text' ? (p.text ?? '') : '[图片]')).join(' ')
    }
    if (m.role === 'assistant' && m.tool_calls) {
      body += m.tool_calls
        .map((tc) => ('function' in tc ? ` [调用 ${tc.function.name}: ${clip(tc.function.arguments)}]` : ''))
        .join('')
    }
    return `${m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role}: ${body}`
  })
  const text = lines.join('\n')
  return text.length > TRANSCRIPT_CAP ? `${text.slice(0, TRANSCRIPT_CAP)}\n…[后续已截断]` : text
}

export interface Split<T> {
  old: T[]
  recent: T[]
}

/** Split history at the COMPACT_KEEP_TURNS-th-from-last real user turn.
 *  Returns null when there's nothing before that point to compact. */
export function splitAnthropicForCompaction(
  history: BetaMessageParam[],
  keepTurns = COMPACT_KEEP_TURNS,
): Split<BetaMessageParam> | null {
  const cutoff = anthropicCutoff(history, keepTurns)
  if (cutoff <= 0) return null
  return { old: history.slice(0, cutoff), recent: history.slice(cutoff) }
}

export function splitOpenAIForCompaction(
  history: OpenAIMessage[],
  keepTurns = COMPACT_KEEP_TURNS,
): Split<OpenAIMessage> | null {
  const cutoff = openaiCutoff(history, keepTurns)
  if (cutoff <= 0) return null
  return { old: history.slice(0, cutoff), recent: history.slice(cutoff) }
}

/** The message pair that replaces the compacted prefix. Both providers accept
 *  the same shape (user text + assistant ack keeps role alternation valid). */
export function compactedPrefix(summary: string): {
  user: string
  assistant: string
} {
  return {
    user: `[系统注入:以下是本会话较早部分的自动摘要,原始消息已移除以节省上下文]\n\n${summary}\n\n[摘要结束,请基于它与后续消息继续]`,
    assistant: '已了解之前的进展,继续。',
  }
}
