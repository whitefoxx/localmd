import { describe, it, expect } from 'vitest'
import { todayIso, dailyDateOf, isDailyPath, resolveDailyPath, appendJot } from './daily'

describe('todayIso', () => {
  it('reads the local calendar day, not the UTC one', () => {
    // 21:30 local on the 1st. toISOString() would say the 2nd anywhere east of
    // UTC+3, which is the bug this function exists to avoid.
    const d = new Date(2026, 8, 1, 21, 30)
    expect(todayIso(d)).toBe('2026-09-01')
  })

  it('pads single-digit months and days', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('dailyDateOf', () => {
  it('accepts a dated markdown file at any depth', () => {
    expect(dailyDateOf('2026-09-01.md')).toBe('2026-09-01')
    expect(dailyDateOf('raw/daily/2026-09-01.md')).toBe('2026-09-01')
    expect(isDailyPath('Journal/2026-09-01.md')).toBe(true)
  })

  it('rejects anything that only looks dated', () => {
    expect(dailyDateOf('raw/papers/2026-09-01-attention.pdf')).toBeNull()
    expect(dailyDateOf('wiki/2026-09.md')).toBeNull()
    expect(dailyDateOf('log.md')).toBeNull()
    expect(isDailyPath('raw/daily/2026-09-01.txt')).toBe(false)
  })
})

describe('resolveDailyPath', () => {
  it('uses the file that already exists, wherever the user keeps it', () => {
    const files = ['wiki/index.md', 'Journal/2026-09-01.md']
    expect(resolveDailyPath('2026-09-01', files, true)).toBe('Journal/2026-09-01.md')
  })

  it('prefers the shallowest when the same name exists twice', () => {
    const files = ['archive/old/2026-09-01.md', 'daily/2026-09-01.md']
    expect(resolveDailyPath('2026-09-01', files, false)).toBe('daily/2026-09-01.md')
  })

  it("files a new day where the KB's other dated pages live", () => {
    // An Obsidian/Logseq folder opened as-is: nothing to configure, the
    // convention is read off the files that are already there.
    const files = ['journals/2026-08-30.md', 'journals/2026-08-31.md', 'wiki/index.md']
    expect(resolveDailyPath('2026-09-01', files, true)).toBe('journals/2026-09-01.md')
  })

  it('lets a year of journals outvote one stray dated file', () => {
    const files = [
      'archive/2019-03-04.md',
      'journals/2026-08-30.md',
      'journals/2026-08-31.md',
    ]
    expect(resolveDailyPath('2026-09-01', files, true)).toBe('journals/2026-09-01.md')
  })

  it('falls back beside the other intake — raw/ where there is one, inbox/ elsewhere', () => {
    expect(resolveDailyPath('2026-09-01', ['raw/papers/x.pdf'], true)).toBe(
      'raw/daily/2026-09-01.md',
    )
    expect(resolveDailyPath('2026-09-01', ['notes/x.md'], false)).toBe(
      'inbox/daily/2026-09-01.md',
    )
  })
})

describe('appendJot', () => {
  it('opens a new page with its date and nothing to fill in', () => {
    expect(appendJot('', 'buy oat milk', '2026-09-01')).toBe('# 2026-09-01\n\n- buy oat milk\n')
  })

  it('appends to the end of a page that already has lines', () => {
    const before = '# 2026-09-01\n\n- first\n'
    expect(appendJot(before, 'second', '2026-09-01')).toBe('# 2026-09-01\n\n- first\n- second\n')
  })

  it('splits a pasted paragraph into one bullet per line', () => {
    expect(appendJot('', 'one\n\ntwo\n', '2026-09-01')).toBe('# 2026-09-01\n\n- one\n- two\n')
  })

  it('leaves a line that is already a list item alone', () => {
    expect(appendJot('', '- already a bullet', '2026-09-01')).toBe(
      '# 2026-09-01\n\n- already a bullet\n',
    )
    expect(appendJot('', '1. numbered', '2026-09-01')).toBe('# 2026-09-01\n\n1. numbered\n')
  })

  it('is a no-op for whitespace, so an accidental Enter writes nothing', () => {
    expect(appendJot('# 2026-09-01\n', '   \n  ', '2026-09-01')).toBe('# 2026-09-01\n')
  })
})
