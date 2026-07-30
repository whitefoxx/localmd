import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  McpRelayClient,
  relayExtensionId,
  isWebcliRelayUrl,
  WEBCLI_RELAY_URL,
  RELAY_ABSENT_MESSAGE,
} from '@/lib/webcliRelay'

const EXT = 'jnhfdhpafndcbppkphhfpecflhogngge'

interface Frame {
  webcli?: unknown
  dir?: unknown
  ext?: unknown
  msg?: { jsonrpc?: string; id?: number; method?: string; params?: unknown }
}

/**
 * A stand-in for the page + the relay content script.
 *
 * Two details are modelled on purpose because the client depends on them:
 * a real `window.postMessage` dispatches the frame to the window's OWN
 * listeners as well (so the client sees its own `to-ext` frames and must ignore
 * them), and `e.source` is the window itself.
 */
function fakeRelay(
  opts: {
    ext?: string | null
    replyExt?: string
    answer?: (method: string) => unknown
    /** What an origin the user never added looks like: frames accepted, nothing
     *  ever comes back (the extension drops the port without a word). */
    silent?: boolean
  } = {},
) {
  const ext = opts.ext === undefined ? EXT : opts.ext
  const listeners = new Set<(e: { source: unknown; data: unknown }) => void>()
  const sent: Frame[] = []

  const win = {
    location: { origin: 'https://localmd.app' },
    addEventListener(type: string, cb: (e: { source: unknown; data: unknown }) => void) {
      if (type === 'message') listeners.add(cb)
    },
    removeEventListener(type: string, cb: (e: { source: unknown; data: unknown }) => void) {
      if (type === 'message') listeners.delete(cb)
    },
    postMessage(data: unknown) {
      dispatch(data)
      const f = data as Frame
      if (f.dir !== 'to-ext') return
      sent.push(f)
      // The relay drops a frame addressed to the other install (store + dev).
      if (typeof f.ext === 'string' && ext !== null && f.ext !== ext) return
      if (opts.silent) return
      const id = f.msg?.id
      if (id === undefined) return // a notification: nothing comes back
      const result = opts.answer
        ? opts.answer(f.msg!.method!)
        : f.msg!.method === 'tools/list'
          ? { tools: [{ name: 'generic__fetch_url', description: 'fetch', inputSchema: {} }] }
          : {}
      queueMicrotask(() =>
        dispatch({
          webcli: 'mcp',
          dir: 'to-page',
          ext: opts.replyExt ?? ext,
          msg: { jsonrpc: '2.0', id, result },
        }),
      )
    },
  }

  function dispatch(data: unknown): void {
    for (const cb of [...listeners]) cb({ source: win, data })
  }

  const doc = { documentElement: { dataset: ext === null ? {} : { webcliRelay: ext } } }
  ;(globalThis as unknown as { window: unknown }).window = win
  ;(globalThis as unknown as { document: unknown }).document = doc

  return {
    sent,
    /** Frames the page sent, by JSON-RPC method. */
    methods: () => sent.map((f) => f.msg?.method),
    /** What the extension sees as the addressee of every frame. */
    targets: () => [...new Set(sent.map((f) => f.ext))],
    /** The user adding this origin in the popup and reloading. */
    setMarker: (id: string | null) => {
      if (id === null) delete (doc.documentElement.dataset as { webcliRelay?: string }).webcliRelay
      else doc.documentElement.dataset.webcliRelay = id
    },
    listenerCount: () => listeners.size,
  }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  delete (globalThis as { document?: unknown }).document
  vi.useRealTimers()
})

describe('relay marker', () => {
  it('is the whole of "is WebCLI reachable" — and reads synchronously', () => {
    const relay = fakeRelay()
    expect(relayExtensionId()).toBe(EXT)
    relay.setMarker(null)
    expect(relayExtensionId()).toBe(null)
  })

  it('treats a blank marker as absent', () => {
    const relay = fakeRelay()
    relay.setMarker('   ')
    expect(relayExtensionId()).toBe(null)
  })

  it('reports absent outside a browser (no document at all)', () => {
    expect(relayExtensionId()).toBe(null)
  })
})

describe('relay url', () => {
  it('recognises the row that means "WebCLI, over the relay"', () => {
    expect(isWebcliRelayUrl(WEBCLI_RELAY_URL)).toBe(true)
    expect(isWebcliRelayUrl(` ${WEBCLI_RELAY_URL} `)).toBe(true)
    expect(isWebcliRelayUrl(EXT)).toBe(false)
    expect(isWebcliRelayUrl('https://mcp.deepwiki.com/mcp')).toBe(false)
  })
})

describe('McpRelayClient', () => {
  it('handshakes and lists tools over postMessage', async () => {
    const relay = fakeRelay()
    const tools = await new McpRelayClient().connect()
    expect(relay.methods()).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
    expect(tools).toEqual([
      { name: 'generic__fetch_url', description: 'fetch', inputSchema: {} },
    ])
  })

  it('addresses every frame to the install named by the marker', async () => {
    const relay = fakeRelay()
    const client = new McpRelayClient()
    await client.connect()
    await client.callTool('generic__open_url', { url: 'https://example.com' })
    // Untargeted frames are executed by BOTH a store and a dev install — twice,
    // which matters the moment a write tool is involved.
    expect(relay.targets()).toEqual([EXT])
  })

  it('never re-handshakes: the extension answers a call on a fresh port', async () => {
    const relay = fakeRelay()
    const client = new McpRelayClient()
    await client.connect()
    relay.sent.length = 0
    await client.callTool('a', {})
    await client.callTool('b', {})
    expect(relay.methods()).toEqual(['tools/call', 'tools/call'])
  })

  it('refuses to speak when the relay is not on the page', async () => {
    fakeRelay({ ext: null })
    await expect(new McpRelayClient().connect()).rejects.toThrow(RELAY_ABSENT_MESSAGE)
  })

  it('picks up the marker appearing later (no client rebuild needed)', async () => {
    const relay = fakeRelay({ ext: null })
    const client = new McpRelayClient()
    await expect(client.connect()).rejects.toThrow(RELAY_ABSENT_MESSAGE)
    relay.setMarker(EXT)
    await expect(client.connect()).resolves.toHaveLength(1)
  })

  it('turns a silent extension into the setup answer, not a network answer', async () => {
    // What a page on an origin the user has NOT added actually sees: the relay is
    // injected (host-level), the extension drops the port without a word.
    fakeRelay({ silent: true })
    vi.useFakeTimers()
    const client = new McpRelayClient()
    const connecting = client.connect()
    const assertion = expect(connecting).rejects.toThrow(/Web app access/)
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
  })

  it('ignores a reply from the other install', async () => {
    fakeRelay({ replyExt: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' })
    vi.useFakeTimers()
    const connecting = new McpRelayClient().connect()
    const assertion = expect(connecting).rejects.toThrow(/Web app access/)
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
  })

  it('keeps image blocks readable (a screenshot comes back as MCP content)', async () => {
    fakeRelay({
      answer: (method) =>
        method === 'tools/call'
          ? { content: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0' }] }
          : {},
    })
    const client = new McpRelayClient()
    expect(await client.callTool('generic__screenshot', {})).toBe('[image image/png]')
  })

  it('surfaces a JSON-RPC error as the tool failing', async () => {
    fakeRelay()
    const client = new McpRelayClient()
    await client.connect()
    // An error envelope for the call, hand-delivered the way the extension does.
    const win = (globalThis as unknown as { window: { postMessage(d: unknown): void } }).window
    const failing = client.callTool('nope', {})
    win.postMessage({
      webcli: 'mcp',
      dir: 'to-page',
      ext: EXT,
      msg: { jsonrpc: '2.0', id: 3, error: { code: -32602, message: 'unknown tool: nope' } },
    })
    await expect(failing).rejects.toThrow(/unknown tool: nope \(-32602\)/)
  })

  it('drops its listener and its callers on dispose', async () => {
    const relay = fakeRelay({ silent: true })
    const client = new McpRelayClient()
    const pending = client.connect()
    expect(relay.listenerCount()).toBe(1)
    client.dispose()
    expect(relay.listenerCount()).toBe(0)
    // A caller must not sit out the full timeout waiting for a transport that no
    // longer exists — but the wording must not read as "safe to resend" either.
    await expect(pending).rejects.toThrow(/replaced/)
  })

  it('honours an abort signal', async () => {
    fakeRelay({ silent: true })
    const ctrl = new AbortController()
    const running = new McpRelayClient().callTool('slow', {}, ctrl.signal)
    ctrl.abort()
    await expect(running).rejects.toThrow('aborted')
  })
})
