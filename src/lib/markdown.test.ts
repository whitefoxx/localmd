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

  it('a citation inside code stays literal — writing about a chip is not one', () => {
    // The agent quotes a token when it explains a citation rather than making
    // one. Rewriting that produced a chunk of raw anchor HTML in the code span.
    const inline = renderMarkdown('the note cites `[[1:b16-3]]` there', resolver)
    expect(inline).toContain('<code>[[1:b16-3]]</code>')
    expect(inline).not.toContain('class="citation"')

    const fenced = renderMarkdown('```\nsee [[1:b16-3]] and [[pdf1:raw/x.pdf]]\n```', resolver)
    expect(fenced).toContain('[[1:b16-3]]')
    expect(fenced).not.toContain('class="citation"')
    expect(fenced).not.toContain('class="cite-source"')

    // A real citation in the same document still renders.
    const both = renderMarkdown('`[[1:b1-1]]` is written as a token.\n\nreal [[1:b2-2]]', resolver)
    expect(both).toContain('<code>[[1:b1-1]]</code>')
    expect(both).toContain('data-block="b2-2"')
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

describe('file paths in code spans', () => {
  const KB = new Set(['wiki/projects/copyable-project-ideas.md', 'raw/books/全球通史.pdf'])
  const withPaths = { resolvePath: (t: string) => (KB.has(t) ? t : null) }

  it('links a code span that names a real file', () => {
    const html = renderMarkdown(
      'New file: `wiki/projects/copyable-project-ideas.md`',
      resolver,
      withPaths,
    )
    expect(html).toContain('class="file-path"')
    expect(html).toContain('data-path="wiki/projects/copyable-project-ideas.md"')
    // Still reads as a path: the code span survives inside the anchor.
    expect(html).toContain('<code>wiki/projects/copyable-project-ideas.md</code>')
  })

  it('leaves a code span that names no file completely alone', () => {
    const html = renderMarkdown('Run `npm run build` in `wiki/nope.md`', resolver, withPaths)
    expect(html).not.toContain('file-path')
    expect(html).toContain('<code>npm run build</code>')
    expect(html).toContain('<code>wiki/nope.md</code>')
  })

  it('does nothing at all without a resolver — a note keeps its code as code', () => {
    const html = renderMarkdown('`wiki/projects/copyable-project-ideas.md`', resolver)
    expect(html).not.toContain('file-path')
    expect(html).toContain('<code>')
  })

  it('resolves CJK paths, and paths inside prose', () => {
    const html = renderMarkdown('见 `raw/books/全球通史.pdf` 第一页', resolver, withPaths)
    expect(html).toContain('data-path="raw/books/全球通史.pdf"')
  })

  it('matches exactly — no trailing-slash, prefix or extension guessing', () => {
    for (const near of ['wiki/projects/', 'wiki/projects/copyable-project-ideas', 'copyable-project-ideas.md']) {
      expect(renderMarkdown(`\`${near}\``, resolver, withPaths)).not.toContain('file-path')
    }
  })

  it('ignores surrounding whitespace inside the span', () => {
    // Marked strips one space at each end; the resolver sees a trimmed path.
    expect(renderMarkdown('` wiki/projects/copyable-project-ideas.md `', resolver, withPaths)).toContain(
      'file-path',
    )
  })

  it('never linkifies inside a fenced block', () => {
    const html = renderMarkdown(
      '```\nwiki/projects/copyable-project-ideas.md\n```',
      resolver,
      withPaths,
    )
    expect(html).not.toContain('file-path')
  })

  it('escapes what it puts in the attribute', () => {
    const evil = 'wiki/"><img src=x>.md'
    const html = renderMarkdown(`\`${evil}\``, resolver, {
      resolvePath: (t) => (t === evil ? t : null),
    })
    expect(html).toContain('&quot;')
    expect(html).not.toContain('<img src=x>')
  })
})
