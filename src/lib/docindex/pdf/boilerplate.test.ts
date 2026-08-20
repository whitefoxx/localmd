import { describe, it, expect } from 'vitest'
import { markBoilerplate, template } from './boilerplate'
import type { PdfBlock } from './types'

function block(page: number, y: number, text: string, kind: PdfBlock['kind'] = 'text'): PdfBlock {
  return {
    id: `b${page}-x`,
    page,
    kind,
    level: 0,
    text,
    rects: [{ x: 0.1, y, w: 0.8, h: 0.02 }],
  }
}

describe('template', () => {
  it('collapses digits so folios recur as one key', () => {
    expect(template('Page 12 of 43')).toBe('page # of #')
    expect(template('12')).toBe('#')
  })
  it('reads a pure roman numeral as a folio', () => {
    expect(template('iv')).toBe('#')
    expect(template('XII')).toBe('#')
    // ...but a word that merely uses those letters is not one.
    expect(template('civil')).toBe('civil')
  })
})

describe('markBoilerplate', () => {
  it('marks a running header recurring across pages, and the folios', () => {
    const blocks = [1, 2, 3, 4].flatMap((p) => [
      block(p, 0.05, 'The Walt Disney Company'),
      block(p, 0.3, `Real content of page ${p}, different everywhere.`),
      block(p, 0.95, String(p)),
    ])
    const marked = markBoilerplate(blocks, 4)
    expect(marked.filter((b) => b.kind === 'boilerplate')).toHaveLength(8)
    expect(marked.filter((b) => b.text.startsWith('Real content'))
      .every((b) => b.kind === 'text')).toBe(true)
  })

  it('never marks text that also lives outside the band — fragmented body text', () => {
    // The measured trap: a degenerate document fragments into single-word
    // blocks, so "the" sits at the bottom of many pages — but "the" is all
    // over the middle of the page too, which no running header ever is.
    const blocks = [1, 2, 3, 4].flatMap((p) => [
      block(p, 0.4, 'the'),
      block(p, 0.5, 'the'),
      block(p, 0.6, 'the'),
      block(p, 0.9, 'the'),
    ])
    const marked = markBoilerplate(blocks, 4)
    expect(marked.every((b) => b.kind === 'text')).toBe(true)
  })

  it('re-kinds a false heading that is really a running header', () => {
    const blocks = [1, 2, 3].flatMap((p) => [
      block(p, 0.04, 'CHAPTER ONE — LECTURES', 'heading'),
      block(p, 0.4, `body ${p}`),
    ])
    const marked = markBoilerplate(blocks, 3)
    expect(marked.filter((b) => b.kind === 'boilerplate')).toHaveLength(3)
  })

  it('leaves mid-page repetition alone, and short documents alone', () => {
    const mid = [1, 2, 3, 4].map((p) => block(p, 0.5, 'repeated pull-quote'))
    expect(markBoilerplate(mid, 4).every((b) => b.kind === 'text')).toBe(true)
    const short = [1, 2].map((p) => block(p, 0.05, 'Header'))
    expect(markBoilerplate(short, 2).every((b) => b.kind === 'text')).toBe(true)
  })

  it('keeps a heading that merely sits near the top of its own pages', () => {
    // Three DIFFERENT chapter titles at the top of three pages: no shared
    // template, so nothing recurs, so nothing is marked.
    const blocks = [
      block(1, 0.05, 'Introduction', 'heading'),
      block(2, 0.05, 'Methods', 'heading'),
      block(3, 0.05, 'Results', 'heading'),
    ]
    expect(markBoilerplate(blocks, 3).every((b) => b.kind === 'heading')).toBe(true)
  })
})
