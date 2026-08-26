import { describe, it, expect } from 'vitest'
import {
  sidecarPath,
  isAnnotationsPath,
  annotationSource,
  compareCfi,
  pdfCategory,
  buildAnnotationItems,
  renderAnnotationsDigest,
  toPdfHighlight,
  makeRawPdfAnnotation,
  HIGHLIGHT_COLORS,
  type RawPdfAnnotation,
} from './annotations'

describe('sidecarPath', () => {
  it('appends .annotations.json, the published sidecar name', () => {
    expect(sidecarPath('raw/books/x.pdf')).toBe('raw/books/x.pdf.annotations.json')
  })

  it('round-trips through isAnnotationsPath / annotationSource', () => {
    const sc = sidecarPath('raw/books/x.epub')
    expect(isAnnotationsPath(sc)).toBe(true)
    expect(isAnnotationsPath('raw/books/x.epub')).toBe(false)
    expect(isAnnotationsPath('notes/annotations.json.md')).toBe(false)
    expect(annotationSource(sc)).toBe('raw/books/x.epub')
  })
})

describe('compareCfi', () => {
  it('orders range CFIs by their base + start steps', () => {
    const a = 'epubcfi(/6/38!/4/4,/1:106,/1:144)'
    const b = 'epubcfi(/6/38!/4/20,/1:106,/1:144)'
    expect(compareCfi(a, b)).toBeLessThan(0)
    expect(compareCfi(b, a)).toBeGreaterThan(0)
    expect(compareCfi(a, a)).toBe(0)
  })

  it('orders across spine items and by text offset', () => {
    expect(compareCfi('epubcfi(/6/8!/4/2/1:0)', 'epubcfi(/6/38!/4/2/1:0)')).toBeLessThan(0)
    expect(compareCfi('epubcfi(/6/8!/4/2/1:5)', 'epubcfi(/6/8!/4/2/1:40)')).toBeLessThan(0)
  })

  it('ignores [assertions] and survives junk input', () => {
    expect(
      compareCfi('epubcfi(/6/8[chap01]!/4/2/1:0)', 'epubcfi(/6/8!/4/2/1:0)'),
    ).toBe(0)
    expect(compareCfi('not-a-cfi', 'not-a-cfi')).toBe(0)
  })
})

describe('pdfCategory', () => {
  it('maps subtype numbers to first-class categories', () => {
    expect(pdfCategory(9)).toBe('highlight')
    expect(pdfCategory(10)).toBe('underline')
    expect(pdfCategory(3)).toBe('note') // FreeText
    expect(pdfCategory(1)).toBe('note') // Text
    expect(pdfCategory(12)).toBe('other') // Strikeout
    expect(pdfCategory(28)).toBe('other') // Redact
  })
})

describe('buildAnnotationItems', () => {
  const pdf = [
    {
      annotation: {
        type: 9,
        strokeColor: '#FFD633',
        segmentRects: [{ origin: { x: 5, y: 30 }, size: { width: 10, height: 10 } }],
        pageIndex: 4,
        created: '2026-05-19T00:00:00Z',
        id: 'hl',
        custom: { text: 'the highlight' },
        contents: 'a comment',
      },
    },
    {
      annotation: {
        type: 10,
        strokeColor: '#E44234',
        rect: { origin: { x: 0, y: 10 }, size: { width: 4, height: 4 } },
        pageIndex: 4,
        id: 'ul',
        custom: { text: 'underlined bit' },
      },
    },
    {
      annotation: {
        type: 3,
        rect: { origin: { x: 0, y: 0 }, size: { width: 4, height: 4 } },
        pageIndex: 0,
        id: 'note',
        contents: 'a standalone note',
      },
    },
  ]

  it('categorizes, extracts excerpt/comment, and sorts by page then y', () => {
    const items = buildAnnotationItems('raw/b.pdf', pdf)
    expect(items.map((i) => i.category)).toEqual(['note', 'underline', 'highlight'])
    const hl = items.find((i) => i.id === 'hl')!
    expect(hl.excerpt).toBe('the highlight')
    expect(hl.comment).toBe('a comment')
    expect(hl.page).toBe(5)
    const note = items.find((i) => i.id === 'note')!
    expect(note.excerpt).toBe('')
    expect(note.comment).toBe('a standalone note')
  })

  it('reports the subtype name for other marks', () => {
    const items = buildAnnotationItems('raw/b.pdf', [
      { annotation: { type: 15, rect: { origin: { x: 0, y: 0 }, size: { width: 1, height: 1 } }, pageIndex: 0, id: 'ink' } },
    ])
    expect(items[0].category).toBe('other')
    expect(items[0].typeLabel).toBe('Ink')
  })

  it('carries origIndex through the sort (edit handle)', () => {
    const items = buildAnnotationItems('raw/b.pdf', pdf)
    expect(items.find((i) => i.id === 'note')!.origIndex).toBe(2)
    expect(items.find((i) => i.id === 'hl')!.origIndex).toBe(0)
  })
})

describe('renderAnnotationsDigest', () => {
  it('renders PDF sidecars grouped by page, with categories and comments', () => {
    const json = JSON.stringify({
      version: 1,
      annotations: [
        {
          annotation: {
            type: 9,
            strokeColor: '#FFD633',
            rect: { origin: { x: 0, y: 0 }, size: { width: 10, height: 10 } },
            pageIndex: 4,
            created: '2026-05-19T13:09:39.101Z',
            id: 'a1',
            custom: { text: 'excerpt one' },
            contents: 'my thought',
          },
        },
      ],
    })
    const out = renderAnnotationsDigest('raw/b.pdf.annotations.json', json)!
    expect(out).toContain('## Page 5')
    expect(out).toContain('"excerpt one"')
    expect(out).toContain('Note: my thought')
    expect(out).toContain('yellow highlight')
    expect(out).toContain('Source book: raw/b.pdf')
  })

  it('renders EPUB sidecars in reading order', () => {
    const json = JSON.stringify({
      version: 1,
      annotations: [
        { cfi: 'epubcfi(/6/38!/4/20,/1:0,/1:9)', color: '#7ED67E', text: 'later', createdAt: '' },
        { cfi: 'epubcfi(/6/8!/4/2,/1:0,/1:9)', color: '#57B7F0', text: 'earlier', createdAt: '' },
      ],
    })
    const out = renderAnnotationsDigest('raw/b.epub.annotations.json', json)!
    expect(out.indexOf('"earlier"')).toBeLessThan(out.indexOf('"later"'))
    expect(out).toContain('(2)')
  })

  it('returns null on unparseable JSON', () => {
    expect(renderAnnotationsDigest('raw/b.pdf.annotations.json', '{oops')).toBeNull()
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
