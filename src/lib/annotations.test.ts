import { describe, it, expect } from 'vitest'
import {
  sidecarPath,
  toPdfHighlight,
  makeRawPdfAnnotation,
  HIGHLIGHT_COLORS,
  type RawPdfAnnotation,
} from './annotations'

describe('sidecarPath', () => {
  it('appends .annotations.json (trace-app convention)', () => {
    expect(sidecarPath('raw/books/x.pdf')).toBe('raw/books/x.pdf.annotations.json')
  })
})

describe('toPdfHighlight', () => {
  it('derives rects from segmentRects and keeps color/text', () => {
    const raw: RawPdfAnnotation = {
      annotation: {
        type: 9,
        color: '#FFCD45',
        rect: { origin: { x: 72, y: 76 }, size: { width: 225, height: 15 } },
        segmentRects: [{ origin: { x: 72, y: 76 }, size: { width: 225, height: 15 } }],
        pageIndex: 1612,
        id: 'abc',
        custom: { text: '策略阶段上就不同了' },
      },
    }
    const h = toPdfHighlight(raw)!
    expect(h.pageIndex).toBe(1612)
    expect(h.color).toBe('#FFCD45')
    expect(h.text).toBe('策略阶段上就不同了')
    expect(h.rects).toEqual([{ x: 72, y: 76, w: 225, h: 15 }])
  })

  it('falls back to the bounding rect when segmentRects are missing', () => {
    const raw: RawPdfAnnotation = {
      annotation: {
        type: 9,
        rect: { origin: { x: 1, y: 2 }, size: { width: 3, height: 4 } },
        pageIndex: 0,
        id: 'x',
      },
    }
    expect(toPdfHighlight(raw)!.rects).toEqual([{ x: 1, y: 2, w: 3, h: 4 }])
  })

  it('returns null for malformed entries', () => {
    expect(toPdfHighlight({} as RawPdfAnnotation)).toBeNull()
  })
})

describe('makeRawPdfAnnotation', () => {
  it('produces an EmbedPDF-shaped highlight with a bounding rect', () => {
    const raw = makeRawPdfAnnotation(
      3,
      [
        { x: 10, y: 10, w: 100, h: 12 },
        { x: 10, y: 26, w: 60, h: 12 },
      ],
      HIGHLIGHT_COLORS[0].value,
      'selected text',
    )
    const a = raw.annotation
    expect(a.type).toBe(9)
    expect(a.pageIndex).toBe(3)
    expect(a.segmentRects).toHaveLength(2)
    expect(a.rect).toEqual({ origin: { x: 10, y: 10 }, size: { width: 100, height: 28 } })
    expect(a.custom?.text).toBe('selected text')
    expect(a.id).toBeTruthy()
  })

  it('round-trips through toPdfHighlight', () => {
    const raw = makeRawPdfAnnotation(0, [{ x: 5, y: 6, w: 7, h: 8 }], '#B6F2C4', 't')
    const h = toPdfHighlight(raw)!
    expect(h.color).toBe('#B6F2C4')
    expect(h.rects).toEqual([{ x: 5, y: 6, w: 7, h: 8 }])
  })
})
