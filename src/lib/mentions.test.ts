import { describe, it, expect } from 'vitest'
import { mentionQueryAt, filterFiles, extractMentions } from './mentions'

describe('mentionQueryAt', () => {
  it('detects an @ at the start of input', () => {
    expect(mentionQueryAt('@wi', 3)).toEqual({ start: 0, query: 'wi' })
  })
  it('detects an @ after whitespace', () => {
    expect(mentionQueryAt('see @raw/b', 10)).toEqual({ start: 4, query: 'raw/b' })
  })
  it('ignores @ inside a word (emails)', () => {
    expect(mentionQueryAt('a@b.com', 7)).toBeNull()
  })
  it('closes across newlines', () => {
    expect(mentionQueryAt('@wiki\nnext', 10)).toBeNull()
  })
  it('uses the caret position, not the string end', () => {
    expect(mentionQueryAt('@abc tail', 4)).toEqual({ start: 0, query: 'abc' })
  })
})

describe('filterFiles', () => {
  const files = [
    'wiki/index.md',
    'wiki/concepts/agent.md',
    'raw/books/毛泽东选集.pdf',
    'raw/images/capture-1.png',
  ]
  it('ranks basename prefix above substring matches', () => {
    expect(filterFiles(files, 'ag')[0]).toBe('wiki/concepts/agent.md')
  })
  it('matches anywhere in the path', () => {
    expect(filterFiles(files, 'books')).toEqual(['raw/books/毛泽东选集.pdf'])
  })
  it('matches CJK', () => {
    expect(filterFiles(files, '毛泽东')).toEqual(['raw/books/毛泽东选集.pdf'])
  })
  it('empty query returns shortest paths first, capped', () => {
    const out = filterFiles(files, '', 2)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe('wiki/index.md')
  })
})

describe('extractMentions', () => {
  const files = ['wiki/index.md', 'raw/images/capture-1.png', 'raw/books/How to Think.pdf']
  it('extracts known paths after @', () => {
    expect(extractMentions('看看 @wiki/index.md 的结构', files)).toEqual(['wiki/index.md'])
  })
  it('matches paths containing spaces (longest known match wins)', () => {
    expect(extractMentions('总结 @raw/books/How to Think.pdf 第一章', files)).toEqual([
      'raw/books/How to Think.pdf',
    ])
  })
  it('ignores unknown paths and emails', () => {
    expect(extractMentions('mail me a@b.com about @nope.md', files)).toEqual([])
  })
  it('dedupes repeated mentions', () => {
    expect(extractMentions('@wiki/index.md 和 @wiki/index.md', files)).toEqual(['wiki/index.md'])
  })
})
