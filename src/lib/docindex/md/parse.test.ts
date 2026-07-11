import { describe, it, expect } from 'vitest'
import { enumerateMarkdownBlocks, parseMarkdownDoc } from './parse'

const DOC = `# Title

First paragraph.

## Section Two

Second paragraph.

- a list
- of items
`

describe('enumerateMarkdownBlocks', () => {
  it('assigns b<section>-<n> ids, breaking sections at H1/H2', () => {
    const ids = enumerateMarkdownBlocks(DOC).map((b) => b.id)
    expect(ids).toEqual(['b1-1', 'b1-2', 'b2-1', 'b2-2', 'b2-3'])
  })

  it('starts section 1 even without a leading heading', () => {
    const ids = enumerateMarkdownBlocks('just text\n\nmore text').map((b) => b.id)
    expect(ids).toEqual(['b1-1', 'b1-2'])
  })
})

describe('parseMarkdownDoc', () => {
  it('groups blocks into titled sections', () => {
    const sections = parseMarkdownDoc(DOC, 'fallback')
    expect(sections).toHaveLength(2)
    expect(sections[0].title).toBe('Title')
    expect(sections[1].title).toBe('Section Two')
    expect(sections[1].blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list'])
  })

  it('uses the fallback title when the first section has no heading', () => {
    const sections = parseMarkdownDoc('plain intro text', 'My Doc')
    expect(sections[0].title).toBe('My Doc')
  })
})
