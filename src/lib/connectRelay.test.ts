import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  McpRelayClient,
  relayExtensionId,
  relayAbsentMessage,
  isLocalmdConnectRelayUrl,
  LOCALMD_CONNECT_RELAY_URL,
  LOCALMD_CONNECT_EXTENSION,
  extensionWire,
  isRelayReadyFrame,
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
    /** The extension speaking first — a notification, or (with an id) a request
     *  it expects this side to answer. */
    push: (msg: unknown) => dispatch({ webcli: 'mcp', dir: 'to-page', ext, msg }),
    /** Frames this side sent that are replies rather than calls. */
    replies: () =>
      sent
        .map((f) => f.msg as unknown as { id?: unknown; result?: unknown; error?: unknown })
        .filter((m) => m && ('result' in m || 'error' in m)),
    /** The extension's service worker being recycled under the page: the relay
     *  content script forwards its port's onDisconnect. */
    drop: () => dispatch({ webcli: 'mcp', dir: 'to-page', ext, closed: true }),
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

describe('the relay port going away', () => {
  it('tells the store, so a green row does not outlive its connection', async () => {
    const relay = fakeRelay()
    const client = new McpRelayClient()
    await client.connect()
    const lost: string[] = []
    client.onLost = (r) => lost.push(r)
    relay.drop()
    expect(lost).toHaveLength(1)
    // The message has to be actionable: the row shows it verbatim.
    expect(lost[0]).toMatch(/disconnected/)
    expect(lost[0]).toMatch(/reconnects by itself/)
  })

  it('fails the calls that were in flight instead of leaving them to time out', async () => {
    const relay = fakeRelay({ silent: true })
    const client = new McpRelayClient()
    // A call nothing will ever answer, then the port dies under it.
    const pending = client.callTool('generic__fetch_url', {}).catch((e: Error) => e.message)
    relay.drop()
    await expect(pending).resolves.toMatch(/disconnected/)
  })

  it('reconnects on the next use — the marker is still there, only the port went', async () => {
    const relay = fakeRelay()
    const client = new McpRelayClient()
    await client.connect()
    relay.drop()
    const tools = await client.connect()
    expect(tools).toHaveLength(1)
  })
})

describe('images over the relay', () => {
  it('go through the client\'s sink, so the model gets a path it can look at', async () => {
    fakeRelay({
      answer: (method) =>
        method === 'tools/call'
          ? { content: [{ type: 'image', mimeType: 'image/webp', data: 'QUJD' }] }
          : {},
    })
    const client = new McpRelayClient()
    await client.connect()
    client.imageSink = async (img) => `.tmp/${img.mimeType.split('/')[1]}.bin`
    const out = await client.callTool('generic__screenshot', {})
    expect(out).toContain('saved to .tmp/webp.bin')
  })
})

/**
 * The extension asking US — the direction of MCP this integration never used
 * until localmd Connect's in-page quick actions needed it. The extension holds
 * no API key and runs no model; Translate/Explain on a web page are answered
 * by whichever model is configured here (lib/connectSampling).
 */
describe('server→client requests', () => {
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it('answers with what the handler returned, addressed to the same install', async () => {
    const relay = fakeRelay({ silent: true })
    const client = new McpRelayClient()
    client.onRequest = async (method, params) => ({ echo: method, got: params })
    // attach() is what starts listening; nothing has called it yet.
    void client.callTool('generic__fetch_url', {}).catch(() => {})
    relay.push({ jsonrpc: '2.0', id: 7, method: 'sampling/createMessage', params: { a: 1 } })
    await settle()
    expect(relay.replies()).toEqual([
      { jsonrpc: '2.0', id: 7, result: { echo: 'sampling/createMessage', got: { a: 1 } } },
    ])
    expect(relay.targets()).toEqual([EXT])
    relay.drop()
  })

  it('refuses a method it has no handler for instead of leaving the caller waiting', async () => {
    const relay = fakeRelay({ silent: true })
    const client = new McpRelayClient()
    void client.callTool('generic__fetch_url', {}).catch(() => {})
    relay.push({ jsonrpc: '2.0', id: 8, method: 'roots/list' })
    await settle()
    const [reply] = relay.replies() as Array<{ error?: { code: number; message: string } }>
    expect(reply.error?.code).toBe(-32601)
    expect(reply.error?.message).toContain('roots/list')
    relay.drop()
  })

  it('turns a failing handler into an error reply, not an unhandled rejection', async () => {
    const relay = fakeRelay({ silent: true })
    const client = new McpRelayClient()
    client.onRequest = async () => {
      throw new Error('No model is configured in localmd')
    }
    void client.callTool('generic__fetch_url', {}).catch(() => {})
    relay.push({ jsonrpc: '2.0', id: 9, method: 'sampling/createMessage' })
    await settle()
    const [reply] = relay.replies() as Array<{ error?: { code: number; message: string } }>
    expect(reply.error).toEqual({ code: -32603, message: 'No model is configured in localmd' })
    relay.drop()
  })

  /**
   * The one that matters. Both directions number their requests from 1, so an
   * INCOMING request whose id happens to match a call we are waiting on used to
   * be looked up in our pending map — resolving somebody's tool call with
   * somebody else's question. Reading the method first makes that unreachable.
   */
  it('does not settle a call of ours that happens to share the id', async () => {
    const relay = fakeRelay({ silent: true })
    const client = new McpRelayClient()
    client.onRequest = async () => ({ content: { type: 'text', text: 'the answer' } })
    let settled: 'no' | 'resolved' | 'rejected' = 'no'
    const call = client.callTool('generic__fetch_url', {}).then(
      () => (settled = 'resolved'),
      () => (settled = 'rejected'),
    )
    // Our call went out as id 1; the extension's own first request is id 1 too.
    expect(relay.sent[0].msg?.id).toBe(1)
    relay.push({ jsonrpc: '2.0', id: 1, method: 'sampling/createMessage' })
    await settle()
    expect(settled).toBe('no')
    expect(relay.replies()).toEqual([
      { jsonrpc: '2.0', id: 1, result: { content: { type: 'text', text: 'the answer' } } },
    ])
    relay.drop()
    await call
    expect(settled).toBe('rejected') // by the disconnect, not by the question
  })

  it('still treats a notification as a notification — no id, no reply', async () => {
    const relay = fakeRelay({ silent: true })
    const client = new McpRelayClient()
    const seen: string[] = []
    client.onNotification = (m) => seen.push(m)
    client.onRequest = async () => ({ never: true })
    void client.callTool('generic__fetch_url', {}).catch(() => {})
    relay.push({ jsonrpc: '2.0', method: 'notifications/localmd/inbox', params: { count: 2 } })
    await settle()
    expect(seen).toEqual(['notifications/localmd/inbox'])
    expect(relay.replies()).toEqual([])
    relay.drop()
  })

  it('tells the extension it can be asked, in the handshake', async () => {
    const relay = fakeRelay()
    await new McpRelayClient().connect()
    const init = relay.sent.find((f) => f.msg?.method === 'initialize')!
    expect((init.msg!.params as { capabilities: unknown }).capabilities).toEqual({ sampling: {} })
  })
})

/**
 * The frame that says a dead connection can be rebuilt. An extension reload
 * takes the port with it and the relay is re-injected into open tabs — this is
 * how the page hears about it without anyone clicking the tab (stores/mcp's
 * heal; the extension nudges with the same frame when it needs an answer).
 */
describe('isRelayReadyFrame', () => {
  it('accepts the relay saying it is attached', () => {
    expect(isRelayReadyFrame({ webcli: 'mcp', dir: 'to-page', ext: EXT, ready: true })).toBe(true)
  })

  it('is not fooled by the other frames on the same wire', () => {
    // A reply, a notification, our own outgoing frame, the drop notice, junk.
    expect(isRelayReadyFrame({ webcli: 'mcp', dir: 'to-page', msg: { id: 1, result: {} } })).toBe(
      false,
    )
    expect(isRelayReadyFrame({ webcli: 'mcp', dir: 'to-ext', ready: true })).toBe(false)
    expect(isRelayReadyFrame({ webcli: 'mcp', dir: 'to-page', closed: true })).toBe(false)
    expect(isRelayReadyFrame({ webcli: 'other', dir: 'to-page', ready: true })).toBe(false)
    expect(isRelayReadyFrame({ webcli: 'mcp', dir: 'to-page', ready: 'yes' })).toBe(false)
    expect(isRelayReadyFrame(null)).toBe(false)
    expect(isRelayReadyFrame('ready')).toBe(false)
  })
})
