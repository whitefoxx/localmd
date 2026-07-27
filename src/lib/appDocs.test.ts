import { describe, it, expect } from 'vitest'
import { listAppDocs, appDoc } from './appDocs'

describe('app docs', () => {
  const docs = listAppDocs()

  it('ships a non-empty manual', () => {
    expect(docs.length).toBeGreaterThan(0)
  })

  it('gives every topic an id, a title and a summary', () => {
    for (const d of docs) {
      expect(d.id, `id of ${JSON.stringify(d)}`).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(d.title.length, `title of ${d.id}`).toBeGreaterThan(0)
      // The summary is the only thing the agent sees when picking a topic.
      expect(d.summary.length, `summary of ${d.id}`).toBeGreaterThan(20)
    }
  })

  it('strips frontmatter from the body', () => {
    for (const d of docs) {
      const body = appDoc(d.id)!.body
      expect(body.startsWith('---'), `${d.id} kept its frontmatter`).toBe(false)
      expect(body.length).toBeGreaterThan(100)
    }
  })

  it('resolves every cross-reference to a real topic', () => {
    // Docs close with a "Related" line naming sibling ids in backticks; a stale
    // one sends the agent to a topic that does not exist.
    const ids = new Set(docs.map((d) => d.id))
    const dangling: string[] = []
    for (const d of docs) {
      const related = /## Related\n([\s\S]*)$/.exec(appDoc(d.id)!.body)?.[1] ?? ''
      for (const m of related.matchAll(/`([a-z][a-z0-9-]*)`/g)) {
        if (!ids.has(m[1])) dangling.push(`${d.id} → ${m[1]}`)
      }
    }
    expect(dangling).toEqual([])
  })

  it('returns undefined for an unknown topic', () => {
    expect(appDoc('nope')).toBeUndefined()
  })
})
