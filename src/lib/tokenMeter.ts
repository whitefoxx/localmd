/**
 * How much context a session is carrying, in tokens rather than characters.
 *
 * The thresholds that drive trimming and compaction used to count serialized
 * characters, which is not a unit any provider bills in: 250k characters is
 * ~70k tokens of English and ~250k tokens of Chinese. One of those fits in a
 * context window. A Chinese session therefore compacted far later than
 * intended — or blew the window before the backstop ever fired.
 *
 * A character heuristic alone cannot fix that, because the two things it
 * cannot see are exactly the two that matter: the real tokenizer, and the
 * system prompt plus tool schemas riding in front of every request. So the
 * measurement is ANCHORED — after each turn the provider tells us, in
 * `usage.inputTokens`, precisely what the request cost, and everything
 * appended since is estimated on top of that number:
 *
 *     pressure = anchor.tokens + estimate(messages appended since)
 *
 * The heuristic only ever prices the tail, so its error stays bounded instead
 * of compounding over a long session. With no anchor (a fresh session, or
 * right after history was rewritten) it prices everything and is simply the
 * old behavior in the right unit.
 *
 * The prefix turns out to dominate: measured against a real KB, anchored
 * pressure was 21.1k tokens where the history itself was 1.2k. That is why the
 * two thresholds read different numbers. Trimming can only shrink history, so
 * it is decided on `estimateTokens(history)`; compaction exists to keep the
 * whole request inside the context window, so it is decided on anchored
 * `measureTokens`. Handing trim the total would let a constant it cannot
 * reduce trigger it forever.
 */
import { serializeForSizing } from '@/lib/history'

/**
 * A provider-reported measurement of a session's history at one point.
 *
 * Runtime-only, never persisted: an anchor describes an exact `history` array,
 * and re-earning one costs a single turn. See `anchorFromUsage` for how the
 * two numbers add up to "the whole history".
 */
export interface TokenAnchor {
  /** Provider-reported tokens covering the history through `atLength`. */
  tokens: number
  /** `history.length` when this was taken; later messages are estimated. */
  atLength: number
}

/* CJK ideographs, kana, hangul and fullwidth forms — roughly one token per
 * character. Everything else averages ~4 characters per token. Both are
 * deliberately conservative (they over-count slightly), because the failure
 * that matters is running hygiene too late, not too early. */
const CJK =
  /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯가-힯]/g

/** Heuristic token count for any serializable value. */
export function estimateTokens(value: unknown): number {
  const text = serializeForSizing(value)
  const cjk = text.match(CJK)?.length ?? 0
  return cjk + Math.ceil((text.length - cjk) / 4)
}

/**
 * Current context pressure: the anchor's measured tokens plus an estimate of
 * everything appended after it.
 *
 * Falls back to estimating the whole history when there is no anchor, or when
 * the history has shrunk below the anchor — the anchor is set in one place and
 * the history is rewritten in several, so a stale anchor must degrade to an
 * honest estimate rather than report a number from a history that no longer
 * exists.
 */
export function measureTokens(
  history: readonly unknown[],
  anchor?: TokenAnchor | null,
): number {
  if (!anchor || anchor.atLength > history.length) return estimateTokens(history)
  const tail = history.slice(anchor.atLength)
  // An empty tail costs nothing. Without this it costs the `[]` the serializer
  // emits, so an unchanged history would drift upward by a token per check.
  return anchor.tokens + (tail.length ? estimateTokens(tail) : 0)
}

/**
 * Build the anchor for a finished turn.
 *
 * `input` is the last step's complete prompt (every provider reports the
 * cached portion inside this total, not beside it) and `output` is the
 * assistant message that step produced and that was then appended — so the two
 * together price the history exactly as it now stands, system prompt and tool
 * schemas included. Usage the provider did not report yields no anchor.
 */
export function anchorFromUsage(
  usage: { input: number; output: number } | undefined,
  historyLength: number,
): TokenAnchor | undefined {
  if (!usage || usage.input <= 0) return undefined
  return { tokens: usage.input + usage.output, atLength: historyLength }
}

/**
 * Reprice an anchor after a trim rewrote history content in place.
 *
 * Discarding the anchor here would be wrong in a way that matters: the number
 * it holds is the only knowledge of the ~20k prompt-and-schemas prefix, and
 * compaction — which runs immediately after trim and exists to keep the whole
 * request inside the window — would then decide against a total missing that
 * prefix, firing ~20k late on exactly the sends where hygiene was needed.
 *
 * So the provider-measured baseline survives and the estimated size of what
 * was removed is subtracted from it, leaving the heuristic responsible only for
 * the delta. A trim preserves message count, so a length change means the
 * caller did something else and the anchor is dropped rather than trusted.
 */
export function anchorAfterShrink(
  anchor: TokenAnchor | undefined,
  before: readonly unknown[],
  after: readonly unknown[],
): TokenAnchor | undefined {
  if (!anchor || before.length !== after.length) return undefined
  const freed = estimateTokens(before) - estimateTokens(after)
  if (freed <= 0) return anchor
  return { ...anchor, tokens: Math.max(0, anchor.tokens - freed) }
}

/**
 * Trim when the HISTORY alone reaches this many tokens — compared against
 * `estimateTokens`, never against anchored pressure.
 *
 * Stubbing old tool results cannot shrink the system prompt or the tool
 * schemas, and those measured ~20k tokens of every request in a real KB (the
 * anchored total read 21.1k where the history was 1.2k). A trim threshold that
 * an irreducible constant already exceeds would fire on every send and free
 * nothing. 20k reproduces the old 60k-character trigger for English while
 * pricing every other language correctly.
 */
export const TRIM_AT_TOKENS = 20_000

/**
 * Compact when anchored request pressure reaches this many tokens — prompt and
 * tool schemas included, because unlike trimming, compaction exists to keep
 * the whole request inside the model's context window.
 *
 * ~70k of history (the old 250k-character trigger in English) plus the ~20k
 * prefix that trigger could not see, leaving room for the reply inside a 128k
 * window. Compaction is a summarizer call plus a full-prefix cache
 * invalidation, so it stays the rare backstop behind trimming — and unlike the
 * character threshold it cannot silently sail past a model's context because
 * the conversation happens to be in Chinese.
 */
export const COMPACT_AT_TOKENS = 90_000
