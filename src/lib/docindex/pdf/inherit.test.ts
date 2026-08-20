import { describe, it, expect } from 'vitest'
import { inheritIds, overlap, type PriorEntry } from './inherit'
import type { NormRect, PdfBlock } from './types'

/** A one-line rect at vertical position `y` (page-normalized units). */
function line(y: number, x = 0.1, w = 0.8, h = 0.02): NormRect {
  return { x, y, w, h }
}

/** A body-text block on `page` spanning `lines` consecutive lines from `y`. */
function block(id: string, page: number, y: number, lines = 3): PdfBlock {
  return {
    id,
    page,
    kind: 'text',
    level: 0,
    text: `text at ${y}`,
    rects: Array.from({ length: lines }, (_, i) => line(y + i * 0.025)),
  }
}

function prior(...blocks: PdfBlock[]): Record<string, PriorEntry> {
  const out: Record<string, PriorEntry> = {}
  for (const b of blocks) out[b.id] = { page: b.page, rects: b.rects }
  return out
}

describe('overlap', () => {
  it('is 1 for identical rect sets and 0 for disjoint ones', () => {
    const a = [line(0.1), line(0.125)]
    expect(overlap(a, a)).toBe(1)
    expect(overlap(a, [line(0.5)])).toBe(0)
  })

  it('treats containment as full overlap — a split half still scores 1', () => {
    const whole = [line(0.1), line(0.125), line(0.15), line(0.175)]
    const half = [line(0.1), line(0.125)]
    expect(overlap(half, whole)).toBeCloseTo(1)
  })

  it('is 0 when either set has no area', () => {
    expect(overlap([], [line(0.1)])).toBe(0)
  })
})

describe('inheritIds — the invariant: a published id never moves to different text', () => {
  it('is the identity without a prior record (first build, changed source)', () => {
    const blocks = [block('b1-1', 1, 0.1), block('b1-2', 1, 0.3)]
    const r = inheritIds(blocks, null)
    expect(r.blocks).toBe(blocks)
    expect(Object.keys(r.locations).sort()).toEqual(['b1-1', 'b1-2'])
  })

  it('is a no-op when the algorithm did not change (forced rebuild)', () => {
    const blocks = [block('b1-1', 1, 0.1), block('b1-2', 1, 0.3), block('b2-1', 2, 0.1)]
    const r = inheritIds(blocks, prior(...blocks))
    expect(r.blocks.map((b) => b.id)).toEqual(['b1-1', 'b1-2', 'b2-1'])
    expect(r.locations).toEqual(prior(...blocks))
  })

  it('keeps ids on their passages when a rebuild drops a block (boilerplate removed)', () => {
    // Old build: header (b1-1), paragraph (b1-2). New build drops the header.
    const old = [block('b1-1', 1, 0.02, 1), block('b1-2', 1, 0.2)]
    const now = [block('b1-1', 1, 0.2)] // positional numbering shifted!
    const r = inheritIds(now, prior(...old))
    // The paragraph keeps its published name...
    expect(r.blocks[0].id).toBe('b1-2')
    // ...and the header's id still resolves, carried forward verbatim.
    expect(r.locations['b1-1']).toEqual({ page: 1, rects: old[0].rects })
  })

  it('gives a split block one inherited id (where the passage begins) and one fresh id', () => {
    const old = [block('b3-1', 3, 0.1, 6)]
    const now = [block('b3-1', 3, 0.1, 3), block('b3-2', 3, 0.175, 3)]
    const r = inheritIds(now, prior(...old))
    expect(r.blocks[0].id).toBe('b3-1')
    // The second half must NOT take b3-2 — that name was never published for
    // this passage... it was never published at all, so it is fair game only
    // if it is genuinely fresh. Here the page's high-water is 1, so it is.
    expect(r.blocks[1].id).toBe('b3-2')
  })

  it('never recycles an ordinal that was ever published on the page', () => {
    // Old build had b1-1..b1-3; new build groups the page into two blocks.
    const old = [block('b1-1', 1, 0.1), block('b1-2', 1, 0.3), block('b1-3', 1, 0.5)]
    const now = [block('b1-1', 1, 0.7), block('b1-2', 1, 0.9, 2)]
    // Neither new block overlaps any old one (page content re-classified).
    const r = inheritIds(now, prior(...old))
    // Fresh names start ABOVE the high-water mark — 1..3 are taken forever.
    expect(r.blocks.map((b) => b.id)).toEqual(['b1-4', 'b1-5'])
    // And every published id still resolves to its original coordinates.
    for (const b of old) expect(r.locations[b.id]).toEqual({ page: 1, rects: b.rects })
  })

  it('merges: one id inherited, the other carried pointing into the merged block', () => {
    const old = [block('b2-1', 2, 0.1, 3), block('b2-2', 2, 0.175, 3)]
    const now = [block('b2-1', 2, 0.1, 6)]
    const r = inheritIds(now, prior(...old))
    expect(r.blocks[0].id).toBe('b2-1')
    // b2-2's coordinates are inside the merged block — the jump still lands.
    expect(r.locations['b2-2']).toEqual({ page: 2, rects: old[1].rects })
  })

  it('never matches across pages, whatever the geometry says', () => {
    const old = [block('b1-1', 1, 0.1)]
    const now = [block('b2-1', 2, 0.1)] // same rects, different page
    const r = inheritIds(now, prior(...old))
    expect(r.blocks[0].id).toBe('b2-1')
    expect(r.locations['b1-1']).toEqual({ page: 1, rects: old[0].rects })
  })

  it('carries foreign-looking ids without letting them join matching', () => {
    const old = prior(block('b1-1', 1, 0.1))
    old['weird-id'] = { page: 1, rects: [line(0.1)] }
    const r = inheritIds([block('b1-1', 1, 0.1)], old)
    expect(r.blocks[0].id).toBe('b1-1')
    expect(r.locations['weird-id']).toEqual(old['weird-id'])
  })

  it('property: prior keys are always a subset of the result, and block ids never collide', () => {
    // A messy rebuild: drops, splits, merges and new content all at once.
    const old = [
      block('b1-1', 1, 0.05, 1),
      block('b1-2', 1, 0.2, 6),
      block('b1-3', 1, 0.6),
      block('b2-1', 2, 0.1),
    ]
    const now = [
      block('x1', 1, 0.2, 3),
      block('x2', 1, 0.275, 3),
      block('x3', 1, 0.6),
      block('x4', 1, 0.9),
      block('x5', 2, 0.1),
      block('x6', 2, 0.5),
    ]
    const r = inheritIds(now, prior(...old))
    for (const id of Object.keys(prior(...old))) expect(r.locations[id]).toBeDefined()
    const ids = r.blocks.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const b of r.blocks) {
      expect(b.id.startsWith(`b${b.page}-`)).toBe(true)
      expect(r.locations[b.id]).toEqual({ page: b.page, rects: b.rects })
    }
  })
})
