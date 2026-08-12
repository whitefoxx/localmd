/**
 * Page-layout reading, on synthetic geometry.
 *
 * These are the functions that decide what a "line" and a "paragraph" are, and
 * every citation in the app points at their output — but they were reachable
 * only through pdf.js and a real PDF, so nothing checked them. The geometry is
 * what matters, not the glyphs, so it can be written by hand: items carry a
 * bottom-left origin, `transform[4]` is x and `transform[5]` the baseline,
 * exactly as pdf.js hands them over.
 */
import { describe, it, expect } from 'vitest'
import { layoutPage, place, bandLines, groupBlocks, boundsOf, joinLines } from './layout'

const PAGE_H = 800

/** One glyph run. `y` is the baseline, measured up from the page bottom. */
function item(str: string, x: number, y: number, w: number, h = 10) {
  return { str, transform: [h, 0, 0, h, x, y], width: w, height: h }
}

function line(over: Partial<ReturnType<typeof mkLine>> = {}) {
  return { ...mkLine(), ...over }
}
function mkLine() {
  return { x0: 50, x1: 280, yTop: 100, fontH: 10, text: 'x' }
}

describe('bandLines', () => {
  it('keeps a superscript on the line it belongs to', () => {
    // A footnote marker sits on a raised baseline; grouping by baseline alone
    // would make it a one-glyph line of its own.
    const lines = bandLines(place([item('body text', 50, 700, 100), item('3', 152, 704, 4, 6)]))
    expect(lines).toHaveLength(1)
    expect(lines[0].items).toHaveLength(2)
  })

  it('separates lines that do not overlap vertically', () => {
    const lines = bandLines(place([item('one', 50, 700, 100), item('two', 50, 680, 100)]))
    expect(lines).toHaveLength(2)
  })
})

describe('layoutPage', () => {
  it('reads lines top to bottom and flips y to a top-left origin', () => {
    const items = Array.from({ length: 5 }, (_, r) => item(`line ${r}`, 50, 700 - r * 15, 230))
    const { lines } = layoutPage(items, PAGE_H)
    expect(lines.map((l) => l.text)).toEqual(items.map((i) => i.str))
    expect(lines[0].yTop).toBeLessThan(lines[1].yTop)
  })

  it('joins runs on one line, with a space only across a visible gap', () => {
    // 'one' ends at 70. A 5pt gap is a word space at this font height; a 1pt
    // one is just how the PDF split the run, and must not become a space.
    const spaced = layoutPage([item('one', 50, 700, 20), item('two', 75, 700, 20)], PAGE_H)
    expect(spaced.lines[0].text).toBe('one two')

    const tight = layoutPage([item('on', 50, 700, 20), item('e', 71, 700, 5)], PAGE_H)
    expect(tight.lines[0].text).toBe('one')
  })

  it('does not insert a space between CJK glyphs', () => {
    const { lines } = layoutPage([item('知识', 50, 700, 20), item('库', 75, 700, 10)], PAGE_H)
    expect(lines[0].text).toBe('知识库')
  })
})

describe('boundsOf', () => {
  it('reads justified text off the right margin', () => {
    expect(
      boundsOf([line(), line({ x1: 279 }), line({ x1: 280 }), line({ x1: 210 })]).justified,
    ).toBe(true)
  })

  it('does not call ragged-right text justified', () => {
    expect(
      boundsOf([line({ x1: 200 }), line({ x1: 245 }), line({ x1: 262 }), line({ x1: 213 })])
        .justified,
    ).toBe(false)
  })

  it('takes the margin from the median, not from an indented outlier', () => {
    expect(boundsOf([line({ x0: 58 }), line(), line(), line()]).left).toBe(50)
  })
})

describe('groupBlocks', () => {
  const justified = { left: 50, right: 280, justified: true }

  it('starts a paragraph at an indented first line', () => {
    // The case gap-based splitting cannot see: leading is identical, and only
    // the indent says a new paragraph began. Running these together is what
    // made one citation highlight cover three paragraphs at a time.
    const lines = [
      line({ yTop: 100 }),
      line({ yTop: 112 }),
      line({ yTop: 124, x0: 58, text: 'new para' }),
      line({ yTop: 136 }),
    ]
    const blocks = groupBlocks(lines, justified)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toHaveLength(2)
    expect(blocks[1]).toHaveLength(2)
  })

  it('ends a paragraph at a line that stops short of a justified margin', () => {
    const lines = [
      line({ yTop: 100 }),
      line({ yTop: 112, x1: 190, text: 'last line of para' }),
      line({ yTop: 124 }),
    ]
    expect(groupBlocks(lines, justified)).toHaveLength(2)
  })

  it('does not split every line of ragged-right text', () => {
    // Without the justified check, "ends short" is true of every line here and
    // each one would become its own block.
    const ragged = { left: 50, right: 280, justified: false }
    const lines = [
      line({ yTop: 100, x1: 200 }),
      line({ yTop: 112, x1: 245 }),
      line({ yTop: 124, x1: 213 }),
    ]
    expect(groupBlocks(lines, ragged)).toHaveLength(1)
  })

  it('still splits on the old signals — a big gap and a size jump', () => {
    expect(groupBlocks([line({ yTop: 100 }), line({ yTop: 130 })], justified)).toHaveLength(2)
    expect(
      groupBlocks([line({ yTop: 100 }), line({ yTop: 112, fontH: 16 })], justified),
    ).toHaveLength(2)
  })
})

describe('joinLines', () => {
  it('folds a hyphenated line break', () => {
    expect(joinLines([line({ text: 'lan-' }), line({ text: 'guage' })])).toBe('language')
  })

  it('joins CJK lines without a space and Latin lines with one', () => {
    expect(joinLines([line({ text: '知识' }), line({ text: '库' })])).toBe('知识库')
    expect(joinLines([line({ text: 'one' }), line({ text: 'two' })])).toBe('one two')
  })
})
