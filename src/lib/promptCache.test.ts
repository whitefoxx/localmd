import { describe, it, expect } from 'vitest'
import { withMovingBreakpoint } from './promptCache'
import type { ModelMessage } from 'ai'

type Rec = Record<string, unknown>
const cc = (m: ModelMessage): unknown =>
  ((m as Rec).providerOptions as Rec | undefined)?.anthropic &&
  (((m as Rec).providerOptions as Rec).anthropic as Rec).cacheControl

describe('withMovingBreakpoint', () => {
  it('marks only the last message', () => {
    const out = withMovingBreakpoint([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ])
    expect(cc(out[0])).toBeUndefined()
    expect(cc(out[1])).toBeUndefined()
    expect(cc(out[2])).toEqual({ type: 'ephemeral', ttl: '1h' })
  })

  it('moves an existing marker instead of accumulating (≤4 breakpoint limit)', () => {
    const marked = withMovingBreakpoint([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ])
    const next = withMovingBreakpoint([...marked, { role: 'user', content: 'c' }])
    expect(cc(next[1])).toBeUndefined() // previous marker stripped
    expect(cc(next[2])).toEqual({ type: 'ephemeral', ttl: '1h' })
  })

  it('preserves unrelated providerOptions while stripping', () => {
    const msg = {
      role: 'user',
      content: 'a',
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' }, other: 1 }, openai: { x: 2 } },
    } as unknown as ModelMessage
    const out = withMovingBreakpoint([msg, { role: 'assistant', content: 'b' }])
    const po = (out[0] as unknown as Rec).providerOptions as Rec
    expect((po.anthropic as Rec).cacheControl).toBeUndefined()
    expect((po.anthropic as Rec).other).toBe(1)
    expect((po.openai as Rec).x).toBe(2)
  })

  it('does not mutate the input messages', () => {
    const input: ModelMessage[] = [{ role: 'user', content: 'a' }]
    withMovingBreakpoint(input)
    expect((input[0] as unknown as Rec).providerOptions).toBeUndefined()
  })

  it('handles the empty history', () => {
    expect(withMovingBreakpoint([])).toEqual([])
  })
})
