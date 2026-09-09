import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// The ui store reads a persisted panel width at construction, and this suite
// runs in node. Nothing here is about layout; a bare stub keeps the store
// constructible without pulling in a DOM.
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
})

vi.mock('@/lib/idb', () => ({
  listSessions: async () => [],
  saveSession: async () => {},
  deleteSession: async () => {},
  listRecents: async () => [],
  saveRecent: async () => {},
  removeRecent: async () => {},
}))

const writeClip = vi.fn(async () => 'raw/articles/a.md')
const importFile = vi.fn(async (f: File) => `raw/images/${f.name}`)
vi.mock('@/lib/capture', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture')>()),
  importFile: (f: File) => importFile(f),
}))
vi.mock('@/lib/clip', async (orig) => ({
  ...(await orig<typeof import('@/lib/clip')>()),
  writeClip: (...a: unknown[]) => writeClip(...(a as [])),
}))

const openInEditor = vi.fn(async (_path: string) => {})
const syncAfterFsChange = vi.fn(async () => {})
vi.mock('@/lib/fileOps', () => ({ syncAfterFsChange: () => syncAfterFsChange() }))
vi.mock('@/lib/openInEditor', () => ({ openInEditor: (p: string) => openInEditor(p) }))

import {
  parseInbox,
  parseInboxReply,
  drainInbox,
  askDraft,
  __resetInboxAttempts,
  LIST_INBOX_TOOL,
  ACK_INBOX_TOOL,
} from '@/lib/connectInbox'
import { useKbStore } from '@/stores/kb'
import { useComposerStore } from '@/stores/composer'
import { useUiStore } from '@/stores/ui'

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

/** A fake Connect server whose queue is handed out in BATCHES — what the real
 *  one does when the items are big — and shrinks as items are acked. */
function pagedServer(batches: unknown[][]) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
  let queue = batches.map((b) => [...b])
  return {
    calls,
    deps: {
      serverId: 'connect',
      call: async (tool: string, args: Record<string, unknown>) => {
        calls.push({ tool, args })
        if (tool === LIST_INBOX_TOOL) {
          const pending = queue.reduce((n, b) => n + b.length, 0)
          return JSON.stringify({ pending, items: queue[0] ?? [] })
        }
        if (tool === ACK_INBOX_TOOL) {
          const ids = new Set(JSON.parse(String(args.ids)) as string[])
          queue = queue
            .map((b) => b.filter((i) => !ids.has((i as { id: string }).id)))
            .filter((b) => b.length)
          return JSON.stringify({ removed: ids.size, remaining: queue.length })
        }
        return '{}'
      },
    },
  }
}

describe('parseInboxReply', () => {
  it('carries the pending count, and falls back to the batch size without one', () => {
    expect(parseInboxReply(JSON.stringify({ pending: 8, items: [clip] })).pending).toBe(8)
    expect(parseInboxReply(JSON.stringify([clip])).pending).toBe(1)
  })
})

describe('parseInbox', () => {
  it('reads the documented shape, a bare array, and rejects rows that are not items', () => {
    expect(parseInbox(JSON.stringify({ items: [clip] }))).toHaveLength(1)
    expect(parseInbox(JSON.stringify([clip]))).toHaveLength(1)
    expect(parseInbox(JSON.stringify({ items: [{ nope: 1 }] }))).toEqual([])
  })

  it('treats a reply that is not JSON as a FAILURE, never as an empty inbox', () => {
    // What the extension sends when a reply exceeds its frame ceiling: the
    // document cut short with a note appended. Reading that as [] is how eight
    // captures once sat in the queue behind a green row.
    const truncated =
      JSON.stringify({ pending: 3, items: [clip] }).slice(0, 40) +
      '……[result too long, truncated to the 16MB message limit]'
    expect(() => parseInbox(truncated)).toThrow(/not JSON/)
    expect(() => parseInbox('not json')).toThrow(/not JSON/)
  })

  it('carries the oversized flag and size through', () => {
    const [o] = parseInbox(
      JSON.stringify({ items: [{ ...clip, payload: undefined, oversized: true, bytes: 17_000_000 }] }),
    )
    expect(o.oversized).toBe(true)
    expect(o.bytes).toBe(17_000_000)
    const [c] = parseInbox(JSON.stringify({ items: [clip] }))
    expect('oversized' in c).toBe(false)
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
    // The ack names the file, so the browser can say "this page is in your KB".
    expect(JSON.parse(String(s.calls[1].args.written))).toEqual([
      { id: 'ib_1', path: 'raw/articles/a.md' },
    ])
  })

  it('an ack for asks alone carries no `written`', async () => {
    useKbStore().name = 'kb'
    const s = server([ask])
    await drainInbox(s.deps)
    expect('written' in s.calls[1].args).toBe(false)
  })

  it('tells the file tree that something was written, or it stays invisible', async () => {
    useKbStore().name = 'kb'
    syncAfterFsChange.mockClear()
    await drainInbox(server([clip]).deps)
    expect(syncAfterFsChange).toHaveBeenCalledTimes(1)
  })

  it('does not disturb the tree when nothing was written', async () => {
    useKbStore().name = 'kb'
    syncAfterFsChange.mockClear()
    await drainInbox(server([ask]).deps)
    expect(syncAfterFsChange).not.toHaveBeenCalled()
  })

  it('opens nothing when a batch wrote several — that would be a fight over the editor', async () => {
    useKbStore().name = 'kb'
    const out = await drainInbox(server([clip, { ...clip, id: 'ib_1b' }]).deps)
    expect(out.written).toHaveLength(2)
    expect(openInEditor).not.toHaveBeenCalled()
  })

  it('hands an ask to the composer as a DRAFT, and attaches the tab too', async () => {
    useKbStore().name = 'kb'
    const out = await drainInbox(server([ask]).deps)
    const composer = useComposerStore()
    expect(composer.tabs).toEqual([
      { serverId: 'connect', tabId: 7, title: 'B', url: 'https://ex.test/b' },
    ])
    // The draft is what the user actually sees. A tab chip alone delivered
    // nothing visible: chips are staged per session, so one lands in whichever
    // chat happened to be open when the drain ran — and someone arriving from
    // the browser usually starts a new one.
    const draft = useUiStore().pendingPrompt
    expect(draft).toContain('https://ex.test/b')
    expect(draft).toContain('> a passage')
    expect(out.asks).toBe(1)
  })

  it('leaves the question to the user rather than writing one for them', () => {
    const draft = askDraft([ask as never])
    expect(draft).toMatch(/^About this page: B — https:\/\/ex\.test\/b/)
    expect(draft).not.toMatch(/\?/)
    // …and ends with a rule, so the cursor lands below what the browser
    // brought rather than somewhere inside it.
    expect(draft.endsWith('\n\n---\n\n')).toBe(true)
  })

  it('quotes a multi-line passage as a whole block', () => {
    const draft = askDraft([{ ...ask, payload: { selection: 'line one\nline two' } } as never])
    expect(draft).toContain('> line one\n> line two')
  })

  it('carries a page with no selection and no title', () => {
    const draft = askDraft([{ ...ask, title: '', payload: {} } as never])
    expect(draft).toBe('About this page: https://ex.test/b\n\n---\n\n')
  })

  it('combines a batch instead of overwriting one draft with the next', async () => {
    useKbStore().name = 'kb'
    await drainInbox(server([ask, { ...ask, id: 'ib_2b', url: 'https://ex.test/c' }]).deps)
    const draft = useUiStore().pendingPrompt
    expect(draft).toContain('https://ex.test/b')
    expect(draft).toContain('https://ex.test/c')
  })

  it('acks an unparseable clip instead of retrying it forever', async () => {
    useKbStore().name = 'kb'
    const s = server([{ ...clip, payload: { nonsense: true } }])
    const out = await drainInbox(s.deps)
    expect(writeClip).not.toHaveBeenCalled()
    expect(out.acked).toBe(1)
  })

  it('writes a region screenshot like a pasted picture, named after its page', async () => {
    useKbStore().name = 'kb'
    importFile.mockClear()
    const shot = {
      ...clip,
      id: 'ib_s',
      kind: 'screenshot',
      title: 'Some: page / title',
      payload: { dataUrl: 'data:image/png;base64,QUJD', width: 2, height: 1, format: 'png' },
    }
    const out = await drainInbox(server([shot]).deps)
    expect(importFile).toHaveBeenCalledTimes(1)
    const file = importFile.mock.calls[0][0]
    expect(file.type).toBe('image/png')
    expect(file.name).toMatch(/^Some page title\.png$/)
    expect(out.written).toEqual([`raw/images/${file.name}`])
    expect(out.acked).toBe(1)
  })

  it('files a PDF clip as the document it is, named after its title', async () => {
    useKbStore().name = 'kb'
    importFile.mockClear()
    const pdf = {
      ...clip,
      id: 'ib_p',
      payload: {
        kind: 'pdf',
        url: 'https://arxiv.org/pdf/2401.00001',
        title: 'Attention Is All You Need.pdf',
        mime: 'application/pdf',
        size: 4,
        data: 'JVBERi0=', // "%PDF-"
        clipped_at: '2026-09-03T00:00:00.000Z',
      },
    }
    const out = await drainInbox(server([pdf]).deps)
    expect(importFile).toHaveBeenCalledTimes(1)
    const file = importFile.mock.calls[0][0]
    expect(file.type).toBe('application/pdf')
    expect(file.name).toBe('Attention Is All You Need.pdf')
    expect(out.written).toEqual([`raw/images/${file.name}`]) // the mock's path; the real intake routes .pdf to raw/papers/
    expect(out.acked).toBe(1)
  })

  it('names a whole-page screenshot for the codec it arrived in', async () => {
    useKbStore().name = 'kb'
    importFile.mockClear()
    const shot = {
      ...clip,
      id: 'ib_w',
      kind: 'screenshot',
      title: 'Long page',
      payload: { dataUrl: 'data:image/webp;base64,QUJD', width: 2, height: 1, format: 'webp' },
    }
    await drainInbox(server([shot]).deps)
    const file = importFile.mock.calls[0][0]
    expect(file.type).toBe('image/webp')
    expect(file.name).toBe('Long page.webp')
  })

  it('gives up on an item the extension could not deliver, so the queue moves', async () => {
    useKbStore().name = 'kb'
    importFile.mockClear()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const huge = {
      id: 'ib_huge',
      kind: 'screenshot',
      createdAt: 1,
      url: 'https://ex.test/long',
      title: 'Long',
      oversized: true,
      bytes: 17_000_000,
    }
    const s = server([huge, ask])
    const out = await drainInbox(s.deps)
    expect(importFile).not.toHaveBeenCalled()
    // Acked together with the ask behind it — nothing written, nothing retried.
    const ack = s.calls.find((c) => c.tool === ACK_INBOX_TOOL)
    expect(JSON.parse(String(ack?.args.ids))).toEqual(['ib_huge', 'ib_2'])
    expect(out.acked).toBe(2)
    expect(out.written).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/too large to transfer/))
    warn.mockRestore()
  })

  it('keeps pulling until the extension reports nothing pending', async () => {
    // Three batches — the shape of a queue of big screenshots. One poke used to
    // pull exactly one of them; the other two waited for a coincidence.
    useKbStore().name = 'kb'
    const s = pagedServer([[clip], [{ ...clip, id: 'ib_1b' }], [ask]])
    const out = await drainInbox(s.deps)
    expect(s.calls.filter((c) => c.tool === LIST_INBOX_TOOL)).toHaveLength(3)
    expect(out.acked).toBe(3)
    expect(out.written).toHaveLength(2)
    expect(out.asks).toBe(1)
  })

  it('writes ONE draft for the asks of the whole drain, not one per round', async () => {
    useKbStore().name = 'kb'
    const s = pagedServer([[ask], [{ ...ask, id: 'ib_2c', url: 'https://ex.test/c' }]])
    await drainInbox(s.deps)
    const draft = useUiStore().pendingPrompt
    expect(draft).toContain('https://ex.test/b')
    expect(draft).toContain('https://ex.test/c')
  })

  it('opens nothing when the rounds together wrote several', async () => {
    useKbStore().name = 'kb'
    openInEditor.mockClear()
    await drainInbox(pagedServer([[clip], [{ ...clip, id: 'ib_1b' }]]).deps)
    expect(openInEditor).not.toHaveBeenCalled()
  })

  it('stops when a round makes no progress, even with items still pending', async () => {
    // An unhandled kind is left for a later version; listing it again in a
    // loop would spin until MAX_ROUNDS. No progress → stop.
    useKbStore().name = 'kb'
    const s = pagedServer([[{ ...clip, id: 'ib_h', kind: 'highlight' }]])
    const out = await drainInbox(s.deps)
    expect(s.calls.filter((c) => c.tool === LIST_INBOX_TOOL)).toHaveLength(1)
    expect(out.left).toBe(1)
  })

  it('looks once more when a poke arrived while it was running', async () => {
    useKbStore().name = 'kb'
    // The server's queue is empty at first; a capture arrives mid-drain.
    let calls = 0
    const late = { ...clip, id: 'ib_late' }
    let queue: unknown[] = [clip]
    const deps = {
      serverId: 'connect',
      call: async (tool: string, args: Record<string, unknown>) => {
        if (tool === LIST_INBOX_TOOL) {
          calls++
          if (calls === 1) {
            // Simulate the poke: a second drainInbox call while this one runs.
            queue = [...queue, late]
            void drainInbox(deps) // returns empty at once — the guard — but marks the poke
          }
          return JSON.stringify({ pending: queue.length, items: queue.slice(0, 1) })
        }
        if (tool === ACK_INBOX_TOOL) {
          const ids = new Set(JSON.parse(String(args.ids)) as string[])
          queue = queue.filter((i) => !ids.has((i as { id: string }).id))
        }
        return '{}'
      },
    }
    const out = await drainInbox(deps)
    expect(out.acked).toBe(2)
    expect(queue).toEqual([])
  })

  it('acks a screenshot whose payload is not an image, rather than retrying it', async () => {
    useKbStore().name = 'kb'
    importFile.mockClear()
    const out = await drainInbox(server([{ ...clip, kind: 'screenshot', payload: { nope: 1 } }]).deps)
    expect(importFile).not.toHaveBeenCalled()
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

describe('askDraft with an answer already in hand', () => {
  const item = (payload: unknown) =>
    ({
      id: 'i1',
      kind: 'ask' as const,
      createdAt: 0,
      url: 'https://a.test/p',
      title: 'A page',
      payload,
    })

  it('carries the passage, the prompt that was run and what it said', () => {
    const draft = askDraft([
      item({ selection: 'the passage', prompt: 'Explain', answer: 'because of X' }),
    ])
    expect(draft).toContain('About this page: A page — https://a.test/p')
    expect(draft).toContain('> the passage')
    expect(draft).toContain('**Explain** already answered:')
    expect(draft).toContain('because of X')
  })

  it('is unchanged for a plain ask, and for an extension too old to send one', () => {
    const plain = askDraft([item({ selection: 'the passage' })])
    expect(plain).not.toContain('already answered')
    expect(plain).toContain('> the passage')
    // An answer with no prompt name still reads.
    expect(askDraft([item({ answer: 'just this' })])).toContain('Already answered:')
  })
})
