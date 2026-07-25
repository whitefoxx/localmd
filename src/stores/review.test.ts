import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import * as fs from '@/lib/fs'
import { createMemoryRoot } from '@/lib/memfs'
import { useReviewStore, isRestorable } from './review'

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

describe('review store — deletions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fs.setRoot(createMemoryRoot())
  })

  it('restores a deleted text file on discard', async () => {
    const review = useReviewStore()
    review.recordDelete('wiki/a.md', '# A\n', false)
    expect(isRestorable(review.changes[0])).toBe(true)

    await review.discard('wiki/a.md')
    expect(await fs.readFile('wiki/a.md')).toBe('# A\n')
    expect(review.count).toBe(0)
  })

  it('never writes a directory listing back over the removed folder', async () => {
    const review = useReviewStore()
    review.recordDelete('inbox', 'inbox/a.md\ninbox/b.md', true)
    expect(isRestorable(review.changes[0])).toBe(false)

    await review.discard('inbox')
    expect(await fs.statKind('inbox')).toBe(null)
    expect(review.count).toBe(0)
  })

  it('keeps the pre-agent snapshot when a file it wrote is then deleted', async () => {
    const review = useReviewStore()
    review.recordWrite('wiki/a.md', 'original\n', 'rewritten\n')
    review.recordDelete('wiki/a.md', 'rewritten\n', false)

    expect(review.count).toBe(1)
    await review.discard('wiki/a.md')
    expect(await fs.readFile('wiki/a.md')).toBe('original\n')
  })

  it('leaves an agent-created file deleted — its pre-agent state was absent', async () => {
    const review = useReviewStore()
    review.recordWrite('wiki/new.md', null, 'N')
    review.recordDelete('wiki/new.md', 'N', false)

    await review.discard('wiki/new.md')
    expect(await fs.exists('wiki/new.md')).toBe(false)
    expect(review.count).toBe(0)
  })
})
