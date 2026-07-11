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
})

describe('mimeFor', () => {
  it('maps known extensions and falls back to octet-stream', () => {
    expect(mimeFor('a.pdf')).toBe('application/pdf')
    expect(mimeFor('b.svg')).toBe('image/svg+xml')
    expect(mimeFor('c.unknown')).toBe('application/octet-stream')
  })
})
