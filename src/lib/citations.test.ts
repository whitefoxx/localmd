import { describe, it, expect } from 'vitest'
import { parseCiteSources, renderCitationTokens, isCitationToken, resolveCitePath } from './citations'

describe('isCitationToken', () => {
  it('recognises source declarations and inline citations', () => {
    expect(isCitationToken('pdf1:raw/papers/x.pdf')).toBe(true)
    expect(isCitationToken('epub2:raw/books/y.epub')).toBe(true)
    expect(isCitationToken('md3:raw/articles/z.md')).toBe(true)
    expect(isCitationToken('1:b14-3')).toBe(true)
    expect(isCitationToken('b14-3')).toBe(true)
  })
  it('rejects wikilink targets', () => {
    expect(isCitationToken('some-page')).toBe(false)
    expect(isCitationToken('wiki/entities/foo')).toBe(false)
  })
})

describe('parseCiteSources', () => {
  it('maps source numbers to kinds and paths', () => {
    const body = '[[pdf1:raw/papers/a.pdf]]\n[[epub2:raw/books/b.epub]]\ntext [[1:b3-1]]'
    const sources = parseCiteSources(body)
    expect(sources.get('1')).toEqual({ kind: 'pdf', path: 'raw/papers/a.pdf' })
    expect(sources.get('2')).toEqual({ kind: 'epub', path: 'raw/books/b.epub' })
  })
  it('keeps the first declaration when numbers repeat', () => {
    const sources = parseCiteSources('[[pdf1:a.pdf]] [[md1:b.md]]')
    expect(sources.get('1')).toEqual({ kind: 'pdf', path: 'a.pdf' })
  })
})

describe('renderCitationTokens', () => {
  it('rewrites source declarations to cite-source anchors', () => {
    const html = renderCitationTokens('[[pdf1:raw/papers/x.pdf]]')
    expect(html).toContain('class="cite-source"')
    expect(html).toContain('data-cite-path="raw/papers/x.pdf"')
  })

  it('rewrites inline citations to numbered chips carrying the source path', () => {
    const html = renderCitationTokens('[[pdf1:raw/x.pdf]]\nclaim [[1:b14-3]].')
    expect(html).toContain('class="citation"')
    expect(html).toContain('data-block="b14-3"')
    expect(html).toContain('data-cite-path="raw/x.pdf"')
    expect(html).toContain('>[1]<')
  })

  it('renders a bare block citation without a source as [•]', () => {
    const html = renderCitationTokens('claim [[b2-1]].')
    expect(html).toContain('>[•]<')
    expect(html).not.toContain('data-cite-path')
  })

  it('leaves ordinary wikilinks untouched', () => {
    const body = 'see [[some-page]] here'
    expect(renderCitationTokens(body)).toBe(body)
  })
})

describe('renderCitationTokens with extraSources', () => {
  it('resolves a chip whose source declaration is out of this text', () => {
    // Chat renders part-by-part: the [[pdf1:…]] declaration lives elsewhere.
    const extra = new Map([['1', { kind: 'pdf' as const, path: 'raw/x.pdf' }]])
    const html = renderCitationTokens('claim [[1:b14-3]].', extra)
    expect(html).toContain('data-cite-path="raw/x.pdf"')
    expect(html).toContain('>[1]<')
  })

  it('a chip with no resolvable source stays clickable (falls back at click)', () => {
    const html = renderCitationTokens('claim [[1:b14-3]].')
    expect(html).toContain('class="citation"')
    expect(html).toContain('data-block="b14-3"')
    expect(html).not.toContain('data-cite-path')
  })
})

describe('resolveCitePath', () => {
  const kb = ['wiki/index.md', 'wiki/field-notes.docx', 'raw/papers/attention.pdf']

  it('accepts a path that exists as declared', () => {
    expect(resolveCitePath('raw/papers/attention.pdf', kb)).toBe('raw/papers/attention.pdf')
  })

  it('repairs a bare basename to the one file that carries it', () => {
    // The model abbreviated; the chip must still land.
    expect(resolveCitePath('field-notes.docx', kb)).toBe('wiki/field-notes.docx')
  })

  it('repairs a stale directory after the user moved the file', () => {
    // Files are the user's to move — a rename must not kill the citation.
    expect(resolveCitePath('raw/articles/field-notes.docx', kb)).toBe('wiki/field-notes.docx')
  })

  it('declines when two files share the basename — a guess is worse than a fallback', () => {
    const twins = [...kb, 'archive/field-notes.docx']
    expect(resolveCitePath('field-notes.docx', twins)).toBeNull()
  })

  it('declines when nothing matches at all', () => {
    expect(resolveCitePath('gone.pdf', kb)).toBeNull()
    expect(resolveCitePath('', kb)).toBeNull()
  })

  it('matches whole basenames, not suffixes', () => {
    // "notes.docx" must not claim "field-notes.docx".
    expect(resolveCitePath('notes.docx', kb)).toBeNull()
  })
})
