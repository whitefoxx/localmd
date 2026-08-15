import { describe, it, expect } from 'vitest'
import { fileKind, mimeFor, looksBinary, isTextName, SNIFF_BYTES } from './filetypes'

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

describe('fileKind — names it has never seen', () => {
  it('opens anything not known to be binary as text, the way an editor does', () => {
    // The bug this fixes: a text file nobody put on an allowlist ("binary file
    // — no preview" on a .env you can read fine in VS Code).
    expect(fileKind('.env')).toBe('text')
    expect(fileKind('deploy/.env.production.local')).toBe('text')
    expect(fileKind('Makefile')).toBe('text')
    expect(fileKind('Dockerfile')).toBe('text')
    expect(fileKind('LICENSE')).toBe('text')
    expect(fileKind('.prettierrc')).toBe('text')
    expect(fileKind('data/events.ndjson')).toBe('text')
    expect(fileKind('notes/whatever.newformat')).toBe('text')
  })

  it('still names the formats whose bytes are not text', () => {
    expect(fileKind('vendor/lib.wasm')).toBe('binary')
    expect(fileKind('fonts/Inter.woff2')).toBe('binary')
    expect(fileKind('archive/backup.tar.gz')).toBe('binary')
    expect(fileKind('data/store.sqlite3')).toBe('binary')
    expect(fileKind('scan.TIFF')).toBe('binary')
    expect(fileKind('clip.avi')).toBe('binary')
  })

  it('isTextName is the single answer to "is this a text file"', () => {
    expect(isTextName('wiki/index.md')).toBe(true)
    expect(isTextName('.env')).toBe(true)
    expect(isTextName('artifacts/guide.html')).toBe(true)
    expect(isTextName('raw/papers/x.pdf')).toBe(false)
    expect(isTextName('raw/images/z.png')).toBe(false)
  })
})

describe('looksBinary', () => {
  const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

  it('calls a NUL in the head binary and leaves the rest text', () => {
    expect(looksBinary(bytes('KEY=value\n'))).toBe(false)
    expect(looksBinary(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(true)
    expect(looksBinary(new Uint8Array())).toBe(false)
  })

  it('does not treat undecodable UTF-8 as binary — a Latin-1 note still opens', () => {
    expect(looksBinary(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe(false)
  })

  it('only looks at the sniff window, so a NUL past it does not matter', () => {
    const late = new Uint8Array(SNIFF_BYTES + 8).fill(0x61)
    late[SNIFF_BYTES + 4] = 0
    expect(looksBinary(late)).toBe(false)
  })
})

describe('mimeFor', () => {
  it('maps known extensions and falls back to octet-stream', () => {
    expect(mimeFor('a.pdf')).toBe('application/pdf')
    expect(mimeFor('b.svg')).toBe('image/svg+xml')
    expect(mimeFor('c.unknown')).toBe('application/octet-stream')
  })
})
