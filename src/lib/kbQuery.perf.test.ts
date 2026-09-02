import { describe, it, expect } from 'vitest'
import { parseKbQuery, matchingPaths, hasFilters, type QueryPage } from './kbQuery'

const NOW = Date.parse('2026-09-01T00:00:00Z')

/** A corpus larger than most real knowledge bases, to bound the palette's
 *  per-keystroke cost when a filter is present. */
const PAGES: QueryPage[] = Array.from({ length: 2000 }, (_, i) => ({
  path: `wiki/page-${i}.md`,
  content: `---\ntype: concept\ntags: [t${i % 40}, common]\nstatus: ${i % 3 ? 'done' : 'draft'}\nrating: ${i % 10}\n---\n# Page ${i}\n${'body words here. '.repeat(30)}`,
  outgoing: [`wiki/page-${(i + 1) % 2000}.md`],
  broken: [],
  mtime: NOW - i * 3600_000,
}))

/**
 * A smoke alarm, not a budget. The threshold sits several times above what
 * this actually measures (2-7ms), because a tight timing assertion running in
 * a parallel worker pool on a loaded machine is a test that fails for reasons
 * that have nothing to do with the code. What it catches is the regression
 * that matters: someone making this accidentally quadratic, or reading every
 * page's content to answer a filter that never needed it.
 */
describe('palette hot path', () => {
  it('does not touch the engine at all without a filter', () => {
    // Plain typing is the common case and still goes straight to the panel's
    // own search, exactly as before this grammar arrived.
    expect(hasFilters(parseKbQuery('some words i am typing', NOW).query)).toBe(false)
  })

  it('stays inside a keystroke on a corpus larger than most real ones', () => {
    const shapes = [
      'path:page-1',                 // cheapest: rejects on the path, no content read
      'tag:common',                  // the ordinary palette filter
      'type:concept',
      'fm:status=draft',
      'type:concept fm:status=draft tag:common', // worst case: three content reads, nothing rejected early
    ]
    for (const shape of shapes) {
      const q = parseKbQuery(shape, NOW).query
      const t = performance.now()
      for (let i = 0; i < 20; i++) matchingPaths(PAGES, q)
      const ms = (performance.now() - t) / 20
      console.log(`${ms.toFixed(2)}ms  ${shape}`)
      expect(ms, shape).toBeLessThan(50)
    }
  })
})
