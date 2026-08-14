import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  measureTokens,
  anchorFromUsage,
  anchorAfterShrink,
  TRIM_AT_TOKENS,
  COMPACT_AT_TOKENS,
} from './tokenMeter'

const msg = (text: string) => ({ role: 'user', content: text })

describe('estimateTokens', () => {
  it('prices CJK far higher per character than Latin', () => {
    // The whole reason this module exists: these two strings are the same
    // LENGTH and nowhere near the same cost, which is what the old character
    // thresholds could not tell apart. Measured on bare strings so the
    // JSON wrapper's fixed overhead does not dilute the ratio.
    const cjk = estimateTokens('检查知识库健康度孤儿页断链缺失索引项内容矛盾一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉')
    const latin = estimateTokens('a'.repeat(48))
    expect(cjk / latin).toBeGreaterThan(3)
  })

  it('counts a base64 payload as a marker, not as its length', () => {
    const big = { role: 'user', content: [{ type: 'image', image: 'A'.repeat(400_000) }] }
    expect(estimateTokens(big)).toBeLessThan(100)
  })

  it('grows with content', () => {
    expect(estimateTokens([msg('hello')])).toBeLessThan(estimateTokens([msg('hello'), msg('world')]))
  })
})

describe('measureTokens', () => {
  const history = [msg('one'), msg('two'), msg('three')]

  it('estimates everything when there is no anchor', () => {
    expect(measureTokens(history)).toBe(estimateTokens(history))
    expect(measureTokens(history, null)).toBe(estimateTokens(history))
  })

  it('adds only the tail beyond the anchor to the measured number', () => {
    const anchor = { tokens: 5_000, atLength: 2 }
    expect(measureTokens(history, anchor)).toBe(5_000 + estimateTokens([msg('three')]))
  })

  it('is exactly the anchor when nothing was appended after it', () => {
    expect(measureTokens(history, { tokens: 5_000, atLength: 3 })).toBe(5_000)
  })

  it('falls back to estimating when the history shrank below the anchor', () => {
    // A rewrite (trim/compaction/branch) that forgot to clear the anchor must
    // degrade to an honest number, never report the vanished history's size.
    const stale = { tokens: 900_000, atLength: 9 }
    expect(measureTokens(history, stale)).toBe(estimateTokens(history))
  })
})

describe('anchorFromUsage', () => {
  it('sums the last prompt and its reply — together they are the whole history', () => {
    expect(anchorFromUsage({ input: 12_000, output: 400 }, 7)).toEqual({
      tokens: 12_400,
      atLength: 7,
    })
  })

  it('yields no anchor when the provider reported nothing usable', () => {
    expect(anchorFromUsage(undefined, 3)).toBeUndefined()
    expect(anchorFromUsage({ input: 0, output: 0 }, 3)).toBeUndefined()
  })
})

describe('anchorAfterShrink', () => {
  const before = [msg('a'.repeat(4_000)), msg('keep')]
  const after = [msg('[trimmed]'), msg('keep')]

  it('subtracts what the trim removed and keeps the baseline', () => {
    const freed = estimateTokens(before) - estimateTokens(after)
    const repriced = anchorAfterShrink({ tokens: 22_000, atLength: 2 }, before, after)
    expect(repriced).toEqual({ tokens: 22_000 - freed, atLength: 2 })
  })

  it('keeps the prefix knowledge a discard would have thrown away', () => {
    // The regression this exists for: after a trim, compaction decides on the
    // anchored total. Dropping the anchor makes that total lose the ~20k
    // prompt-and-schemas prefix, so compaction fires far too late.
    const repriced = anchorAfterShrink({ tokens: 22_000, atLength: 2 }, before, after)
    expect(measureTokens(after, repriced)).toBeGreaterThan(20_000)
    expect(measureTokens(after)).toBeLessThan(1_000)
  })

  it('leaves the anchor alone when nothing was freed', () => {
    const anchor = { tokens: 22_000, atLength: 2 }
    expect(anchorAfterShrink(anchor, before, before)).toEqual(anchor)
  })

  it('drops the anchor when the message count changed', () => {
    // Only a trim (which preserves count) may reprice. Anything else rewrote
    // the history differently and the positions no longer line up.
    expect(anchorAfterShrink({ tokens: 22_000, atLength: 2 }, before, [msg('one')])).toBeUndefined()
  })

  it('never goes negative', () => {
    const repriced = anchorAfterShrink({ tokens: 5, atLength: 2 }, before, after)
    expect(repriced!.tokens).toBe(0)
  })

  it('has nothing to reprice without an anchor', () => {
    expect(anchorAfterShrink(undefined, before, after)).toBeUndefined()
  })
})

describe('thresholds', () => {
  // These are NOT two points on one scale: TRIM_AT_TOKENS is compared against
  // the history alone (all a trim can shrink) and COMPACT_AT_TOKENS against
  // anchored pressure including the ~20k prompt-and-schemas prefix. Do not
  // "unify" them onto one measurement — see stores/chat.ts for why.
  it('keeps trimming well below compaction', () => {
    // Trim is routine hygiene; compaction is a summarizer call plus a
    // full-prefix cache invalidation. Inverting these would make the expensive
    // path the common one.
    expect(TRIM_AT_TOKENS).toBeLessThan(COMPACT_AT_TOKENS)
  })

  it('leaves the compaction backstop inside a small model context window', () => {
    // Room for the reply too — a backstop that only trips once the request has
    // already been rejected is not a backstop.
    expect(COMPACT_AT_TOKENS).toBeLessThan(128_000)
  })
})
