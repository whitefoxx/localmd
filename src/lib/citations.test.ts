import { describe, it, expect } from 'vitest'
import {
  parseCiteSources,
  citationHtml,
  isCitationToken,
  resolveCitePath,
  parseCiteInline,
  publishedCitations,
  type CiteSource,
} from './citations'

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

describe('citationHtml', () => {
  const noSources = new Map<string, CiteSource>()
  const oneSource = new Map<string, CiteSource>([['1', { kind: 'pdf', path: 'raw/x.pdf' }]])

  it('renders source declarations as cite-source anchors', () => {
    const html = citationHtml('pdf1:raw/papers/x.pdf', noSources)!
    expect(html).toContain('class="cite-source"')
    expect(html).toContain('data-cite-path="raw/papers/x.pdf"')
  })

  it('renders inline citations as numbered chips carrying the source path', () => {
    const html = citationHtml('1:b14-3', oneSource)!
    expect(html).toContain('class="citation"')
    expect(html).toContain('data-block="b14-3"')
    expect(html).toContain('data-cite-path="raw/x.pdf"')
    expect(html).toContain('>[1]<')
  })

  it('renders a bare block citation without a source as [•]', () => {
    const html = citationHtml('b2-1', noSources)!
    expect(html).toContain('>[•]<')
    expect(html).not.toContain('data-cite-path')
  })

  it('a chip with no resolvable source stays clickable (falls back at click)', () => {
    const html = citationHtml('1:b14-3', noSources)!
    expect(html).toContain('class="citation"')
    expect(html).toContain('data-block="b14-3"')
    expect(html).not.toContain('data-cite-path')
  })

  it('is null for anything that is not a citation token', () => {
    expect(citationHtml('some-page', noSources)).toBeNull()
    expect(citationHtml('some-page|label', noSources)).toBeNull()
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

/**
 * The count put in front of the user before an index build that cannot carry
 * old block ids forward (lib/renumber). It has to be a number they can trust:
 * too low and the warning understates what is at stake, too high and it cries
 * wolf about another document's ids.
 */
describe('publishedCitations', () => {
  const files = ['raw/papers/x.pdf', 'raw/books/b.epub', 'wiki/note.md', 'wiki/other.md']
  const page = (path: string, body: string): readonly [string, string] => [path, body] as const

  it('counts the ids cited against one document, and the pages citing them', () => {
    const pages = [
      page('wiki/note.md', 'See [[pdf1:raw/papers/x.pdf]] — [[1:b14-3]] and [[1:b2-1]].'),
      page('wiki/other.md', 'Also [[pdf1:raw/papers/x.pdf]] [[1:b14-3]]'),
    ]
    expect(publishedCitations(pages, files, 'raw/papers/x.pdf')).toEqual({
      ids: ['b14-3', 'b2-1'],
      pages: ['wiki/note.md', 'wiki/other.md'],
    })
  })

  it('does not attribute another source’s ids to this document', () => {
    const pages = [
      page(
        'wiki/note.md',
        'A [[pdf1:raw/papers/x.pdf]] B [[epub2:raw/books/b.epub]] — [[1:b1-1]] [[2:b9-9]]',
      ),
    ]
    expect(publishedCitations(pages, files, 'raw/books/b.epub').ids).toEqual(['b9-9'])
  })

  // A bare `[[b14-3]]` names no source and is resolved by searching the
  // indexes at click time. Claiming it for this document is only defensible
  // when the page declares one source and it is this one.
  it('claims bare ids only when the page declares this document alone', () => {
    const alone = [page('wiki/note.md', '[[pdf1:raw/papers/x.pdf]] [[b7-2]]')]
    expect(publishedCitations(alone, files, 'raw/papers/x.pdf').ids).toEqual(['b7-2'])

    const ambiguous = [
      page('wiki/note.md', '[[pdf1:raw/papers/x.pdf]] [[epub2:raw/books/b.epub]] [[b7-2]]'),
    ]
    expect(publishedCitations(ambiguous, files, 'raw/papers/x.pdf').ids).toEqual([])
  })

  // Declared paths are claims, not facts: the model abbreviates and users move
  // files, so the same repair a click makes applies here (resolveCitePath).
  it('follows an abbreviated or moved declaration to the real file', () => {
    const pages = [page('wiki/note.md', '[[pdf1:x.pdf]] [[1:b3-1]]')]
    expect(publishedCitations(pages, files, 'raw/papers/x.pdf').ids).toEqual(['b3-1'])
  })

  it('ignores citations that live in frontmatter', () => {
    const pages = [page('wiki/note.md', '---\nsource: "[[pdf1:raw/papers/x.pdf]] [[1:b1-1]]"\n---\nbody')]
    expect(publishedCitations(pages, files, 'raw/papers/x.pdf').ids).toEqual([])
  })

  it('is empty for a document nobody has cited', () => {
    const pages = [page('wiki/note.md', 'no citations here')]
    expect(publishedCitations(pages, files, 'raw/papers/x.pdf')).toEqual({ ids: [], pages: [] })
  })
})

describe('parseCiteInline', () => {
  it('separates the numbered form from the bare one', () => {
    expect(parseCiteInline('[[1:b14-3]] and [[b2-1]]')).toEqual([
      { num: '1', blockId: 'b14-3' },
      { num: null, blockId: 'b2-1' },
    ])
  })

  it('is not fooled by a wikilink', () => {
    expect(parseCiteInline('[[some page]] [[b1-1]]')).toEqual([{ num: null, blockId: 'b1-1' }])
  })
})
