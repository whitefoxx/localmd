/**
 * `sampling/createMessage` — localmd answering a question the EXTENSION asked
 * (docs/localmd-connect.md §14.4o). The parsing is where a malformed or
 * over-eager request has to be caught, since what arrives is shaped by another
 * codebase.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@/agent/model', () => ({ toLanguageModel: async () => ({ id: 'fake-model' }) }))

import {
  NO_MODEL_MESSAGE,
  handleSampling,
  parseSamplingAsk,
  runSampling,
} from '@/lib/connectSampling'
import type { LlmProfile } from '@/stores/settings'

const profile = {
  id: 'p1',
  label: 'Primary',
  provider: 'anthropic',
  apiKey: 'k',
  model: 'claude-sonnet-5',
} as unknown as LlmProfile

const userMsg = (text: string) => ({ role: 'user', content: { type: 'text', text } })

beforeEach(() => generateText.mockReset())

describe('parseSamplingAsk', () => {
  it('flattens the user turns and carries the system prompt', () => {
    const a = parseSamplingAsk({
      messages: [userMsg('first'), userMsg('second')],
      systemPrompt: 'be brief',
      maxTokens: 300,
    })
    expect(a).toEqual({ prompt: 'first\n\nsecond', system: 'be brief', maxTokens: 300 })
  })

  it('reads a content array as well as the single block the spec describes', () => {
    expect(
      parseSamplingAsk({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'a' },
              { type: 'image', data: 'x' },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      }).prompt,
    ).toBe('a\nb')
  })

  it('ignores assistant turns rather than inventing a conversation', () => {
    expect(
      parseSamplingAsk({
        messages: [userMsg('ask'), { role: 'assistant', content: { type: 'text', text: 'said' } }],
      }).prompt,
    ).toBe('ask')
  })

  it('refuses a request with nothing to answer', () => {
    expect(() => parseSamplingAsk({})).toThrow(/no user text/)
    expect(() => parseSamplingAsk({ messages: [userMsg('   ')] })).toThrow(/no user text/)
    expect(() => parseSamplingAsk(null)).toThrow(/no user text/)
  })

  it('bounds what one request may spend, whatever it asked for', () => {
    expect(parseSamplingAsk({ messages: [userMsg('x')] }).maxTokens).toBe(1200)
    expect(parseSamplingAsk({ messages: [userMsg('x')], maxTokens: 999_999 }).maxTokens).toBe(4000)
    expect(parseSamplingAsk({ messages: [userMsg('x')], maxTokens: -5 }).maxTokens).toBe(1200)
    const long = parseSamplingAsk({ messages: [userMsg('z'.repeat(50_000))] })
    expect(long.prompt.length).toBeLessThan(50_000)
    expect(long.prompt.endsWith('…')).toBe(true)
  })
})

describe('runSampling', () => {
  it('runs one bounded completion and answers in the MCP result shape', async () => {
    generateText.mockResolvedValue({ text: '  translated  ' })
    const r = await runSampling(profile, { prompt: 'p', system: 's', maxTokens: 500 })
    expect(r).toEqual({
      role: 'assistant',
      content: { type: 'text', text: 'translated' },
      model: 'claude-sonnet-5',
      stopReason: 'endTurn',
    })
    const args = generateText.mock.calls[0][0] as Record<string, unknown>
    expect(args.maxOutputTokens).toBe(500)
    expect(args.system).toBe('s')
    expect(args.messages).toEqual([{ role: 'user', content: 'p' }])
    // No tools, no history: a quick action is not the agent loop.
    expect(args.tools).toBeUndefined()
  })

  it('says so, in words a reader on a web page can act on, when no model is set up', async () => {
    await expect(runSampling(null, { prompt: 'p', maxTokens: 100 })).rejects.toThrow(
      NO_MODEL_MESSAGE,
    )
    expect(NO_MODEL_MESSAGE).toContain('Settings')
    expect(generateText).not.toHaveBeenCalled()
  })

  it('fails rather than answering with nothing', async () => {
    generateText.mockResolvedValue({ text: '   ' })
    await expect(runSampling(profile, { prompt: 'p', maxTokens: 100 })).rejects.toThrow(/no text/)
  })
})

describe('handleSampling', () => {
  it('is params in, result out — the whole binding the relay needs', async () => {
    generateText.mockResolvedValue({ text: 'done' })
    const r = await handleSampling(() => profile, { messages: [userMsg('hello')] })
    expect(r.content.text).toBe('done')
  })

  it('reports a missing model as the request failing, not as an empty answer', async () => {
    await expect(handleSampling(() => null, { messages: [userMsg('hello')] })).rejects.toThrow(
      NO_MODEL_MESSAGE,
    )
  })
})
