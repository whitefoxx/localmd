import { describe, it, expect } from 'vitest'
import { landingPath } from './landing'

const TODAY = new Date(2026, 8, 1)

describe('landingPath', () => {
  it("opens today's capture page when the day already has one", () => {
    const files = ['wiki/index.md', 'raw/daily/2026-09-01.md']
    expect(landingPath(files, TODAY)).toBe('raw/daily/2026-09-01.md')
  })

  it('falls back to the index when today has nothing written yet', () => {
    // Yesterday's page is NOT opened: landing answers "where does writing go
    // now", and tab memory already covers "where was I".
    const files = ['wiki/index.md', 'raw/daily/2026-08-31.md']
    expect(landingPath(files, TODAY)).toBe('wiki/index.md')
  })

  it('never invents a page for a day nobody wrote in', () => {
    const files = ['raw/papers/x.pdf']
    expect(landingPath(files, TODAY)).toBeNull()
  })

  it('reads the index by name, in the order the lint does', () => {
    expect(landingPath(['index.md', 'notes/a.md'], TODAY)).toBe('index.md')
    expect(landingPath(['index.md', 'wiki/index.md'], TODAY)).toBe('wiki/index.md')
  })

  it("finds today's page wherever the user keeps it", () => {
    expect(landingPath(['journals/2026-09-01.md', 'wiki/index.md'], TODAY)).toBe(
      'journals/2026-09-01.md',
    )
  })
})
