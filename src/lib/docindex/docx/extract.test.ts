import { describe, it, expect } from 'vitest'
import { escapeHtml, headingLevel, renderList, safeHref } from './extract'

/* The XML walk itself needs a DOM, so it is exercised in the browser; these
   cover the decisions that turn Word's markup into our structure. */

describe('headingLevel', () => {
  it('reads the level from the style id or its name', () => {
    expect(headingLevel('Heading1', 'heading 1')).toBe(1)
    expect(headingLevel('Heading3', 'heading 3')).toBe(3)
    expect(headingLevel('berschrift2', 'heading 2')).toBe(2) // localized style id
    expect(headingLevel('Heading9', 'heading 9')).toBe(6) // clamped to <h6>
  })

  it('treats title and subtitle as the top two levels', () => {
    expect(headingLevel('Title', 'Title')).toBe(1)
    expect(headingLevel('Subtitle', 'Subtitle')).toBe(2)
  })

  it('is 0 for body styles', () => {
    expect(headingLevel('Normal', 'Normal')).toBe(0)
    expect(headingLevel('ListParagraph', 'List Paragraph')).toBe(0)
    expect(headingLevel(null, '')).toBe(0)
  })
})

describe('safeHref', () => {
  it('keeps navigable links', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeHref('  http://example.com  ')).toBe('http://example.com')
    expect(safeHref('mailto:a@b.com')).toBe('mailto:a@b.com')
  })

  it('drops everything else — a .docx is untrusted input', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('JavaScript:alert(1)')).toBeNull()
    expect(safeHref('file:///etc/passwd')).toBeNull()
    expect(safeHref('media/image1.png')).toBeNull()
    expect(safeHref('')).toBeNull()
  })
})

describe('escapeHtml', () => {
  it('neutralizes markup in document text', () => {
    expect(escapeHtml('<script>"x" & y</script>')).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; y&lt;/script&gt;',
    )
  })
})

describe('renderList', () => {
  const item = (level: number, id: string) => ({ level, id, html: id })

  it('renders a flat list', () => {
    expect(renderList({ ordered: false, items: [item(0, 'a'), item(0, 'b')] })).toBe(
      '<ul><li data-bid="a">a</li><li data-bid="b">b</li></ul>',
    )
  })

  it('nests a deeper level inside the item above it', () => {
    const out = renderList({
      ordered: true,
      items: [item(0, 'a'), item(1, 'a1'), item(1, 'a2'), item(0, 'b')],
    })
    expect(out).toBe(
      '<ol><li data-bid="a">a<ol><li data-bid="a1">a1</li><li data-bid="a2">a2</li></ol></li>' +
        '<li data-bid="b">b</li></ol>',
    )
  })

  it('closes every list it opens', () => {
    const out = renderList({ ordered: false, items: [item(0, 'a'), item(2, 'deep')] })
    expect(out.match(/<ul>/g)).toHaveLength(out.match(/<\/ul>/g)?.length ?? 0)
    expect(out.match(/<li /g)).toHaveLength(out.match(/<\/li>/g)?.length ?? 0)
  })
})
