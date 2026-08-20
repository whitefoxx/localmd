import { describe, it, expect } from 'vitest'
import { pickStructure } from './build'
import type { PdfBlock } from './types'

function heading(page: number, level: number, text: string): PdfBlock {
  return { id: `b${page}-1`, page, kind: 'heading', level, text, rects: [] }
}
const NO_OUTLINE = { tree: [], flat: [] }

describe('pickStructure', () => {
  it('prefers an embedded outline over everything', () => {
    const outline = {
      tree: [],
      flat: [
        { title: 'One', level: 1, page: 1 },
        { title: 'Two', level: 1, page: 5 },
      ],
    }
    expect(pickStructure([], outline, 10).structure).toBe('outline')
  })

  it('splits on level-1 headings when they spread across pages', () => {
    const blocks = [heading(1, 1, 'Intro'), heading(5, 1, 'Methods')]
    const r = pickStructure(blocks, NO_OUTLINE, 10)
    expect(r.structure).toBe('headings')
    expect(r.boundaries.map((b) => b.title)).toEqual(['Intro', 'Methods'])
  })

  it('falls through to level 2 when level 1 is a single-page title', () => {
    // The measured paper: the only L1 is the title on page 1; the real
    // structure is its L2 section headings.
    const blocks = [
      heading(1, 1, 'A Great Paper About Things'),
      heading(1, 2, '1. Introduction'),
      heading(3, 2, '2. Related Work'),
      heading(7, 2, '3. Method'),
    ]
    const r = pickStructure(blocks, NO_OUTLINE, 12)
    expect(r.structure).toBe('headings')
    expect(r.boundaries.map((b) => b.title)).toEqual([
      '1. Introduction',
      '2. Related Work',
      '3. Method',
    ])
  })

  it('rejects a level whose heading count outruns the pages — noise, not structure', () => {
    const noisy = Array.from({ length: 40 }, (_, i) => heading((i % 4) + 1, 1, `frag ${i}`))
    const r = pickStructure(noisy, NO_OUTLINE, 4)
    expect(r.structure).toBe('pages')
  })

  it('ignores boilerplate and falls back to pages without usable headings', () => {
    const blocks: PdfBlock[] = [
      { id: 'b1-1', page: 1, kind: 'boilerplate', level: 0, text: 'Header', rects: [] },
      { id: 'b2-1', page: 2, kind: 'boilerplate', level: 0, text: 'Header', rects: [] },
    ]
    const r = pickStructure(blocks, NO_OUTLINE, 3)
    expect(r.structure).toBe('pages')
    expect(r.boundaries).toHaveLength(3)
  })
})
