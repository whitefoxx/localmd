import { describe, it, expect } from 'vitest'
import {
  parseWikilinks,
  parseMarkdownLinks,
  splitLink,
  splitFrontmatter,
  extractTitle,
  baseName,
  dirName,
  fileStem,
  escapeHtml,
} from './wiki'

describe('parseWikilinks', () => {
  it('finds targets and labels', () => {
    const links = parseWikilinks('See [[foo]] and [[bar|Bar Label]].')
    expect(links).toEqual([
      { target: 'foo', label: 'foo' },
      { target: 'bar', label: 'Bar Label' },
    ])
  })

  it('ignores plain text and empty content', () => {
    expect(parseWikilinks('no links here')).toEqual([])
    expect(parseWikilinks('')).toEqual([])
  })

  it('handles CJK targets and path-style targets', () => {
    const links = parseWikilinks('[[wiki/entities/阿德勒]] [[概念|说明]]')
    expect(links[0].target).toBe('wiki/entities/阿德勒')
    expect(links[1]).toEqual({ target: '概念', label: '说明' })
  })
})

describe('parseMarkdownLinks', () => {
  it('finds absolute, relative, and bare page links', () => {
    const md = 'See [a](/tables/customers.md), [b](./orders.md), [c](../metrics/wau).'
    expect(parseMarkdownLinks(md)).toEqual([
      '/tables/customers.md',
      './orders.md',
      '../metrics/wau',
    ])
  })

  it('skips external links, anchors, images, and non-page assets', () => {
    const md =
      '[ext](https://x.com) [mail](mailto:a@b.c) [anchor](#top) ' +
      '![img](./pic.png) [pdf](./paper.pdf) [proto](//cdn.x/y.md)'
    expect(parseMarkdownLinks(md)).toEqual([])
  })

  it('strips query strings, fragments, and link titles', () => {
    const md = '[a](/a.md?v=2#sec) [b](./b.md "Tooltip") [c](<./c d.md>)'
    expect(parseMarkdownLinks(md)).toEqual(['/a.md', './b.md', './c d.md'])
  })
})

describe('splitLink', () => {
  it('trims whitespace around target and label', () => {
    expect(splitLink(' foo | Bar ')).toEqual({ target: 'foo', label: 'Bar' })
  })
  it('falls back to target as label', () => {
    expect(splitLink('foo')).toEqual({ target: 'foo', label: 'foo' })
  })
})

describe('splitFrontmatter', () => {
  it('splits YAML frontmatter from the body', () => {
    const { yaml, body } = splitFrontmatter('---\ntitle: Hi\n---\n# Body')
    expect(yaml).toBe('title: Hi')
    expect(body).toBe('# Body')
  })
  it('returns null yaml when there is no frontmatter', () => {
    const { yaml, body } = splitFrontmatter('# Just a doc')
    expect(yaml).toBeNull()
    expect(body).toBe('# Just a doc')
  })
})

describe('extractTitle', () => {
  it('prefers the frontmatter title', () => {
    expect(extractTitle('---\ntitle: "From YAML"\n---\n# From H1')).toBe('From YAML')
  })
  it('falls back to the first H1', () => {
    expect(extractTitle('intro\n\n# The Title\n\nmore')).toBe('The Title')
  })
  it('returns null when neither exists', () => {
    expect(extractTitle('plain text only')).toBeNull()
  })
})

describe('path helpers', () => {
  it('baseName / dirName / fileStem', () => {
    expect(baseName('wiki/concepts/foo.md')).toBe('foo.md')
    expect(dirName('wiki/concepts/foo.md')).toBe('wiki/concepts')
    expect(fileStem('wiki/concepts/foo.md')).toBe('foo')
    expect(fileStem('noext')).toBe('noext')
  })
})

describe('escapeHtml', () => {
  it('escapes the five specials', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    )
  })
})
