import { describe, it, expect } from 'vitest'
import { computeLint, formatLintReport, isEntryPage, type LintPage } from './lint'

function page(content: string, outgoing: string[] = [], broken: string[] = []): LintPage {
  return { content, outgoing, broken }
}

const FM = '---\ntitle: x\n---\n'
// A small KB: index → a → b; c is isolated; d only linked from index; e links out
// but nothing links to it; a has a broken link and a self-link.
const KB = new Map<string, LintPage>([
  ['wiki/index.md', page(FM + 'body', ['wiki/a.md', 'wiki/d.md'])],
  ['wiki/a.md', page(FM + 'a\n'.repeat(12), ['wiki/b.md', 'wiki/a.md'], ['missing-target'])],
  ['wiki/b.md', page(FM + 'b\n'.repeat(12), ['wiki/a.md'])],
  ['wiki/c.md', page(FM + 'lonely')], // orphan: no in, no out
  ['wiki/d.md', page(FM + 'd\n'.repeat(12))], // weakly-linked: only index inbound
  ['wiki/e.md', page('no frontmatter here', ['wiki/a.md'])], // weakly-linked + no-fm + unreachable
])

describe('computeLint', () => {
  const r = computeLint(KB)

  it('counts pages', () => expect(r.pageCount).toBe(6))

  it('finds broken links', () => {
    expect(r.brokenLinks).toEqual([{ path: 'wiki/a.md', targets: ['missing-target'] }])
  })

  it('separates orphans (no content in, no out) from weakly-linked (has outbound)', () => {
    // c: no in, no out. d: only index inbound + no outbound → also an island.
    expect(r.orphans).toEqual(['wiki/c.md', 'wiki/d.md'])
    // e: only index inbound but links out → weakly-linked, not an island.
    expect(r.weaklyLinked).toEqual(['wiki/e.md'])
  })

  it('flags pages unreachable from the index', () => {
    // index → a → b; d reachable via index; c and e are not linked from index.
    expect(r.unreachable).toEqual(['wiki/c.md', 'wiki/e.md'])
  })

  it('flags missing frontmatter, self-links, and thin pages', () => {
    expect(r.noFrontmatter).toEqual(['wiki/e.md'])
    expect(r.selfLinks).toEqual(['wiki/a.md'])
    // c (1 line), d body is 12 lines so not thin; e (1 line); index (1 line)…
    expect(r.thin.map((t) => t.path)).toContain('wiki/c.md')
    expect(r.thin.map((t) => t.path)).not.toContain('wiki/a.md')
  })

  it('detects placeholder wikilinks', () => {
    const withPlaceholder = new Map<string, LintPage>([
      ['wiki/index.md', page('see [[wiki/...]] later')],
    ])
    expect(computeLint(withPlaceholder).placeholders).toEqual(['wiki/index.md'])
  })
})

describe('isEntryPage', () => {
  it('matches index/log at any depth', () => {
    expect(isEntryPage('index.md')).toBe(true)
    expect(isEntryPage('wiki/projects/x/index.md')).toBe(true)
    expect(isEntryPage('wiki/log.md')).toBe(true)
    expect(isEntryPage('wiki/a.md')).toBe(false)
  })
})

describe('formatLintReport', () => {
  it('summarizes and always appends the semantic-check reminder', () => {
    const out = formatLintReport(computeLint(KB))
    expect(out).toContain('KB structural health — 6 pages')
    expect(out).toContain('Broken wikilinks')
    expect(out).toMatch(/confirm scope with the user|ask the user/i)
  })

  it('reports a clean KB', () => {
    // index links both; a and b cross-link each other → each has content inbound.
    const clean = new Map<string, LintPage>([
      ['wiki/index.md', page(FM + 'i\n'.repeat(12), ['wiki/a.md', 'wiki/b.md'])],
      ['wiki/a.md', page(FM + 'a\n'.repeat(12), ['wiki/b.md'])],
      ['wiki/b.md', page(FM + 'b\n'.repeat(12), ['wiki/a.md'])],
    ])
    expect(formatLintReport(computeLint(clean))).toContain('No structural issues found.')
  })
})
