/**
 * Lone surrogates — the one way an ordinary string makes a request unparseable
 * on the far side.
 *
 * JS strings are UTF-16 and `slice`/`substring` count code UNITS, so cutting a
 * string at a fixed length can land between the two halves of an astral
 * character (emoji, rare CJK, musical symbols). `JSON.stringify` faithfully
 * emits the orphaned half as `\ud83d`, and a strict JSON parser — Rust's
 * serde_json, which several providers run — rejects the whole body:
 * "unexpected end of hex escape". Nothing local catches it: the string is a
 * perfectly good JS value, typecheck and tests see nothing, and the failure
 * arrives as a bare provider 400 naming a byte column.
 *
 * Worse, it does not fail once. A clipped emoji that reaches a user message or
 * a tool result is written into the persisted history, so it replays on every
 * later turn: the session dies permanently at the point the bad character
 * entered, while a fresh session works fine.
 *
 * Two halves to the answer, and both are needed:
 *   - `clipText` truncates without ever making an orphan. Use it instead of
 *     `slice` wherever the length is a budget rather than a structural offset.
 *   - `dropLoneSurrogates*` removes one that arrived from somewhere we do not
 *     own — an MCP server, an extracted document, a session persisted before
 *     this module existed. Prevention cannot be complete, so the wire keeps a
 *     backstop (see agent/run.ts).
 */

/* A high surrogate not followed by a low one, or a low surrogate not preceded
 * by a high one. Anything matching is half a character that lost its other
 * half — there is no way to restore it, only to stop it travelling. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** Whether `text` carries a lone surrogate (i.e. would break a strict parser). */
export function hasLoneSurrogate(text: string): boolean {
  LONE_SURROGATE.lastIndex = 0
  return LONE_SURROGATE.test(text)
}

/** `text` with every lone surrogate removed. Returns the SAME string when
 *  there is nothing to fix — the common case by far, and callers on the
 *  request path depend on the identity to prove they changed no bytes. */
export function dropLoneSurrogates(text: string): string {
  return hasLoneSurrogate(text) ? text.replace(LONE_SURROGATE, '') : text
}

/**
 * Truncate to at most `maxChars` code units, never splitting a surrogate pair,
 * appending `ellipsis` when anything was dropped.
 *
 * The cut backs off by one unit rather than rounding up: `maxChars` is a
 * budget every caller picked as a ceiling, and honouring it exactly matters
 * more than keeping one emoji. `ellipsis` is not counted against the budget —
 * it is the marker that says the budget was hit, so callers can pass '' when
 * they append their own note.
 */
export function clipText(text: string, maxChars: number, ellipsis = '…'): string {
  if (text.length <= maxChars) return text
  const end = maxChars > 0 && isHighSurrogate(text.charCodeAt(maxChars - 1)) ? maxChars - 1 : maxChars
  return text.slice(0, end) + ellipsis
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/**
 * Every string inside `value`, cleaned of lone surrogates — for structures
 * (AI SDK messages, tool outputs) assembled from many sources.
 *
 * Returns `value` itself when nothing needed fixing, all the way down: the
 * request path runs this on the whole history every turn, and the prompt cache
 * is a prefix of BYTES, so a clean history must come out the other side
 * unchanged rather than merely equal. Only plain objects and arrays are walked;
 * anything else (typed arrays holding image bytes, Dates, class instances) is
 * passed through untouched.
 */
export function dropLoneSurrogatesDeep<T>(value: T): T {
  if (typeof value === 'string') return dropLoneSurrogates(value) as T
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map((v) => {
      const next = dropLoneSurrogatesDeep(v)
      if (next !== v) changed = true
      return next
    })
    return (changed ? out : value) as T
  }
  if (!isPlainObject(value)) return value
  let changed = false
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    const next = dropLoneSurrogatesDeep(v)
    if (next !== v) changed = true
    out[k] = next
  }
  return (changed ? out : value) as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
