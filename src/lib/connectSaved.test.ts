/**
 * Revalidating the browser's "this page is already saved" index.
 *
 * The extension learns an entry when we ack a clip, and then cannot see the
 * folder — so a note deleted here left a green tick and a dead path in its
 * popup (findings F-61). These pin the three answers: gone → forget, moved →
 * re-point, still there → say nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

let files = new Set<string>()
vi.mock('@/lib/fs', () => ({ exists: async (p: string) => files.has(p) }))

import {
  parseSavedPages,
  reconcileSavedPages,
  urlIndexOf,
  urlKey,
  LIST_SAVED_TOOL,
  SYNC_SAVED_TOOL,
} from '@/lib/connectSaved'
import { useKbStore } from '@/stores/kb'
import { useKbIndexStore } from '@/stores/kbIndex'

/** A fake extension holding `pages` in its index. */
function server(pages: unknown[]) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
  return {
    calls,
    sync: () => calls.find((c) => c.tool === SYNC_SAVED_TOOL),
    deps: {
      serverId: 'connect',
      call: async (tool: string, args: Record<string, unknown>) => {
        calls.push({ tool, args })
        if (tool === LIST_SAVED_TOOL) return JSON.stringify({ count: pages.length, pages })
        return '{}'
      },
    },
  }
}

const note = (path: string, url: string) => [path, { content: `---\nurl: ${url}\n---\n\n# x\n` }]

describe('parseSavedPages', () => {
  it('reads the documented shape and a bare array', () => {
    const row = { url: 'https://a.test/', path: 'raw/a.md', title: 'A', at: 5 }
    expect(parseSavedPages(JSON.stringify({ pages: [row] }))).toEqual([row])
    expect(parseSavedPages(JSON.stringify([row]))).toEqual([row])
  })

  it('drops a row without both a url and a path', () => {
    expect(parseSavedPages(JSON.stringify({ pages: [{ url: 'https://a.test/' }] }))).toEqual([])
  })

  it('treats a reply that is not JSON as a failure, not an empty index', () => {
    expect(() => parseSavedPages('nope')).toThrow(/not JSON/)
  })
})

describe('urlKey', () => {
  it('ignores the fragment, the way the extension keys its index', () => {
    expect(urlKey('https://a.test/p#top')).toBe(urlKey('https://a.test/p'))
  })
})

describe('urlIndexOf', () => {
  it('maps each note to the page it was clipped from', () => {
    const m = urlIndexOf([note('raw/a.md', 'https://a.test/')] as never)
    expect(m.get('https://a.test/')).toBe('raw/a.md')
  })

  it('ignores notes that declare no source', () => {
    expect(urlIndexOf([['x.md', { content: '# just a note' }]] as never).size).toBe(0)
  })

  it('keeps the first of two notes of one page rather than tossing a coin', () => {
    const m = urlIndexOf([
      note('raw/a.md', 'https://a.test/'),
      note('raw/a-2.md', 'https://a.test/'),
    ] as never)
    expect(m.get('https://a.test/')).toBe('raw/a.md')
  })
})

describe('reconcileSavedPages', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useKbStore().name = 'kb'
    files = new Set()
  })

  it('does nothing at all without a folder open — "no KB" is not "no notes"', async () => {
    useKbStore().name = ''
    const s = server([{ url: 'https://a.test/', path: 'raw/gone.md' }])
    await reconcileSavedPages(s.deps)
    expect(s.calls).toEqual([])
  })

  it('says nothing when every note is where the browser thinks it is', async () => {
    files.add('raw/a.md')
    const s = server([{ url: 'https://a.test/', path: 'raw/a.md' }])
    const out = await reconcileSavedPages(s.deps)
    expect(s.sync()).toBeUndefined()
    expect(out).toEqual({ checked: 1, forgotten: [], moved: [] })
  })

  it('forgets a page whose note was deleted', async () => {
    files.add('raw/b.md')
    const s = server([
      { url: 'https://a.test/', path: 'raw/gone.md' },
      { url: 'https://b.test/', path: 'raw/b.md' },
    ])
    const out = await reconcileSavedPages(s.deps)
    expect(out.forgotten).toEqual(['https://a.test/'])
    expect(JSON.parse(String(s.sync()?.args.forget))).toEqual(['https://a.test/'])
    expect(s.sync()?.args.moved).toBeUndefined()
  })

  it('re-points a note that was MOVED instead of forgetting it', async () => {
    // The agent reorganizes the KB with consent; a moved note is still saved.
    files.add('wiki/sources/a.md')
    useKbIndexStore().pages = new Map([note('wiki/sources/a.md', 'https://a.test/')] as never)
    const s = server([{ url: 'https://a.test/', path: 'raw/articles/a.md' }])
    const out = await reconcileSavedPages(s.deps)
    expect(out.moved).toEqual([{ url: 'https://a.test/', path: 'wiki/sources/a.md' }])
    expect(out.forgotten).toEqual([])
    expect(JSON.parse(String(s.sync()?.args.moved))).toEqual([
      { url: 'https://a.test/', path: 'wiki/sources/a.md' },
    ])
  })

  it('matches a move across a fragment difference', async () => {
    files.add('wiki/a.md')
    useKbIndexStore().pages = new Map([note('wiki/a.md', 'https://a.test/p#intro')] as never)
    const s = server([{ url: 'https://a.test/p', path: 'raw/a.md' }])
    expect((await reconcileSavedPages(s.deps)).moved).toHaveLength(1)
  })

  it('does not swap one dead path for another when the note index lags', async () => {
    // The index still lists the note at the path that was just deleted.
    useKbIndexStore().pages = new Map([note('raw/a.md', 'https://a.test/')] as never)
    const s = server([{ url: 'https://a.test/', path: 'raw/a.md' }])
    const out = await reconcileSavedPages(s.deps)
    expect(out.moved).toEqual([])
    expect(out.forgotten).toEqual(['https://a.test/'])
  })

  it('asks nothing of an empty index', async () => {
    const s = server([])
    await reconcileSavedPages(s.deps)
    expect(s.calls.map((c) => c.tool)).toEqual([LIST_SAVED_TOOL])
  })
})
