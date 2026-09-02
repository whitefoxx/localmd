import { describe, it, expect } from 'vitest'
import { parseKbQuery, runQuery, formatQueryResult, type QueryPage } from './kbQuery'

const NOW = Date.parse('2026-09-01T00:00:00Z')
const DAY = 86_400_000
const fm = (yaml: string, body = '# Page\nbody'): string => `---\n${yaml}\n---\n${body}`

/** A small KB with the shapes that matter: typed pages and untyped ones, a
 *  page with no frontmatter at all, a broken link, an unread source. */
const PAGES: QueryPage[] = [
  {
    path: 'index.md',
    content: fm('kb-role: index', '# Index\n[[wiki/attention]] [[wiki/scaling]]'),
    outgoing: ['wiki/attention.md', 'wiki/scaling.md'],
    broken: [],
    mtime: NOW - 1 * DAY,
  },
  {
    path: 'wiki/attention.md',
    content: fm(
      'type: paper\ntags: [llm-agents, transformers]\nstatus: draft\nrating: 9\nauthors: [alice, bob]',
      '# Attention\ngradient descent notes [[wiki/scaling]]',
    ),
    outgoing: ['wiki/scaling.md'],
    broken: [],
    mtime: NOW - 5 * DAY,
    sources: ['raw/papers/attention.pdf'],
  },
  {
    path: 'wiki/scaling.md',
    content: fm('type: paper\ntags: [llm]\nstatus: published\nrating: 10', '# Scaling\nbody'),
    outgoing: [],
    broken: [],
    mtime: NOW - 200 * DAY,
  },
  {
    path: 'wiki/alice.md',
    content: fm('type: person\ntags: [people]', '# Alice\nbody'),
    outgoing: [],
    broken: ['wiki/missing'],
    mtime: NOW - 40 * DAY,
  },
  { path: 'raw/notes.md', content: '# Notes\nno frontmatter here', outgoing: [], broken: [] },
  { path: 'log.md', content: fm('kb-role: log', '# Log\nbody'), outgoing: [], broken: [], mtime: NOW },
]

const paths = (text: string): string[] =>
  runQuery(PAGES, parseKbQuery(text, NOW).query).rows.map((r) => r.path)

describe('parseKbQuery', () => {
  it('reads the filters the palette already had', () => {
    const { query } = parseKbQuery('type:paper tag:llm', NOW)
    expect(query).toMatchObject({ type: 'paper', tags: ['llm'] })
  })

  it('keeps quoted values whole and repeated tags as an AND', () => {
    const { query } = parseKbQuery('type:"case study" tag:"deep learning" tag:llm', NOW)
    expect(query.type).toBe('case study')
    expect(query.tags).toEqual(['deep learning', 'llm'])
  })

  it('lets an unknown key fall through to the free text', () => {
    // A note about a URL still searches for the URL rather than failing.
    const { query, errors } = parseKbQuery('http://example.com scaling', NOW)
    expect(errors).toEqual([])
    expect(query.text).toBe('http://example.com scaling')
  })

  it('reads frontmatter tests, including bare existence', () => {
    expect(parseKbQuery('fm:status=draft', NOW).query.fields).toEqual([
      { field: 'status', op: '=', value: 'draft' },
    ])
    expect(parseKbQuery('fm:rating>=4', NOW).query.fields).toEqual([
      { field: 'rating', op: '>=', value: '4' },
    ])
    expect(parseKbQuery('fm:deadline', NOW).query.fields).toEqual([
      { field: 'deadline', op: 'exists' },
    ])
  })

  it('reads age as an age and modified as a date', () => {
    expect(parseKbQuery('age:<30d', NOW).query.modifiedAfter).toBe(NOW - 30 * DAY)
    expect(parseKbQuery('age:>6m', NOW).query.modifiedBefore).toBe(NOW - 180 * DAY)
    expect(parseKbQuery('modified:<2026-01-01', NOW).query.modifiedBefore).toBe(
      Date.parse('2026-01-01'),
    )
    expect(parseKbQuery('modified:>2026-01-01', NOW).query.modifiedAfter).toBe(
      Date.parse('2026-01-01'),
    )
  })

  it('narrows rather than overwrites when time filters combine', () => {
    const { query } = parseKbQuery('age:<90d age:<30d', NOW)
    expect(query.modifiedAfter).toBe(NOW - 30 * DAY)
  })

  it('reads sort, with built-in names winning and fm. forcing frontmatter', () => {
    expect(parseKbQuery('sort:-modified', NOW).query.sort).toEqual({
      key: 'modified',
      order: 'desc',
    })
    expect(parseKbQuery('sort:rating', NOW).query.sort).toEqual({
      key: { field: 'rating' },
      order: 'asc',
    })
    expect(parseKbQuery('sort:fm.title', NOW).query.sort).toEqual({
      key: { field: 'title' },
      order: 'asc',
    })
  })

  it('reports what it could not read instead of guessing', () => {
    expect(parseKbQuery('limit:abc', NOW).errors[0]).toMatch(/limit/)
    expect(parseKbQuery('role:foo', NOW).errors[0]).toMatch(/role/)
    expect(parseKbQuery('age:30d', NOW).errors[0]).toMatch(/age/)
    expect(parseKbQuery('orphan:yes', NOW).errors[0]).toMatch(/orphan/)
    expect(parseKbQuery('fm:status=', NOW).errors[0]).toMatch(/missing a value/)
  })
})

describe('runQuery', () => {
  it('filters by type and by tag, both as substrings', () => {
    expect(paths('type:paper')).toEqual(['wiki/attention.md', 'wiki/scaling.md'])
    // `tag:llm` finds `llm-agents` — narrowing into free vocabulary.
    expect(paths('tag:llm')).toEqual(['wiki/attention.md', 'wiki/scaling.md'])
    expect(paths('tag:transformers')).toEqual(['wiki/attention.md'])
  })

  it('ANDs repeated tags', () => {
    expect(paths('tag:llm tag:transformers')).toEqual(['wiki/attention.md'])
    expect(paths('tag:llm tag:people')).toEqual([])
  })

  it('compares a frontmatter value exactly, unlike a tag', () => {
    expect(paths('fm:status=draft')).toEqual(['wiki/attention.md'])
    expect(paths('fm:status=draf')).toEqual([])
  })

  it('compares numbers as numbers', () => {
    // String order would put "10" below "9" and lose the higher rating.
    expect(paths('fm:rating>=10')).toEqual(['wiki/scaling.md'])
    expect(paths('fm:rating>8')).toEqual(['wiki/attention.md', 'wiki/scaling.md'])
  })

  it('needs every element to differ for !=', () => {
    expect(paths('fm:authors!=alice')).toEqual([])
    expect(paths('fm:authors!=carol')).toEqual(['wiki/attention.md'])
    expect(paths('fm:authors=bob')).toEqual(['wiki/attention.md'])
  })

  it('finds pages by existence of a field', () => {
    expect(paths('fm:rating')).toEqual(['wiki/attention.md', 'wiki/scaling.md'])
  })

  it('derives inbound links and answers orphan both ways', () => {
    expect(paths('orphan:false')).toEqual(['wiki/attention.md', 'wiki/scaling.md'])
    expect(paths('orphan:true')).toEqual(['index.md', 'wiki/alice.md', 'raw/notes.md', 'log.md'])
  })

  it('filters by broken links, path, role and body text', () => {
    expect(paths('broken:true')).toEqual(['wiki/alice.md'])
    expect(paths('path:wiki/')).toEqual(['wiki/attention.md', 'wiki/scaling.md', 'wiki/alice.md'])
    // Resolved as computeLint resolves it: the marker wins, the filename is
    // the default — so an ordinary index.md answers without declaring one.
    expect(paths('role:index')).toEqual(['index.md'])
    expect(paths('role:log')).toEqual(['log.md'])
    expect(paths('gradient')).toEqual(['wiki/attention.md'])
  })

  it('walks the link graph in both directions', () => {
    expect(paths('links-to:scaling')).toEqual(['index.md', 'wiki/attention.md'])
    expect(paths('linked-by:index.md')).toEqual(['wiki/attention.md', 'wiki/scaling.md'])
  })

  it('matches declared sources', () => {
    expect(paths('cites:attention.pdf')).toEqual(['wiki/attention.md'])
    expect(paths('cites:nothing.pdf')).toEqual([])
  })

  it('filters by age, and a page with no mtime is never a match', () => {
    expect(paths('age:<30d')).toEqual(['index.md', 'wiki/attention.md', 'log.md'])
    expect(paths('age:>90d')).toEqual(['wiki/scaling.md'])
    expect(paths('age:<30d')).not.toContain('raw/notes.md')
  })

  it('sorts, putting pages that have no value last in both directions', () => {
    expect(paths('sort:-rating').slice(0, 2)).toEqual(['wiki/scaling.md', 'wiki/attention.md'])
    expect(paths('sort:rating').slice(0, 2)).toEqual(['wiki/attention.md', 'wiki/scaling.md'])
    // Unrated pages trail the list whichever way it is pointed.
    expect(paths('sort:rating').slice(2)).toEqual(paths('sort:-rating').slice(2))
    expect(paths('sort:-modified')[0]).toBe('log.md')
  })

  it('limits the rows but reports the true total', () => {
    const r = runQuery(PAGES, parseKbQuery('type:paper limit:1', NOW).query)
    expect(r.rows).toHaveLength(1)
    expect(r.total).toBe(2)
  })

  it('fills the requested columns', () => {
    const r = runQuery(PAGES, parseKbQuery('type:paper columns:rating,status,title', NOW).query)
    expect(r.rows[0].cells).toEqual({ rating: '9', status: 'draft', title: 'Attention' })
  })

  it('an unknown term always means an empty result', () => {
    // Every term `unmatched` checks is also a hard filter, so nothing it flags
    // can leave a row standing. Renderers rely on this to say it once.
    for (const q of [
      'tag:llmm',
      'type:nope',
      'fm:nosuch',
      'path:none/',
      'type:paper tag:llmm',
      'fm:rating>=1 fm:nosuch',
    ]) {
      const r = runQuery(PAGES, parseKbQuery(q, NOW).query)
      if (r.unmatchedTerms.length) expect(r.rows, q).toEqual([])
    }
  })

  it('names vocabulary the KB does not have, so a typo is not an empty table', () => {
    const r = runQuery(PAGES, parseKbQuery('tag:llmm fm:nosuch type:nope path:none/', NOW).query)
    expect(r.rows).toEqual([])
    expect(r.unmatchedTerms).toEqual(['type:nope', 'tag:llmm', 'fm:nosuch', 'path:none/'])
    // A real term that simply returns nothing in combination is NOT flagged.
    expect(
      runQuery(PAGES, parseKbQuery('tag:llm tag:people', NOW).query).unmatchedTerms,
    ).toEqual([])
  })

  it('resolves role from the filename when no marker is declared', () => {
    const bare: QueryPage[] = [
      { path: 'wiki/index.md', content: '# Index\nno frontmatter', outgoing: [], broken: [] },
      { path: 'wiki/log.md', content: '# Log\nno frontmatter', outgoing: [], broken: [] },
      { path: 'wiki/note.md', content: '# Note', outgoing: [], broken: [] },
      // An explicit marker still overrides the name it contradicts.
      { path: 'other/index.md', content: fm('kb-role: log'), outgoing: [], broken: [] },
    ]
    const q = (s: string): string[] =>
      runQuery(bare, parseKbQuery(s, NOW).query).rows.map((r) => r.path)
    expect(q('role:index')).toEqual(['wiki/index.md'])
    expect(q('role:log')).toEqual(['wiki/log.md', 'other/index.md'])
  })

  it('works on a KB with no conventions at all', () => {
    const bare: QueryPage[] = [{ path: 'a.md', content: 'just text', outgoing: [], broken: [] }]
    expect(runQuery(bare, parseKbQuery('', NOW).query).total).toBe(1)
    expect(runQuery(bare, parseKbQuery('type:paper', NOW).query).rows).toEqual([])
  })
})

describe('formatQueryResult', () => {
  it('says how many of how many, and warns about unknown vocabulary', () => {
    const r = runQuery(PAGES, parseKbQuery('type:paper limit:1', NOW).query)
    expect(formatQueryResult(r)).toContain('1 of 2 matches')
    expect(formatQueryResult(r)).toContain('wiki/attention.md')

    // One sentence, not "No pages match." followed by a line saying the same.
    const empty = formatQueryResult(runQuery(PAGES, parseKbQuery('tag:llmm', NOW).query))
    expect(empty).toBe('No pages match. This KB has no tag:llmm — check the spelling.')

    // A genuinely empty result, with every term real, says only that.
    const real = formatQueryResult(runQuery(PAGES, parseKbQuery('type:paper role:log', NOW).query))
    expect(real).toBe('No pages match.')
  })

  it('shows requested non-built-in columns', () => {
    const q = parseKbQuery('type:paper columns:rating', NOW).query
    expect(formatQueryResult(runQuery(PAGES, q), q.columns)).toContain('rating=9')
  })
})
