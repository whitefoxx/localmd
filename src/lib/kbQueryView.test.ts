import { describe, it, expect } from 'vitest'
import { renderQueryBlock } from './kbQueryView'
import type { QueryPage } from './kbQuery'

const NOW = Date.parse('2026-09-01T00:00:00Z')
const DAY = 86_400_000
const fm = (yaml: string, body = '# Page'): string => `---\n${yaml}\n---\n${body}`

const PAGES: QueryPage[] = [
  {
    path: 'wiki/attention.md',
    content: fm('type: paper\ntags: [llm]\nrating: 9', '# Attention'),
    outgoing: [],
    broken: [],
    mtime: NOW - 5 * DAY,
  },
  {
    path: 'wiki/scaling.md',
    content: fm('type: paper\ntags: [llm]\nrating: 10', '# Scaling'),
    outgoing: [],
    broken: [],
    mtime: NOW - 200 * DAY,
  },
  {
    path: 'wiki/<script>.md',
    content: fm('type: paper', '# <img src=x onerror=alert(1)>'),
    outgoing: [],
    broken: [],
    mtime: NOW,
  },
]

const render = (q: string): string => renderQueryBlock(PAGES, q, NOW)

describe('renderQueryBlock', () => {
  it('links each row with the anchor the preview already knows how to open', () => {
    const html = render('type:paper path:attention')
    // Same contract the wikilink renderer emits — one click path, not two.
    expect(html).toContain('<a class="wikilink" data-target="wiki/attention.md" data-resolved="1">')
    expect(html).toContain('>Attention</a>')
  })

  it('defaults to type and modified, and honours columns when asked', () => {
    const dflt = render('path:attention')
    expect(dflt).toContain('<th>type</th>')
    expect(dflt).toContain('<th>modified</th>')
    expect(dflt).toContain('2026-08-27')

    const chosen = render('path:attention columns:rating')
    expect(chosen).toContain('<th>rating</th>')
    expect(chosen).toContain('<td>9</td>')
    // The query asked for one column; it does not also get the defaults.
    expect(chosen).not.toContain('<th>modified</th>')
  })

  it('reports the true total when the rows are capped', () => {
    expect(render('type:paper limit:1')).toContain('1 of 3')
    expect(render('type:paper')).toContain('3 pages')
  })

  it('explains an empty result in one sentence, never two', () => {
    // Every term the warning can name is also a hard filter, so an unknown
    // term is *why* the result is empty. Saying "nothing matches" and then
    // naming the term is the same sentence twice.
    const unknown = render('tag:llmm')
    expect(unknown).toContain('this knowledge base has no tag:llmm')
    expect(unknown).not.toContain('Nothing matches this query')

    // Real terms that simply do not co-occur say only that, with nothing to
    // blame on a typo.
    const real = render('type:paper orphan:false')
    expect(real).toContain('Nothing matches this query')
    expect(real).not.toContain('knowledge base has no')
  })

  it('shows what it could not read instead of rendering an empty table', () => {
    const html = render('age:30d limit:abc')
    expect(html).toContain('could not be read')
    expect(html).toContain('kb-query-errors')
    expect(html).toMatch(/age:/)
    expect(html).not.toContain('<table')
  })

  it('escapes page titles and paths — a note is untrusted text', () => {
    const html = render('type:paper path:script')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('data-target="wiki/&lt;script&gt;.md"')
  })
})
