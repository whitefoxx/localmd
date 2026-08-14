import { describe, it, expect } from 'vitest'
import { isContextOverflow } from './providerError'

describe('isContextOverflow', () => {
  it('recognises the real wording of each provider we ship', () => {
    const real = [
      // OpenAI / DeepSeek / xAI (openai-compatible)
      "This model's maximum context length is 128000 tokens. However, your messages resulted in 131204 tokens. Please reduce the length of the messages.",
      { data: { error: { code: 'context_length_exceeded', message: 'too long' } } },
      // Anthropic
      'prompt is too long: 209431 tokens > 200000 maximum',
      // Google
      'The input token count (1051234) exceeds the maximum number of tokens allowed',
      // Groq
      'Request too large for model with 8192 max total tokens',
    ]
    for (const err of real) expect(isContextOverflow(err)).toBe(true)
  })

  it('finds the wording wherever the SDK put it', () => {
    expect(isContextOverflow({ message: 'API error', responseBody: 'context_length_exceeded' })).toBe(true)
    expect(isContextOverflow({ message: 'wrapped', cause: { message: 'prompt is too long' } })).toBe(true)
  })

  it('does NOT claim overflow for anything else that fails', () => {
    // The costly mistake: retrying these wastes a turn and hides the real
    // problem. A bare 400 especially — providers use it for malformed
    // requests too, and those must never be silently retried.
    const others = [
      { message: 'Bad Request', statusCode: 400 },
      { message: 'Incorrect API key provided', statusCode: 401 },
      { message: 'Rate limit reached for requests', statusCode: 429 },
      { message: 'The server had an error processing your request', statusCode: 500 },
      { message: 'Failed to fetch' },
      { message: 'tool call arguments were invalid JSON' },
      new Error('AbortError'),
    ]
    for (const err of others) expect(isContextOverflow(err)).toBe(false)
  })

  it('survives junk without throwing', () => {
    for (const junk of [null, undefined, '', 0, [], {}, { message: 123 }]) {
      expect(isContextOverflow(junk)).toBe(false)
    }
  })

  it('terminates on a cause cycle instead of blowing the stack', () => {
    // Classifying an error must never itself throw — that would replace a
    // reportable failure with an unreportable one.
    const a: Record<string, unknown> = { message: 'boom' }
    const b: Record<string, unknown> = { message: 'bang', cause: a }
    a.cause = b // two-error cycle: an identity check would not stop this
    expect(isContextOverflow(a)).toBe(false)

    const self: Record<string, unknown> = { message: 'loop' }
    self.cause = self
    expect(isContextOverflow(self)).toBe(false)
  })

  it('still finds the wording through several layers of wrapping', () => {
    const deep = { message: 'a', cause: { message: 'b', cause: { message: 'prompt is too long' } } }
    expect(isContextOverflow(deep)).toBe(true)
  })
})
