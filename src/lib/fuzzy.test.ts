import { describe, it, expect } from 'vitest'
import { fuzzyMatch, fuzzyRank } from './fuzzy'

/** The matched substring, for asserting *where* a match landed. */
function matched(needle: string, haystack: string): string | null {
  const m = fuzzyMatch(needle, haystack)
  return m ? m.positions.map((i) => haystack[i]).join('') : null
}

function score(needle: string, haystack: string): number {
  return fuzzyMatch(needle, haystack)?.score ?? -Infinity
}

describe('fuzzyMatch', () => {
  it('matches a subsequence and reports where', () => {
    const m = fuzzyMatch('wkchn', 'wiki/chain-of-thought.md')!
    expect(m).not.toBeNull()
    expect(matched('wkchn', 'wiki/chain-of-thought.md')).toBe('wkchn')
    expect(m.positions).toEqual([...m.positions].sort((a, b) => a - b))
  })

  it('is null when the characters are not in order', () => {
    expect(fuzzyMatch('kw', 'wiki.md')).toBeNull()
    expect(fuzzyMatch('xyz', 'wiki.md')).toBeNull()
    expect(fuzzyMatch('wikis', 'wiki')).toBeNull() // needle longer than haystack
  })

  it('is case-insensitive but reports positions in the original', () => {
    const m = fuzzyMatch('rm', 'README.md')!
    expect(m.positions[0]).toBe(0)
    expect('README.md'[m.positions[0]]).toBe('R')
  })

  it('an empty needle matches anything, scoring nothing', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] })
  })

  it('picks the best layout, not the first one a greedy scan would take', () => {
    // Greedy takes m(0)+d(3) inside "markdown"; the extension is what was meant.
    expect(matched('md', 'markdown/todo.md')).toBe('md')
    expect(fuzzyMatch('md', 'markdown/todo.md')!.positions).toEqual([14, 15])
  })

  it('prefers characters that run together', () => {
    expect(score('abc', 'abc')).toBeGreaterThan(score('abc', 'a-b-c'))
  })

  it('a run from a word start beats the same letters scattered across words', () => {
    // The acronym reading is valuable, but a file actually named `cot` is what
    // someone typing "cot" means. A run inherits its start-of-word bonus so it
    // outscores three separate boundary hits.
    expect(score('cot', 'wiki/cot.md')).toBeGreaterThan(score('cot', 'chain-of-thought.md'))
    // …and the acronym still matches, ranked below it.
    expect(fuzzyMatch('cot', 'chain-of-thought.md')).not.toBeNull()
  })

  it('prefers characters that start a word or path segment', () => {
    // Same needle, same contiguity — one lands on segment starts.
    expect(score('ab', 'a/b')).toBeGreaterThan(score('ab', 'xaxb'))
    expect(score('cot', 'chain/of/thought')).toBeGreaterThan(score('cot', 'chocolate'))
  })

  it('prefers a match near the start, without ruling out a late one', () => {
    expect(score('note', 'notes.md')).toBeGreaterThan(score('note', 'archive/2019/note.md'))
    expect(fuzzyMatch('note', 'archive/2019/note.md')).not.toBeNull()
  })

  it('refuses absurdly long haystacks rather than scoring them', () => {
    expect(fuzzyMatch('a', 'a'.repeat(401))).toBeNull()
    expect(fuzzyMatch('a', 'a'.repeat(400))).not.toBeNull()
  })
})

describe('fuzzyRank', () => {
  const files = [
    'wiki/index.md',
    'raw/papers/chain-of-thought-prompting.pdf',
    'wiki/chain-of-thought.md',
    'inbox/notes.md',
  ]

  it('ranks matches and drops the rest', () => {
    const out = fuzzyRank('chain', files, (f) => f)
    expect(out.map((r) => r.item)).toEqual([
      'wiki/chain-of-thought.md',
      'raw/papers/chain-of-thought-prompting.pdf',
    ])
  })

  it('breaks ties toward the shorter name, then alphabetically', () => {
    const out = fuzzyRank('a', ['a/bbbb', 'a/cc', 'a/bb'], (f) => f)
    expect(out.map((r) => r.item)).toEqual(['a/bb', 'a/cc', 'a/bbbb'])
  })

  it('an empty needle keeps everything in tie-break order', () => {
    expect(fuzzyRank('', files, (f) => f)).toHaveLength(4)
  })
})
