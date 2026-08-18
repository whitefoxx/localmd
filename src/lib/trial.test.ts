import { describe, it, expect, beforeAll } from 'vitest'
import { trialProfile } from './trial'

// The module reads `location` when it builds the profile; the test environment
// is node, so stand one up.
beforeAll(() => {
  ;(globalThis as { location?: unknown }).location = new URL('https://localmd.app/')
})

describe('trialProfile', () => {
  const session = { token: 'tok', expiresAt: Date.now() + 60_000, model: 'deepseek-chat' }

  // The regression this exists for: the profile used to carry `/api/trial/v1`,
  // and `@ai-sdk/openai-compatible` builds every request as
  // `new URL(`${baseURL}${path}`)` — no base, so a site-relative path throws
  // `Invalid URL` and the turn dies before a byte is sent. It was invisible to
  // anyone with their own API key, and broken for every visitor without one,
  // which is the entire point of the trial.
  it('hands the SDK a base URL that new URL() accepts on its own', () => {
    const { baseUrl } = trialProfile(session)
    expect(() => new URL(`${baseUrl}/chat/completions`)).not.toThrow()
    expect(new URL(`${baseUrl}/chat/completions`).pathname).toBe('/api/trial/v1/chat/completions')
  })

  it("stays on the page's own origin", () => {
    expect(new URL(trialProfile(session).baseUrl).origin).toBe('https://localmd.app')
  })

  it('is ephemeral, so the session token never reaches storage', () => {
    expect(trialProfile(session).ephemeral).toBe(true)
  })
})
