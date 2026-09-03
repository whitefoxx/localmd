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
vi.mock('@/lib/openInEditor', () => ({ openInEditor: (p: string) => openInEditor(p) }))

import {
  parseInbox,
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
    expect(draft.endsWith('\n\n')).toBe(true)
  })

  it('quotes a multi-line passage as a whole block', () => {
    const draft = askDraft([{ ...ask, payload: { selection: 'line one\nline two' } } as never])
    expect(draft).toContain('> line one\n> line two')
  })

  it('carries a page with no selection and no title', () => {
    const draft = askDraft([{ ...ask, title: '', payload: {} } as never])
    expect(draft).toBe('About this page: https://ex.test/b\n\n')
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
