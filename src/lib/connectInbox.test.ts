import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/idb', () => ({
  listSessions: async () => [],
  saveSession: async () => {},
  deleteSession: async () => {},
  listRecents: async () => [],
  saveRecent: async () => {},
  removeRecent: async () => {},
}))

const writeClip = vi.fn(async () => 'raw/articles/a.md')
vi.mock('@/lib/clip', async (orig) => ({
  ...(await orig<typeof import('@/lib/clip')>()),
  writeClip: (...a: unknown[]) => writeClip(...(a as [])),
}))

const openInEditor = vi.fn(async (_path: string) => {})
vi.mock('@/lib/openInEditor', () => ({ openInEditor: (p: string) => openInEditor(p) }))

import {
  parseInbox,
  drainInbox,
  __resetInboxAttempts,
  LIST_INBOX_TOOL,
  ACK_INBOX_TOOL,
} from '@/lib/connectInbox'
import { useKbStore } from '@/stores/kb'
import { useComposerStore } from '@/stores/composer'

const clip = {
  id: 'ib_1',
  kind: 'clip',
  createdAt: 1,
  url: 'https://ex.test/a',
  title: 'A',
  payload: { url: 'https://ex.test/a', title: 'A', markdown: '# A', mode: 'article', images: [] },
}
const ask = {
  id: 'ib_2',
  kind: 'ask',
  createdAt: 2,
  url: 'https://ex.test/b',
  title: 'B',
  tabId: 7,
  payload: { selection: 'a passage' },
}

/** A fake Connect server: records the calls and answers list_inbox with `items`. */
function server(items: unknown[]) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
  return {
    calls,
    deps: {
      serverId: 'connect',
      call: async (tool: string, args: Record<string, unknown>) => {
        calls.push({ tool, args })
        if (tool === LIST_INBOX_TOOL) return JSON.stringify({ pending: items.length, items })
        return JSON.stringify({ removed: 1, remaining: 0 })
      },
    },
  }
}

describe('parseInbox', () => {
  it('reads the documented shape, a bare array, and rejects the rest', () => {
    expect(parseInbox(JSON.stringify({ items: [clip] }))).toHaveLength(1)
    expect(parseInbox(JSON.stringify([clip]))).toHaveLength(1)
    expect(parseInbox('not json')).toEqual([])
    expect(parseInbox(JSON.stringify({ items: [{ nope: 1 }] }))).toEqual([])
  })

  it('keeps a tabId only when the item has one', () => {
    const [a, b] = parseInbox(JSON.stringify({ items: [clip, ask] }))
    expect('tabId' in a).toBe(false)
    expect(b.tabId).toBe(7)
  })
})

describe('drainInbox', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    __resetInboxAttempts()
    writeClip.mockClear()
    openInEditor.mockClear()
    writeClip.mockResolvedValue('raw/articles/a.md')
  })

  it('does nothing at all without a knowledge base open', async () => {
    const s = server([clip])
    const out = await drainInbox(s.deps)
    expect(s.calls).toEqual([])
    expect(out.acked).toBe(0)
    expect(writeClip).not.toHaveBeenCalled()
  })

  it('writes a clip, acks it, and opens where it landed', async () => {
    useKbStore().name = 'kb'
    const s = server([clip])
    const out = await drainInbox(s.deps)
    expect(writeClip).toHaveBeenCalledTimes(1)
    expect(out.written).toEqual(['raw/articles/a.md'])
    expect(openInEditor).toHaveBeenCalledWith('raw/articles/a.md')
    expect(s.calls.map((c) => c.tool)).toEqual([LIST_INBOX_TOOL, ACK_INBOX_TOOL])
    expect(JSON.parse(String(s.calls[1].args.ids))).toEqual(['ib_1'])
  })

  it('opens nothing when a batch wrote several — that would be a fight over the editor', async () => {
    useKbStore().name = 'kb'
    const out = await drainInbox(server([clip, { ...clip, id: 'ib_1b' }]).deps)
    expect(out.written).toHaveLength(2)
    expect(openInEditor).not.toHaveBeenCalled()
  })

  it('hands an ask to the composer as an attached tab plus the quoted passage', async () => {
    useKbStore().name = 'kb'
    const out = await drainInbox(server([ask]).deps)
    const composer = useComposerStore()
    expect(composer.tabs).toEqual([
      { serverId: 'connect', tabId: 7, title: 'B', url: 'https://ex.test/b' },
    ])
    expect(composer.refs.map((r) => r.text)).toEqual(['a passage'])
    expect(composer.refs[0].pinned).toBe(true)
    expect(out.asks).toBe(1)
  })

  it('acks an unparseable clip instead of retrying it forever', async () => {
    useKbStore().name = 'kb'
    const s = server([{ ...clip, payload: { nonsense: true } }])
    const out = await drainInbox(s.deps)
    expect(writeClip).not.toHaveBeenCalled()
    expect(out.acked).toBe(1)
  })

  it('leaves a kind it does not understand for a later version', async () => {
    useKbStore().name = 'kb'
    const s = server([{ ...clip, kind: 'highlight' }])
    const out = await drainInbox(s.deps)
    expect(out.left).toBe(1)
    expect(s.calls.map((c) => c.tool)).toEqual([LIST_INBOX_TOOL])
  })

  it('retries a failed write, then gives up rather than blocking every later drain', async () => {
    useKbStore().name = 'kb'
    writeClip.mockRejectedValue(new Error('disk full'))
    for (const expected of [1, 2]) {
      const out = await drainInbox(server([clip]).deps)
      expect(out.left, `attempt ${expected}`).toBe(1)
      expect(out.acked).toBe(0)
    }
    const out = await drainInbox(server([clip]).deps)
    expect(out.acked).toBe(1)
  })
})
