import { describe, it, expect } from 'vitest'
import {
  rawSubdirFor,
  sanitizeFilename,
  ensureFilename,
  numberedVariant,
  landingPathFor,
  INBOX_DIR,
} from './capture'

describe('landingPathFor — raw/ bucketing only when the KB has a raw/ tree', () => {
  it('buckets by type in raw-layout KBs', () => {
    expect(landingPathFor('paper.pdf', true)).toBe('raw/papers/paper.pdf')
    expect(landingPathFor('shot.png', true)).toBe('raw/images/shot.png')
  })
  it('lands flat in inbox/ elsewhere — never grafts raw/ onto foreign layouts', () => {
    expect(landingPathFor('paper.pdf', false)).toBe(`${INBOX_DIR}/paper.pdf`)
    expect(landingPathFor('shot.png', false)).toBe(`${INBOX_DIR}/shot.png`)
  })
})

describe('rawSubdirFor — the routing existing KBs were organized by', () => {
  it('routes by extension', () => {
    expect(rawSubdirFor('paper.pdf')).toBe('papers')
    expect(rawSubdirFor('book.EPUB')).toBe('books')
    expect(rawSubdirFor('shot.png')).toBe('images')
    expect(rawSubdirFor('photo.JPEG')).toBe('images')
    expect(rawSubdirFor('data.csv')).toBe('data')
    expect(rawSubdirFor('pod.mp3')).toBe('podcasts')
    expect(rawSubdirFor('clip.mp4')).toBe('videos')
    expect(rawSubdirFor('subs.srt')).toBe('transcripts')
  })
  it('defaults unknown and text types to articles', () => {
    expect(rawSubdirFor('note.md')).toBe('articles')
    expect(rawSubdirFor('page.html')).toBe('articles')
    expect(rawSubdirFor('mystery')).toBe('articles')
  })
})

describe('sanitizeFilename', () => {
  it('strips path separators and illegal characters', () => {
    expect(sanitizeFilename('/tmp/evil/../name.png')).toBe('name.png')
    expect(sanitizeFilename('a<b>c:d.png')).toBe('abcd.png')
  })
  it('falls back for empty results', () => {
    expect(sanitizeFilename('///')).toBe('file')
  })
})

describe('ensureFilename', () => {
  it('keeps a real filename', () => {
    expect(ensureFilename('report.pdf', 'application/pdf', 1)).toBe('report.pdf')
  })
  it('names browser-pasted screenshots capture-<stamp>', () => {
    // Chrome names every pasted image "image.png" — that is not a real name.
    expect(ensureFilename('image.png', 'image/png', 42)).toBe('capture-42.png')
    expect(ensureFilename('', 'image/png', 42)).toBe('capture-42.png')
    expect(ensureFilename('', 'image/jpeg', 42)).toBe('capture-42.jpg')
  })
})

describe('numberedVariant', () => {
  it('inserts the counter before the extension', () => {
    expect(numberedVariant('raw/images/a.png', 1)).toBe('raw/images/a.png')
    expect(numberedVariant('raw/images/a.png', 2)).toBe('raw/images/a-2.png')
  })
  it('appends when there is no extension', () => {
    expect(numberedVariant('raw/articles/note', 3)).toBe('raw/articles/note-3')
  })
  it('ignores dots in directory names', () => {
    expect(numberedVariant('.trace/foo', 2)).toBe('.trace/foo-2')
  })
})
