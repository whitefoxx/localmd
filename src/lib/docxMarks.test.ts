import { describe, it, expect } from 'vitest'
import { compareDocxRange, formatDocxRange, parseDocxRange } from './docxMarks'

/* The DOM half (selection → locator, locator → mark spans) is covered by the
   docx e2e spec; these are the parts that have to survive a round-trip through
   the sidecar JSON. */

describe('docx range locators', () => {
  it('round-trips through its sidecar form', () => {
    const range = { startBid: 'b1-3', startOffset: 10, endBid: 'b1-4', endOffset: 22 }
    expect(formatDocxRange(range)).toBe('b1-3:10~b1-4:22')
    expect(parseDocxRange('b1-3:10~b1-4:22')).toEqual(range)
  })

  it('rejects anything that is not a locator', () => {
    expect(parseDocxRange('epubcfi(/6/4!/4/2)')).toBeNull()
    expect(parseDocxRange('b1-3:10')).toBeNull()
    expect(parseDocxRange('b1-3:x~b1-4:2')).toBeNull()
    expect(parseDocxRange('')).toBeNull()
  })

  it('orders marks by block, then by offset within the block', () => {
    const sorted = [
      'b1-12:0~b1-12:5',
      'b1-2:40~b1-2:50',
      'b1-2:0~b1-3:8',
      'b2-1:0~b2-1:9',
    ].sort(compareDocxRange)
    expect(sorted).toEqual([
      'b1-2:0~b1-3:8', // block 2 before block 12 — numeric, not lexicographic
      'b1-2:40~b1-2:50',
      'b1-12:0~b1-12:5',
      'b2-1:0~b2-1:9',
    ])
  })

  it('sorts locators it cannot place last instead of throwing', () => {
    expect(['junk', 'b1-2:0~b1-2:1'].sort(compareDocxRange)).toEqual(['b1-2:0~b1-2:1', 'junk'])
  })
})
