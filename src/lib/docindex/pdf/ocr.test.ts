import { describe, it, expect } from 'vitest'
import { linesFrom, type TessResult } from './ocr'

/** A recognised line at the scale ocr.ts renders at (3.5×). */
function line(text: string, confidence = 90, y = 350) {
  return { text, confidence, bbox: { x0: 350, y0: y, x1: 1750, y1: y + 56 } }
}

/** The v7 shape: blocks → paragraphs → lines. */
function result(...lines: ReturnType<typeof line>[]): TessResult {
  return { blocks: [{ paragraphs: [{ lines }] }] }
}

describe('linesFrom', () => {
  it('reads lines nested under blocks and paragraphs', () => {
    expect(linesFrom(result(line('hello'))).map((l) => l.text)).toEqual(['hello'])
  })

  // The failure this guards is silent and total: reading a flat `data.lines`
  // (the pre-7 shape) yields undefined, so a perfectly recognised page arrives
  // as zero lines and reads as a blank scan.
  it('ignores a flat lines array — that is not where they live', () => {
    expect(linesFrom({ lines: [line('hello')] } as unknown as TessResult)).toEqual([])
  })

  it('survives a result with no blocks at all', () => {
    expect(linesFrom({})).toEqual([])
    expect(linesFrom({ blocks: null })).toEqual([])
    expect(linesFrom({ blocks: [{}] })).toEqual([])
  })

  it('undoes the render scale, so geometry comes back in PDF points', () => {
    const [l] = linesFrom(result(line('hello')))
    expect(l.x0).toBe(100)
    expect(l.x1).toBe(500)
    expect(l.yTop).toBe(100)
    expect(l.fontH).toBe(16)
  })

  it('drops low-confidence lines — a wrong quotation is worse than none', () => {
    expect(linesFrom(result(line('noise', 40), line('real', 80)))).toHaveLength(1)
  })

  it('drops lines that recognised to nothing but whitespace', () => {
    expect(linesFrom(result(line('   \n  ')))).toEqual([])
  })

  // Tesseract segments Chinese per glyph and rejoins with spaces.
  it('closes the gaps between CJK characters', () => {
    const [l] = linesFrom(result(line('起 始 情 境 。')))
    expect(l.text).toBe('起始情境。')
  })

  it('keeps the space where one side is not CJK', () => {
    const [l] = linesFrom(result(line('用 GPT 写')))
    expect(l.text).toBe('用 GPT 写')
  })

  it('collapses runs of whitespace in Latin text without gluing words', () => {
    const [l] = linesFrom(result(line('the   quick \n brown')))
    expect(l.text).toBe('the quick brown')
  })
})
