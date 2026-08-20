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
import {
  layoutPage,
  place,
  bandLines,
  groupBlocks,
  boundsOf,
  joinLines,
  splitAtWideGaps,
  separateFloaters,
  typicalPitch,
  numberingDepth,
  assembleBlocks,
} from './layout'

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

describe('splitAtWideGaps', () => {
  it('cuts a band at a gap no prose line would contain', () => {
    const [band] = bandLines(place([item('body text here', 50, 700, 200), item('legend', 400, 700, 60)]))
    const parts = splitAtWideGaps(band)
    expect(parts).toHaveLength(2)
    expect(parts[0].items.map((i) => i.str)).toEqual(['body text here'])
    expect(parts[1].items.map((i) => i.str)).toEqual(['legend'])
  })

  it('keeps word spacing together', () => {
    // 5pt gaps at 10pt font are words, not streams.
    const [band] = bandLines(place([item('one', 50, 700, 30), item('two', 85, 700, 30)]))
    expect(splitAtWideGaps(band)).toHaveLength(1)
  })
})

describe('separateFloaters', () => {
  /** A page with a right-side wrapped figure: body wraps at x≈300, chart text
   *  sits at 380–550 for those bands, and full-width prose follows. */
  function wrappedFigurePage() {
    const items = []
    let y = 700
    for (let r = 0; r < 4; r++) {
      items.push(item(`wrap${r}`, 50, y, 250))
      items.push(item(`chart${r}`, 400, y, 100))
      y -= 15
    }
    // An axis row with no prose beside it.
    items.push(item('100', 420, y, 20))
    y -= 15
    for (let r = 0; r < 3; r++) {
      items.push(item(`wide${r}`, 50, y, 500))
      y -= 15
    }
    return items
  }

  it('keeps prose in order and holds figure text to the end', () => {
    const { flow, floaters } = separateFloaters(bandLines(place(wrappedFigurePage())))
    expect(flow.map((l) => l.items[0].str)).toEqual([
      'wrap0', 'wrap1', 'wrap2', 'wrap3', 'wide0', 'wide1', 'wide2',
    ])
    expect(floaters.map((l) => l.items[0].str)).toEqual([
      'chart0', 'chart1', 'chart2', 'chart3', '100',
    ])
  })

  it('no line ever mixes prose with figure text', () => {
    const { flow, floaters } = separateFloaters(bandLines(place(wrappedFigurePage())))
    for (const l of [...flow, ...floaters]) {
      const strs = l.items.map((i) => i.str).join(' ')
      expect(/wrap|wide/.test(strs) && /chart|100/.test(strs)).toBe(false)
    }
  })

  it('leaves a plain page untouched', () => {
    const items = Array.from({ length: 8 }, (_, r) => item(`line${r}`, 50, 700 - r * 15, 500))
    const { flow, floaters } = separateFloaters(bandLines(place(items)))
    expect(flow).toHaveLength(8)
    expect(floaters).toHaveLength(0)
  })
})

describe('typicalPitch', () => {
  it('learns the page leading from the median', () => {
    const lines = [100, 111, 122, 133, 150, 161].map((y) => line({ yTop: y }))
    expect(typicalPitch(lines)).toBe(11)
  })

  it('declines to guess from too few lines', () => {
    expect(typicalPitch([line({ yTop: 100 }), line({ yTop: 111 })])).toBeNull()
  })
})

describe('groupBlocks — leading-relative paragraphs', () => {
  const justified = { left: 50, right: 280, justified: true }

  it('splits at a paragraph set apart by leading alone', () => {
    // The measured case: 11pt pitch inside paragraphs, 17pt between them,
    // 10pt font, no indent. An absolute gap rule misses 17 − 10 = 7 < 7.5.
    const ys = [100, 111, 122, 133, 150, 161, 172]
    const lines = ys.map((y) => line({ yTop: y }))
    const blocks = groupBlocks(lines, justified)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toHaveLength(4)
    expect(blocks[1]).toHaveLength(3)
  })

  it('starts a new block when y jumps backwards (floaters)', () => {
    const lines = [
      line({ yTop: 100 }),
      line({ yTop: 111 }),
      line({ yTop: 40, x0: 400, x1: 500, text: 'chart' }),
    ]
    const blocks = groupBlocks(lines, justified)
    expect(blocks.map((b) => b.length)).toEqual([2, 1])
  })

  it('does not end a paragraph at every line of figure-wrapped text', () => {
    // Wrapped lines are justified to the wrap margin, so each ends short of
    // the page margin — but all at the SAME short margin, which is a wrap, not
    // a row of one-line paragraphs.
    const lines = [
      line({ yTop: 100, x1: 200 }),
      line({ yTop: 111, x1: 201 }),
      line({ yTop: 122, x1: 199 }),
      line({ yTop: 133, x1: 200 }),
    ]
    expect(groupBlocks(lines, justified)).toHaveLength(1)
  })

  it('still ends a paragraph at a short line followed by a full one', () => {
    const lines = [
      line({ yTop: 100 }),
      line({ yTop: 111, x1: 190, text: 'last of para' }),
      line({ yTop: 122 }),
    ]
    expect(groupBlocks(lines, justified)).toHaveLength(2)
  })
})

describe('numberingDepth', () => {
  it('reads decimal, appendix, roman and letter numbering', () => {
    expect(numberingDepth('3 Results')).toBe(1)
    expect(numberingDepth('3.2 Data')).toBe(2)
    expect(numberingDepth('3.2.1. Cleaning')).toBe(3)
    expect(numberingDepth('A.2 Proofs')).toBe(2)
    expect(numberingDepth('IV. Discussion')).toBe(1)
    expect(numberingDepth('B) Ablations')).toBe(1)
  })
  it('rejects numbers not followed by a word — axis labels, formulas', () => {
    expect(numberingDepth('1 +')).toBeNull()
    expect(numberingDepth('0.9 0.1 0.7')).toBeNull()
    expect(numberingDepth('plain prose')).toBeNull()
  })
})

describe('assembleBlocks — relative heading levels', () => {
  /** One page of lines at given font sizes; text decides the rest. */
  function page(specs: { text: string; h: number; y: number }[]) {
    return specs.map((s) => ({
      x0: 50,
      x1: 50 + s.text.length * 5,
      yTop: s.y,
      fontH: s.h,
      text: s.text,
    }))
  }
  const SIZE = [
    { w: 600, h: 800 },
    { w: 600, h: 800 },
  ]

  it('ranks heading styles by size instead of an absolute threshold', () => {
    // Body 10pt, section headings 11pt — 1.1×, under the OLD 1.18 floor,
    // which was exactly the measured paper that degraded to page-files.
    const p = (n: number) =>
      page([
        { text: `Section ${'ABC'[n]} opening`, h: 11, y: 100 },
        ...Array.from({ length: 20 }, (_, i) => ({
          text: `body prose line ${i} on page ${n} with ordinary words`,
          h: 10,
          y: 140 + i * 30,
        })),
      ])
    const blocks = assembleBlocks([p(1), p(2)], [boundsOf(p(1)), boundsOf(p(2))], SIZE)
    const heads = blocks.filter((b) => b.kind === 'heading')
    expect(heads).toHaveLength(2)
    expect(heads.every((b) => b.level === 1)).toBe(true)
  })

  it('lets explicit numbering override the style rank', () => {
    const p = page([
      { text: 'Huge Chapter Title', h: 18, y: 60 },
      { text: '2.1.3 Deep subsection', h: 18, y: 120 },
      ...Array.from({ length: 20 }, (_, i) => ({
        text: `body prose line ${i} with ordinary words in it`,
        h: 10,
        y: 160 + i * 30,
      })),
    ])
    const blocks = assembleBlocks([p], [boundsOf(p)], [SIZE[0]])
    const byText = (t: string) => blocks.find((b) => b.text.startsWith(t))!
    expect(byText('Huge Chapter').level).toBe(1)
    expect(byText('2.1.3').level).toBe(3)
  })

  it('degenerate metrics: believes only numbering when "headings" flood the page', () => {
    // Nearly half the lines report an outsized font while the median sits on
    // the small ones — the four-lectures failure.
    const p = (n: number) =>
      page([
        { text: `${n}.1 Real section`, h: 3.5, y: 100 },
        ...Array.from({ length: 12 }, (_, i) => ({
          text: `fragment ${i}`,
          h: i < 5 ? 3.5 : 1.5,
          y: 140 + i * 30,
        })),
      ])
    const blocks = assembleBlocks([p(1), p(2)], [boundsOf(p(1)), boundsOf(p(2))], SIZE)
    const heads = blocks.filter((b) => b.kind === 'heading')
    expect(heads.map((b) => b.text)).toEqual(['1.1 Real section', '2.1 Real section'])
    expect(heads[0].level).toBe(2)
  })
})
