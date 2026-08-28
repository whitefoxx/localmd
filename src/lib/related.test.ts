import { describe, it, expect } from 'vitest'
import { relatedTo } from './related'

const TAGS: Record<string, string[]> = {
  'wiki/a.md': ['llm', 'prompting'],
  'wiki/b.md': ['llm'],
  'wiki/c.md': ['cooking'],
  'wiki/d.md': ['llm', 'prompting'],
  'wiki/linked.md': ['llm'],
}
const SOURCES: Record<string, string[]> = {
  'wiki/a.md': ['raw/p.pdf'],
  'wiki/c.md': ['raw/p.pdf'],
  'wiki/e.md': ['raw/other.pdf'],
}
const input = (over: Partial<Parameters<typeof relatedTo>[0]> = {}) => ({
  path: 'wiki/a.md',
  backlinks: ['wiki/linked.md'],
  candidates: Object.keys({ ...TAGS, ...SOURCES }),
  tagsOf: (p: string) => TAGS[p] ?? [],
  sourcesOf: (p: string) => SOURCES[p] ?? [],
  ...over,
})

describe('relatedTo', () => {
  it('finds pages sharing a tag, strongest overlap first, with the reason', () => {
    const r = relatedTo(input())
    expect(r.byTag).toEqual([
      { path: 'wiki/d.md', shared: ['llm', 'prompting'] },
      { path: 'wiki/b.md', shared: ['llm'] },
    ])
  })

  it('finds pages citing the same source', () => {
    const r = relatedTo(input())
    expect(r.bySource).toEqual([{ path: 'wiki/c.md', shared: ['raw/p.pdf'] }])
  })

  /** Backlinks have their own heading above; repeating them makes a short
   *  list look long. */
  it('never repeats a backlink, or the file itself', () => {
    const r = relatedTo(input())
    const all = [...r.byTag, ...r.bySource].map((g) => g.path)
    expect(all).not.toContain('wiki/linked.md')
    expect(all).not.toContain('wiki/a.md')
  })

  it('puts a page that qualifies twice under the stronger heading only', () => {
    const r = relatedTo(
      input({ sourcesOf: (p: string) => (p === 'wiki/a.md' || p === 'wiki/b.md' ? ['raw/p.pdf'] : []) }),
    )
    expect(r.byTag.map((g) => g.path)).toContain('wiki/b.md')
    expect(r.bySource.map((g) => g.path)).not.toContain('wiki/b.md')
  })

  it('says nothing when the file has no tags and no sources', () => {
    const r = relatedTo(input({ path: 'wiki/untagged.md' }))
    expect(r).toEqual({ byTag: [], bySource: [] })
  })

  it('caps each group', () => {
    const many = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`wiki/x${i}.md`, ['llm']]),
    )
    const r = relatedTo(
      input({
        candidates: ['wiki/a.md', ...Object.keys(many)],
        tagsOf: (p: string) => (p === 'wiki/a.md' ? ['llm'] : (many[p] ?? [])),
      }),
    )
    expect(r.byTag).toHaveLength(8)
  })
})
