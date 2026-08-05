import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdown'

const resolver = {
  resolve: (t: string) => (t === 'existing' ? 'wiki/existing.md' : null),
}

describe('renderMarkdown — images', () => {
  it('defers knowledge-base paths to the viewer', () => {
    const html = renderMarkdown('![a shot](shot.png)', resolver)
    expect(html).toContain('data-kb-src="shot.png"')
    expect(html).toContain('alt="a shot"')
    expect(html).not.toMatch(/\ssrc=/) // no plain src the browser would try to fetch
  })

  it('leaves paths the browser can fetch alone', () => {
    for (const src of ['https://x.dev/a.png', 'data:image/png;base64,AA', '//cdn/x.png']) {
      expect(renderMarkdown(`![](${src})`, resolver)).toContain(`src="${src}"`)
    }
  })

  it('handles relative paths and percent-encoded spaces', () => {
    expect(renderMarkdown('![](../media/a.png)', resolver)).toContain(
      'data-kb-src="../media/a.png"',
    )
    // How the paste handler writes a name with a space; the store decodes it back.
    expect(renderMarkdown('![](a%20b.png)', resolver)).toContain('data-kb-src="a%20b.png"')
  })

  it('escapes a path that would break out of the attribute', () => {
    expect(renderMarkdown('![](a"b.png)', resolver)).not.toContain('data-kb-src="a"b')
  })
})

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

describe('math (KaTeX)', () => {
  it('renders inline $…$', () => {
    const html = renderMarkdown('质能方程 $E = mc^2$ 很有名', resolver)
    expect(html).toContain('katex')
    expect(html).not.toContain('$E = mc^2$')
  })
  it('renders display $$…$$ blocks', () => {
    const html = renderMarkdown('$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$', resolver)
    expect(html).toContain('katex-display')
  })
  it('leaves plain dollar amounts alone', () => {
    const html = renderMarkdown('价格是 $5 一件', resolver)
    expect(html).not.toContain('katex')
  })
  it('leaves paired dollar amounts alone (Pandoc rules)', () => {
    // "$5,那件 $10" once got swallowed as one formula spanning the two $s.
    const html = renderMarkdown('这件商品价格 $5,那件 $10,美元符号不该变成公式。', resolver)
    expect(html).not.toContain('katex')
    expect(html).toContain('$5')
    expect(html).toContain('$10')
  })
  it('renders CJK-adjacent inline math (no surrounding spaces)', () => {
    const html = renderMarkdown('当$x > 0$时,函数$f(x) = \\ln x$单调递增。', resolver)
    expect(html).toContain('katex')
    expect(html).not.toContain('$x > 0$')
  })
  it('renders single-line $$…$$ as display math', () => {
    const html = renderMarkdown('结论:$$E = mc^2$$', resolver)
    expect(html).toContain('katex-display')
  })
  it('does not treat citation tokens as math', () => {
    const html = renderMarkdown('claim [[1:b2-1]] holds for $x > 0$', resolver)
    expect(html).toContain('class="citation"')
    expect(html).toContain('katex')
  })
})
