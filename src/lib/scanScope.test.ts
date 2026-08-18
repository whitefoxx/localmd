import { describe, it, expect } from 'vitest'
import { isIgnored, DEFAULT_HEALTH_IGNORE } from './scanScope'

describe('scan scope', () => {
  it('a directory pattern covers everything under it, with or without the slash', () => {
    expect(isIgnored('raw/papers/a.md', ['raw/'])).toBe(true)
    expect(isIgnored('raw/papers/a.md', ['raw'])).toBe(true)
    expect(isIgnored('raw', ['raw/'])).toBe(true)
    // …and nothing that merely starts with the same letters.
    expect(isIgnored('rawer/a.md', ['raw/'])).toBe(false)
  })

  it('a pattern with a slash is anchored at the KB root, like git', () => {
    expect(isIgnored('wiki/drafts/note.md', ['wiki/drafts'])).toBe(true)
    expect(isIgnored('other/wiki/drafts/note.md', ['wiki/drafts'])).toBe(false)
  })

  it('a bare name matches at any depth, as a file or as a directory', () => {
    expect(isIgnored('AGENTS.md', ['AGENTS.md'])).toBe(true)
    expect(isIgnored('wiki/AGENTS.md', ['AGENTS.md'])).toBe(true)
    expect(isIgnored('a/.agents/skills/s.md', ['.agents'])).toBe(true)
  })

  it('* matches within one segment and never across a slash', () => {
    expect(isIgnored('wiki/scratch.tmp.md', ['*.tmp.md'])).toBe(true)
    expect(isIgnored('raw/papers/a.pdf', ['raw/*.pdf'])).toBe(false) // one level down
    expect(isIgnored('raw/a.pdf', ['raw/*.pdf'])).toBe(true)
  })

  it('ignores blank and whitespace-only lines rather than matching everything', () => {
    expect(isIgnored('wiki/a.md', ['', '   '])).toBe(false)
  })

  it('the defaults skip the source tree and the convention files', () => {
    const d = [...DEFAULT_HEALTH_IGNORE]
    expect(isIgnored('raw/papers/paper.pdf', d)).toBe(true)
    expect(isIgnored('.agents/skills/harvest/SKILL.md', d)).toBe(true)
    expect(isIgnored('AGENTS.md', d)).toBe(true)
    expect(isIgnored('CLAUDE.md', d)).toBe(true)
    // The wiki itself is what the check is for.
    expect(isIgnored('wiki/index.md', d)).toBe(false)
    expect(isIgnored('MEMORY.md', d)).toBe(false)
  })
})
