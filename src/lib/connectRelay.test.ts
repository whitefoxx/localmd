import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  McpRelayClient,
  relayExtensionId,
  relayAbsentMessage,
  isLocalmdConnectRelayUrl,
  LOCALMD_CONNECT_RELAY_URL,
  LOCALMD_CONNECT_EXTENSION,
  extensionWire,
} from '@/lib/connectRelay'
import { McpHttpClient } from '@/lib/mcp'

const EXT = 'enodecpmlecfpmofogpmbagdcfheamgf'

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
    /** Which dataset key the relay writes its id to. */
    marker?: string
  } = {},
) {
  const ext = opts.ext === undefined ? EXT : opts.ext
  const marker = opts.marker ?? LOCALMD_CONNECT_EXTENSION.marker
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
      // The relay drops a frame addressed to another install of the envelope's
      // extension family (a dev build, a sibling extension).
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

  const dataset: Record<string, string> = ext === null ? {} : { [marker]: ext }
  const doc = { documentElement: { dataset } }
  ;(globalThis as unknown as { window: unknown }).window = win
  ;(globalThis as unknown as { document: unknown }).document = doc

  return {
    sent,
    /** Frames the page sent, by JSON-RPC method. */
    methods: () => sent.map((f) => f.msg?.method),
    /** What the extension sees as the addressee of every frame. */
    targets: () => [...new Set(sent.map((f) => f.ext))],
    /** The user adding this origin in the popup and reloading. */
    setMarker: (id: string | null, key = marker) => {
      if (id === null) delete dataset[key]
      else dataset[key] = id
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
  it('is the whole of "is the extension reachable" — and reads synchronously', () => {
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

  /** Detection is per marker: another extension's marker on the same page says
   *  nothing about this one. */
  it('reads only its own marker', () => {
    const relay = fakeRelay({ ext: null })
    relay.setMarker('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'someOtherRelay')
    expect(relayExtensionId()).toBe(null)
    relay.setMarker(EXT)
    expect(relayExtensionId()).toBe(EXT)
  })
})

describe('relay url', () => {
  it('recognises the row that means "localmd Connect, over the relay"', () => {
    expect(isLocalmdConnectRelayUrl(LOCALMD_CONNECT_RELAY_URL)).toBe(true)
    expect(isLocalmdConnectRelayUrl(` ${LOCALMD_CONNECT_RELAY_URL} `)).toBe(true)
    expect(isLocalmdConnectRelayUrl(EXT)).toBe(false)
    expect(isLocalmdConnectRelayUrl('https://mcp.deepwiki.com/mcp')).toBe(false)
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
    // The envelope tag is shared by every extension built from the same relay
    // codebase, so an untargeted frame would be executed by each of them —
    // more than once, which matters the moment a write tool is involved.
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
    await expect(new McpRelayClient().connect()).rejects.toThrow(
      relayAbsentMessage(LOCALMD_CONNECT_EXTENSION),
    )
  })

  it('picks up the marker appearing later (no client rebuild needed)', async () => {
    const relay = fakeRelay({ ext: null })
    const client = new McpRelayClient()
    await expect(client.connect()).rejects.toThrow(
      relayAbsentMessage(LOCALMD_CONNECT_EXTENSION),
    )
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

  it('ignores a reply from another install', async () => {
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

describe('extensionWire', () => {
  /** The shape fetch_url actually answers with, trimmed to what we read. */
  const result = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      url: 'https://e/mcp',
      status: 200,
      ok: true,
      statusText: 'OK',
      headers: { 'Mcp-Session-Id': 'sess-9', 'Content-Type': 'text/event-stream' },
      content_type: 'text/event-stream',
      bytes: 3,
      body: 'abc',
      ...over,
    })

  it('passes the request through and asks fetch_url not to wait out an open stream', async () => {
    let seen: Record<string, unknown> = {}
    const wire = extensionWire(async (args) => {
      seen = args
      return result()
    })
    await wire({
      url: 'https://e/mcp',
      method: 'POST',
      headers: { Accept: 'application/json', 'Mcp-Session-Id': 'sess-9' },
      body: '{"jsonrpc":"2.0"}',
    })
    expect(seen.url).toBe('https://e/mcp')
    expect(seen.method).toBe('POST')
    expect(seen.body).toBe('{"jsonrpc":"2.0"}')
    // headers cross as a JSON string, which is what the tool takes.
    expect(JSON.parse(String(seen.headers))['Mcp-Session-Id']).toBe('sess-9')
    // Without this an endpoint that holds its SSE stream open can only time out.
    // 'idle' specifically — the test below is what the faster option costs.
    expect(seen.stream_stop).toBe('idle')
  })

  /**
   * Why 'idle' is worth waiting for.
   *
   * A server may put progress notifications on the response stream ahead of the
   * answer. `first_event` returns the first `data:` frame and stops; a
   * notification carries no `result`, so the call would come back empty with
   * nothing to say it had been cut short.
   *
   * The fake honours `stream_stop` on purpose — one that ignored it would pass
   * under either setting and guard nothing.
   */
  it('reads past a progress notification to the response it is waiting for', async () => {
    const frames = [
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"n":1}}\n',
      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}\n',
      'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"search"}]}}\n',
    ]
    const wire = extensionWire(async (args) =>
      JSON.stringify({
        status: 200,
        ok: true,
        headers: {},
        content_type: 'text/event-stream',
        stream_open: args.stream_stop === 'first_event',
        body: args.stream_stop === 'first_event' ? frames[0] : frames.join('\n'),
      }),
    )
    const client = new McpHttpClient({ id: 'x', name: 'x', url: 'https://e/mcp' }, wire)
    await expect(client.connect()).resolves.toEqual([
      { name: 'search', description: '', inputSchema: { type: 'object', properties: {} } },
    ])
  })

  it('lowercases response headers so protocol state is findable', async () => {
    const wire = extensionWire(async () => result())
    const reply = await wire({ url: 'https://e/mcp', method: 'POST', headers: {} })
    // The extension echoes whatever casing the server used; MCP looks these up
    // by a fixed lowercase name.
    expect(reply.headers['mcp-session-id']).toBe('sess-9')
    expect(reply.contentType).toBe('text/event-stream')
    expect(reply.body).toBe('abc')
    expect(reply.ok).toBe(true)
  })

  it('reports a non-ok exchange rather than throwing, so 401 can be read', async () => {
    const wire = extensionWire(async () =>
      result({ status: 401, ok: false, headers: { 'WWW-Authenticate': 'Bearer realm="OAuth"' } }),
    )
    const reply = await wire({ url: 'https://e/mcp', method: 'POST', headers: {} })
    expect(reply.status).toBe(401)
    expect(reply.ok).toBe(false)
    // OAuth discovery starts at this header, and it is only readable here.
    expect(reply.headers['www-authenticate']).toContain('OAuth')
  })

  it('treats a plain-text answer as the bridge reporting a failure', async () => {
    const wire = extensionWire(async () => 'fetch_url failed: signal timed out')
    await expect(wire({ url: 'https://e/mcp', method: 'POST', headers: {} })).rejects.toThrow(
      /signal timed out/,
    )
  })
})
