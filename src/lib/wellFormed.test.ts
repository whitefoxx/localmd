import { describe, it, expect } from 'vitest'
import {
  clipText,
  dropLoneSurrogates,
  dropLoneSurrogatesDeep,
  hasLoneSurrogate,
} from './wellFormed'

/* The real one: a chat reply's opening line, clipped to 60 units for a quote
 * card, cutting 💬 (U+1F4AC) in half — DeepSeek answered
 * "messages[10].content: unexpected end of hex escape". */
const REPLY = '今天（2026-08-19）HN 前 30 热点，按热度排序如下： | # | 标题 | 看点/领域 | ⭐ 分 | 💬 评论 |'

describe('hasLoneSurrogate', () => {
  it('passes ordinary text, including whole astral characters', () => {
    expect(hasLoneSurrogate('plain ascii')).toBe(false)
    expect(hasLoneSurrogate('中文和 emoji 💬🔥⭐')).toBe(false)
    expect(hasLoneSurrogate('')).toBe(false)
  })

  it('catches either half left on its own', () => {
    expect(hasLoneSurrogate('cut here \ud83d')).toBe(true) // high, no low
    expect(hasLoneSurrogate('\udcac trailing half')).toBe(true) // low, no high
  })

  it('is not confused by repeated calls (no lastIndex carry-over)', () => {
    const bad = 'x\ud83d'
    expect(hasLoneSurrogate(bad)).toBe(true)
    expect(hasLoneSurrogate(bad)).toBe(true)
  })

  it('sees a lone half sitting next to a valid pair', () => {
    expect(hasLoneSurrogate('💬\ud83d')).toBe(true)
    expect(hasLoneSurrogate('\ud83d💬')).toBe(true)
  })
})

describe('dropLoneSurrogates', () => {
  it('returns the same string when there is nothing to fix', () => {
    const s = 'nothing to do 💬'
    expect(dropLoneSurrogates(s)).toBe(s)
  })

  it('removes the orphan and leaves the rest', () => {
    expect(dropLoneSurrogates('分 | \ud83d')).toBe('分 | ')
    expect(dropLoneSurrogates('\udcac 评论')).toBe(' 评论')
  })

  it('keeps whole pairs around the orphan', () => {
    expect(dropLoneSurrogates('🔥\ud83d💬')).toBe('🔥💬')
  })

  it('makes the result survive a strict JSON round-trip', () => {
    const broken = REPLY.slice(0, 60)
    expect(() => JSON.parse(JSON.stringify(broken))).not.toThrow() // JS is lenient…
    expect(hasLoneSurrogate(broken)).toBe(true) // …but the wire is not
    expect(hasLoneSurrogate(dropLoneSurrogates(broken))).toBe(false)
  })
})

describe('clipText', () => {
  it('leaves a string that fits alone, with no ellipsis', () => {
    expect(clipText('short', 10)).toBe('short')
    expect(clipText('exactly10!', 10)).toBe('exactly10!')
  })

  it('never splits a surrogate pair at the budget', () => {
    const out = clipText(REPLY, 60)
    expect(hasLoneSurrogate(out)).toBe(false)
    expect(out.endsWith('…')).toBe(true)
    // 💬 sat across units 59-60, so the cut backs off to 59 rather than
    // keeping half of it — or rounding up past the caller's budget.
    expect(out).toBe(`${REPLY.slice(0, 59)}…`)
  })

  it('keeps a pair that ends exactly on the budget', () => {
    const s = 'ab💬cd'
    expect(clipText(s, 4)).toBe('ab💬…')
    expect(hasLoneSurrogate(clipText(s, 4))).toBe(false)
  })

  it('honours the budget as a ceiling', () => {
    for (let n = 1; n <= REPLY.length; n++) {
      const out = clipText(REPLY, n, '')
      expect(out.length).toBeLessThanOrEqual(n)
      expect(hasLoneSurrogate(out)).toBe(false)
    }
  })

  it('takes a custom or empty ellipsis', () => {
    expect(clipText('abcdef', 3, '')).toBe('abc')
    expect(clipText('abcdef', 3, ' [more]')).toBe('abc [more]')
  })

  it('handles a zero budget', () => {
    expect(clipText('💬', 0, '')).toBe('')
  })
})

describe('dropLoneSurrogatesDeep', () => {
  it('returns the very same object when the whole structure is clean', () => {
    const messages = [
      { role: 'user', content: 'hello 💬' },
      { role: 'assistant', content: [{ type: 'text', text: 'hi 🔥' }] },
    ]
    expect(dropLoneSurrogatesDeep(messages)).toBe(messages)
  })

  it('rebuilds only along the path to the broken string', () => {
    const clean = { role: 'user', content: 'fine' }
    const messages = [clean, { role: 'user', content: 'quoted: \ud83d' }]
    const out = dropLoneSurrogatesDeep(messages)
    expect(out).not.toBe(messages)
    expect(out[0]).toBe(clean) // untouched branches keep their identity
    expect(out[1].content).toBe('quoted: ')
  })

  it('reaches strings nested in parts and tool outputs', () => {
    const out = dropLoneSurrogatesDeep({
      role: 'tool',
      content: [{ type: 'tool-result', output: { type: 'text', value: 'result \ud83d' } }],
    })
    expect(out.content[0].output.value).toBe('result ')
  })

  it('passes non-plain values through untouched', () => {
    const bytes = new Uint8Array([0xd8, 0x3d])
    const when = new Date(0)
    const out = dropLoneSurrogatesDeep({ bytes, when, n: 1, ok: true, nothing: null })
    expect(out.bytes).toBe(bytes)
    expect(out.when).toBe(when)
    expect(out.n).toBe(1)
    expect(out.nothing).toBe(null)
  })
})
