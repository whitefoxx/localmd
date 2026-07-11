import { describe, it, expect } from 'vitest'
import { pad, slugify, fnv1a, indexDirFor } from './util'

describe('pad', () => {
  it('zero-pads to 3 digits', () => {
    expect(pad(7)).toBe('007')
    expect(pad(123)).toBe('123')
  })
})

describe('slugify', () => {
  it('keeps unicode letters so CJK titles survive', () => {
    expect(slugify('毛泽东选集')).toBe('毛泽东选集')
  })
  it('collapses punctuation runs to hyphens and lowercases', () => {
    expect(slugify('Hello, World! (2nd ed.)')).toBe('hello-world-2nd-ed')
  })
  it('never returns an empty slug', () => {
    expect(slugify('!!!')).toBe('section')
  })
})

describe('fnv1a — must stay byte-compatible with trace-app', () => {
  // Golden values verified against directories created by trace-app in a real
  // knowledge base. Changing the hash breaks index dir interop between apps.
  it('matches trace-app-generated index directory hashes', () => {
    expect(fnv1a('raw/books/毛泽东选集.pdf')).toBe('b03d722c')
    expect(fnv1a('raw/books/全球通史.pdf')).toBe('5178e6ec')
    expect(fnv1a('raw/books/被讨厌的勇气.epub')).toBe('c7f57e57')
  })
})

describe('indexDirFor', () => {
  it('builds the trace-app-compatible directory name', () => {
    expect(indexDirFor('pdf', 'raw/books/毛泽东选集.pdf')).toBe(
      '.trace/pdf-index/毛泽东选集-b03d722c',
    )
    expect(indexDirFor('epub', 'raw/books/被讨厌的勇气.epub')).toBe(
      '.trace/epub-index/被讨厌的勇气-c7f57e57',
    )
  })
})
