import { describe, it, expect } from 'vitest'
import { suggestLinks, groupSuggestions } from './connect'
import type { LintPage } from './lint'

const page = (content: string, outgoing: string[] = []): LintPage => ({
  content,
  outgoing,
  broken: [],
})

const kb = (entries: Record<string, LintPage>): Map<string, LintPage> =>
  new Map(Object.entries(entries))

/** A target page, titled, with nothing in it that could match anything else. */
const target = (title: string): LintPage => page(`---\ntitle: ${title}\n---\n\nbody\n`)

describe('suggestLinks', () => {
  it('finds a page named in prose and not linked to', () => {
    const found = suggestLinks(
      kb({
        'wiki/attention.md': target('Attention'),
        'wiki/notes.md': page('# Notes\n\nThe attention mechanism is the point.\n'),
      }),
    )
    expect(found).toEqual([
      {
        from: 'wiki/notes.md',
        to: 'wiki/attention.md',
        term: 'attention',
        line: 3,
        excerpt: 'The attention mechanism is the point.',
      },
    ])
  })

  it('says nothing about a link that is already there', () => {
    const found = suggestLinks(
      kb({
        'wiki/attention.md': target('Attention'),
        'wiki/notes.md': page('# Notes\n\nSee [[wiki/attention]], on attention.\n', [
          'wiki/attention.md',
        ]),
      }),
    )
    expect(found).toEqual([])
  })

  it('does not read a code sample as a mention', () => {
    // The mask that matters most: any KB with code in it is otherwise all
    // false positives.
    const found = suggestLinks(
      kb({
        'wiki/attention.md': target('Attention'),
        'wiki/notes.md': page(
          '# Notes\n\n```python\nattention = softmax(q @ k.T)\n```\n\nand `attention` inline.\n',
        ),
      }),
    )
    expect(found).toEqual([])
  })

  it('does not match across a masked span', () => {
    // Masking with spaces instead of NULs would let this collapse into the
    // two-word name and invent a match the file does not contain.
    const found = suggestLinks(
      kb({
        'wiki/kv-cache.md': target('KV cache'),
        'wiki/notes.md': page('# Notes\n\nthe kv `x` cache is elsewhere\n'),
      }),
    )
    expect(found).toEqual([])
  })

  it('leaves frontmatter alone', () => {
    const found = suggestLinks(
      kb({
        'wiki/attention.md': target('Attention'),
        'wiki/notes.md': page('---\ntags: [attention]\n---\n\n# Notes\n\nbody\n'),
      }),
    )
    expect(found).toEqual([])
  })

  it('does not put a link inside a link that already points elsewhere', () => {
    const found = suggestLinks(
      kb({
        'wiki/attention.md': target('Attention'),
        'wiki/notes.md': page('# Notes\n\n[the attention paper](https://example.com/a.pdf)\n'),
      }),
    )
    expect(found).toEqual([])
  })

  it('holds a Latin name to word boundaries', () => {
    const found = suggestLinks(
      kb({
        'wiki/rag.md': target('RAG'),
        'wiki/notes.md': page('# Notes\n\nstorage and dragging are not RAG-adjacent\n'),
      }),
    )
    // The one real mention is the hyphenated one, which ends at a boundary.
    expect(found.map((s) => s.line)).toEqual([3])
    expect(found[0].term).toBe('RAG')
  })

  it('reads a hyphen and a space as the same separator, both ways', () => {
    const both = suggestLinks(
      kb({
        'wiki/machine-learning.md': page('# Machine Learning\n\nbody\n'),
        'wiki/a.md': page('# A\n\nabout machine learning generally\n'),
        'wiki/b.md': page('# B\n\nabout machine-learning generally\n'),
      }),
    )
    expect(both.map((s) => s.from)).toEqual(['wiki/a.md', 'wiki/b.md'])
    expect(both.map((s) => s.term)).toEqual(['machine learning', 'machine-learning'])
  })

  it('uses a name that two pages answer to for neither', () => {
    // A suggestion that guesses is worse than none: it is the first thing a
    // reviewer catches, and after catching it they stop trusting the rest.
    const found = suggestLinks(
      kb({
        'wiki/a/scaling.md': target('Scaling'),
        'wiki/b/scaling.md': target('Scaling'),
        'wiki/notes.md': page('# Notes\n\nall about scaling\n'),
      }),
    )
    expect(found).toEqual([])
  })

  it('suggests one link per pair, however many times the name appears', () => {
    const found = suggestLinks(
      kb({
        'wiki/attention.md': target('Attention'),
        'wiki/notes.md': page('# Notes\n\nattention\n\nattention\n\nattention again\n'),
      }),
    )
    expect(found).toHaveLength(1)
    expect(found[0].line).toBe(3)
  })

  it('does not suggest that a page link to itself', () => {
    const found = suggestLinks(
      kb({ 'wiki/attention.md': page('# Attention\n\nattention is all you need\n') }),
    )
    expect(found).toEqual([])
  })

  it('leaves index, log and capture pages out of it', () => {
    const found = suggestLinks(
      kb({
        'wiki/index.md': page('# Index\n\nbody\n'),
        'log.md': page('# Log\n\nbody\n'),
        'raw/daily/2026-09-01.md': page('# 2026-09-01\n\nthoughts on attention\n'),
        'wiki/attention.md': target('Attention'),
        'wiki/notes.md': page('# Notes\n\nthe index and the log say nothing here\n'),
      }),
    )
    // Nothing points at index/log (not subjects), and the day's jottings are
    // material — the links belong in whatever gets written out of them.
    expect(found).toEqual([])
  })

  it('matches a CJK name without word boundaries to hold it', () => {
    const found = suggestLinks(
      kb({
        'wiki/attention.md': target('注意力'),
        'wiki/notes.md': page('# 笔记\n\n这一段讲的是注意力机制。\n'),
      }),
    )
    expect(found).toHaveLength(1)
    expect(found[0].term).toBe('注意力')
  })

  it('will not carry a name too short to mean anything', () => {
    const found = suggestLinks(
      kb({
        'wiki/ai.md': target('AI'),
        'wiki/notes.md': page('# Notes\n\nall about AI\n'),
      }),
    )
    expect(found).toEqual([])
  })

  it('prefers the longer name where two could match at once', () => {
    const found = suggestLinks(
      kb({
        'wiki/cache.md': target('Cache'),
        'wiki/kv-cache.md': target('KV cache'),
        'wiki/notes.md': page('# Notes\n\nthe kv cache grows\n'),
      }),
    )
    expect(found.map((s) => s.to)).toEqual(['wiki/kv-cache.md'])
  })

  it('crops a long line around the match rather than from the start', () => {
    const filler = 'x '.repeat(120)
    const found = suggestLinks(
      kb({
        'wiki/attention.md': target('Attention'),
        'wiki/notes.md': page(`# Notes\n\n${filler}attention ${filler}\n`),
      }),
    )
    expect(found[0].excerpt).toContain('attention')
    expect(found[0].excerpt.startsWith('…')).toBe(true)
    expect(found[0].excerpt.endsWith('…')).toBe(true)
  })

  it('finds a page by its file stem when it has no title', () => {
    const found = suggestLinks(
      kb({
        'wiki/beam-search.md': page('no heading, no frontmatter\n'),
        'wiki/notes.md': page('# Notes\n\ntried beam search first\n'),
      }),
    )
    expect(found.map((s) => s.to)).toEqual(['wiki/beam-search.md'])
  })
})

describe('groupSuggestions', () => {
  it('gathers mentions under the page they point at, busiest first', () => {
    // One group is one decision: "everything that says X should link to X".
    const pages = kb({
      'wiki/attention.md': target('Attention'),
      'wiki/scaling.md': target('Scaling'),
      'wiki/a.md': page('# A\n\nattention and scaling\n'),
      'wiki/b.md': page('# B\n\nattention again\n'),
    })
    const groups = groupSuggestions(suggestLinks(pages), pages)
    expect(groups.map((g) => [g.to, g.name, g.mentions.length])).toEqual([
      ['wiki/attention.md', 'Attention', 2],
      ['wiki/scaling.md', 'Scaling', 1],
    ])
  })
})
