import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdown'

const resolver = {
  resolve: (t: string) => (t === 'existing' ? 'wiki/existing.md' : null),
}

describe('renderMarkdown', () => {
  it('renders resolved wikilinks as clickable anchors', () => {
    const html = renderMarkdown('See [[existing]].', resolver)
    expect(html).toContain('class="wikilink"')
    expect(html).toContain('data-target="wiki/existing.md"')
    expect(html).toContain('data-resolved="1"')
  })

  it('marks unresolved wikilinks as broken', () => {
    const html = renderMarkdown('See [[missing-page]].', resolver)
    expect(html).toContain('wikilink-broken')
    expect(html).toContain('data-target="missing-page"')
  })

  it('renders labels for aliased links', () => {
    const html = renderMarkdown('[[existing|Custom Label]]', resolver)
    expect(html).toContain('>Custom Label</a>')
  })

  it('strips frontmatter before rendering', () => {
    const html = renderMarkdown('---\ntitle: x\n---\n# Hello', resolver)
    expect(html).not.toContain('title: x')
    expect(html).toContain('<h1>Hello</h1>')
  })

  it('consumes citation tokens before the wikilink pass', () => {
    const html = renderMarkdown('[[pdf1:raw/x.pdf]]\n\nclaim [[1:b2-1]]', resolver)
    expect(html).toContain('class="cite-source"')
    expect(html).toContain('class="citation"')
    // The tokens must not be misparsed as broken wikilinks.
    expect(html).not.toContain('wikilink-broken')
  })

  it('renders GFM tables', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |', resolver)
    expect(html).toContain('<table>')
  })
})

describe('code highlighting', () => {
  it('highlights fenced blocks with a known language', () => {
    const html = renderMarkdown('```js\nconst x = 1\n```', resolver)
    expect(html).toContain('class="hljs language-javascript"')
    expect(html).toContain('hljs-keyword')
  })
  it('escapes unknown languages as plain text', () => {
    const html = renderMarkdown('```brainfuck\n<+++>\n```', resolver)
    expect(html).toContain('class="hljs"')
    expect(html).toContain('&lt;+++&gt;')
    expect(html).not.toContain('hljs-keyword')
  })
})
