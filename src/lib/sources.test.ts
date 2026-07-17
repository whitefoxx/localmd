import { describe, it, expect } from 'vitest'
import { classifyAnchor, createSourceCollector, type AnchorInfo } from './sources'

const anchor = (a: Partial<AnchorInfo>): AnchorInfo => ({
  classes: [],
  href: null,
  text: '',
  ...a,
})

describe('classifyAnchor', () => {
  it('treats a resolved wikilink as a KB file source', () => {
    expect(
      classifyAnchor(anchor({ classes: ['wikilink'], dataResolved: '1', dataTarget: 'wiki/foo.md', text: 'Foo' })),
    ).toEqual({ kind: 'file', target: 'wiki/foo.md', label: 'Foo' })
  })

  it('ignores a broken wikilink', () => {
    expect(classifyAnchor(anchor({ classes: ['wikilink', 'wikilink-broken'], text: 'Nope' }))).toBeNull()
  })

  it('treats an http(s) link as a url source, labelled by text then href', () => {
    expect(classifyAnchor(anchor({ href: 'https://example.com/x', text: 'Example' }))).toEqual({
      kind: 'url',
      target: 'https://example.com/x',
      label: 'Example',
    })
    expect(classifyAnchor(anchor({ href: 'http://a.co' }))).toEqual({
      kind: 'url',
      target: 'http://a.co',
      label: 'http://a.co',
    })
  })

  it('treats a relative markdown link as a KB file source', () => {
    expect(classifyAnchor(anchor({ href: 'wiki/bar.md', text: 'Bar' }))).toEqual({
      kind: 'file',
      target: 'wiki/bar.md',
      label: 'Bar',
    })
  })

  it('ignores block citations, in-page anchors, mailto and other schemes', () => {
    expect(classifyAnchor(anchor({ classes: ['citation'], text: '[1]' }))).toBeNull()
    expect(classifyAnchor(anchor({ classes: ['cite-source'] }))).toBeNull()
    expect(classifyAnchor(anchor({ classes: ['src-cite-ref'], text: '1' }))).toBeNull()
    expect(classifyAnchor(anchor({ href: '#section' }))).toBeNull()
    expect(classifyAnchor(anchor({ href: 'mailto:a@b.c' }))).toBeNull()
    expect(classifyAnchor(anchor({ href: 'data:text/plain,hi' }))).toBeNull()
  })
})

describe('createSourceCollector', () => {
  it('numbers by first appearance and dedupes by kind+target', () => {
    const c = createSourceCollector()
    expect(c.collect({ kind: 'file', target: 'wiki/a.md', label: 'A' })).toBe(1)
    expect(c.collect({ kind: 'url', target: 'https://x.com', label: 'X' })).toBe(2)
    expect(c.collect({ kind: 'file', target: 'wiki/a.md', label: 'A again' })).toBe(1) // dedupe
    expect(c.collect({ kind: 'file', target: 'wiki/b.md', label: 'B' })).toBe(3)
    expect(c.sources.map((s) => [s.n, s.kind, s.target])).toEqual([
      [1, 'file', 'wiki/a.md'],
      [2, 'url', 'https://x.com'],
      [3, 'file', 'wiki/b.md'],
    ])
  })
})
