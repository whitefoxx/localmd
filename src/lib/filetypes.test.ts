import { describe, it, expect } from 'vitest'
import { fileKind, mimeFor } from './filetypes'

describe('fileKind', () => {
  it('classifies by extension, case-insensitively', () => {
    expect(fileKind('wiki/index.md')).toBe('markdown')
    expect(fileKind('notes/File.MD')).toBe('markdown')
    expect(fileKind('raw/papers/x.pdf')).toBe('pdf')
    expect(fileKind('raw/books/y.EPUB')).toBe('epub')
    expect(fileKind('raw/images/z.png')).toBe('image')
    expect(fileKind('src/app.ts')).toBe('text')
    expect(fileKind('data/blob.bin')).toBe('binary')
  })

  it('routes media and office formats to their viewers', () => {
    expect(fileKind('raw/audio/talk.mp3')).toBe('audio')
    expect(fileKind('voice/Memo.M4A')).toBe('audio')
    expect(fileKind('raw/video/demo.mp4')).toBe('video')
    expect(fileKind('clips/take.webm')).toBe('video')
    expect(fileKind('data/budget.xlsx')).toBe('sheet')
    expect(fileKind('data/legacy.xls')).toBe('sheet') // same viewer explains itself
    expect(fileKind('decks/kickoff.pptx')).toBe('slides')
    expect(fileKind('decks/legacy.ppt')).toBe('slides')
    // CSV stays `text` (editable) — the table view is a preview mode on top.
    expect(fileKind('data/rows.csv')).toBe('text')
  })

  it('classifies HTML as its own kind (artifact viewer), not text', () => {
    expect(fileKind('artifacts/guide.html')).toBe('html')
    expect(fileKind('x.HTM')).toBe('html')
    // .ts / .css etc stay text — only html/htm route to the sandboxed viewer.
    expect(fileKind('style.css')).toBe('text')
  })
})

describe('mimeFor', () => {
  it('maps known extensions and falls back to octet-stream', () => {
    expect(mimeFor('a.pdf')).toBe('application/pdf')
    expect(mimeFor('b.svg')).toBe('image/svg+xml')
    expect(mimeFor('c.unknown')).toBe('application/octet-stream')
  })
})
