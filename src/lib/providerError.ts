/**
 * Recognising the one provider failure the app can do something about:
 * the request did not fit in the model's context window.
 *
 * Every other error is the caller's to report. This one has a repair — drop
 * the bulk the turn accumulated and ask again — so it needs telling apart from
 * a bad key, a dead endpoint, or a rate limit, none of which retrying helps.
 *
 * Deliberately CONSERVATIVE. A false positive costs a pointless prune and one
 * retry; a false negative just leaves today's behaviour (the turn fails with
 * the provider's own message). So this matches only wording that says, in so
 * many words, that the input was too large — never a bare 400, which every
 * provider also returns for malformed requests we must not silently retry.
 */

/* Each provider phrases it differently and none of them promise stability, so
 * this is a list of observed spellings rather than a protocol:
 *   OpenAI / DeepSeek / Groq / xAI  `context_length_exceeded`,
 *                                   "maximum context length … tokens"
 *   Anthropic                       "prompt is too long: N tokens > M maximum"
 *   Google                          "input token count … exceeds the maximum"
 *   several                         "request too large", "too many tokens" */
const OVERFLOW_PATTERNS: readonly RegExp[] = [
  /context[_\s-]?length[_\s-]?exceeded/i,
  /maximum context length/i,
  /context window/i,
  /prompt is too long/i,
  /input (?:is )?too long/i,
  /request too large/i,
  /too many (?:input )?tokens/i,
  /exceeds? the maximum (?:number of )?(?:input )?tokens/i,
  /token count.{0,40}exceeds/i,
  /reduce the length of the (?:messages|prompt|input)/i,
]

/** Every string an error might be hiding its reason in. `depth` bounds the
 *  `cause` walk: identity checks do not stop a two-error cycle, and a
 *  stack overflow while classifying an error would replace a reportable
 *  failure with an unreportable one. */
function errorText(err: unknown, depth = 3): string {
  if (!err || typeof err !== 'object') return String(err ?? '')
  const e = err as {
    message?: unknown
    responseBody?: unknown
    data?: unknown
    cause?: unknown
  }
  const parts = [
    typeof e.message === 'string' ? e.message : '',
    typeof e.responseBody === 'string' ? e.responseBody : '',
    // `data` is the parsed error envelope on an APICallError; providers put the
    // useful wording in `error.message` or `error.code` inside it.
    e.data ? safeJson(e.data) : '',
    // The SDK wraps a provider error in its own, sometimes more than once.
    depth > 0 && e.cause ? errorText(e.cause, depth - 1) : '',
  ]
  return parts.filter(Boolean).join(' ')
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

/**
 * Whether this failure means "the request was too big for the context window".
 *
 * @param err - the error a provider call rejected or streamed.
 * @returns true only when the wording says the input was too large.
 */
export function isContextOverflow(err: unknown): boolean {
  const text = errorText(err)
  if (!text) return false
  return OVERFLOW_PATTERNS.some((re) => re.test(text))
}
