import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useReviewStore } from './review'

describe('review store — markCommitted (git sync)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('drops committed paths from the review list, leaving the rest', () => {
    const review = useReviewStore()
    review.recordWrite('wiki/a.md', null, 'A')
    review.recordWrite('wiki/b.md', 'old', 'B')
    review.recordWrite('wiki/c.md', null, 'C')

    // Commit a subset — only those are approved and cleared.
    review.markCommitted(['wiki/a.md', 'wiki/c.md'])

    expect(review.count).toBe(1)
    expect(review.changes.map((c) => c.path)).toEqual(['wiki/b.md'])
  })

  it('ignores paths that are not under review', () => {
    const review = useReviewStore()
    review.recordWrite('wiki/a.md', null, 'A')
    review.markCommitted(['wiki/never-tracked.md'])
    expect(review.count).toBe(1)
  })

  it('keeps ask-mode writes still awaiting a decision (unwritten, so uncommittable)', () => {
    const review = useReviewStore()
    void review.askApproval('s1', 'wiki/pending.md', null, 'P')
    review.markCommitted(['wiki/pending.md'])
    expect(review.count).toBe(1)
    expect(review.changes[0].awaiting).toBe(true)
  })
})
