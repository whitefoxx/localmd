/**
 * WebCLI transport — JSON-RPC/MCP over `window.postMessage`.
 *
 * WebCLI removed `externally_connectable` from its manifest, so
 * `chrome.runtime.connect(<id>)` from a page no longer reaches it at all (that
 * field is read once at install time; nothing at runtime can widen it, and it
 * cannot express "let the user add a site"). The replacement is opt-in per
 * origin: the user adds this app's origin under "Web app access" in WebCLI's
 * popup, the extension registers a tiny relay content script on that origin,
 * and we exchange the SAME JSON-RPC frames with the relay instead of a Port.
 *
 *   page → ext : { webcli:'mcp', dir:'to-ext', ext, msg:<jsonrpc> }
 *   ext → page : { webcli:'mcp', dir:'to-page', ext, msg:<jsonrpc> }
 *   on attach  : { webcli:'mcp', dir:'to-page', ext, ready:true }
 *
 * Two things this buys us over the Port:
 *   - Nothing about WebCLI is pinned. The relay writes its own extension id to
 *     `<html data-webcli-relay>` at document_start, so detection is synchronous
 *     and race-free, a dev build works with no configuration, and the app has
 *     no store id to go stale.
 *   - No `initialize` state to lose. The extension's handler answers tools/call
 *     on a fresh port, and the relay silently redials its service worker when
 *     MV3 recycles it — so the reconnect-and-re-handshake dance the Port
 *     transport needed (McpExtensionClient) has no equivalent here.
 *
 * What it costs: there is no disconnect event, so nothing tells us the far side
 * died — every request carries its own timeout, and a refused origin is
 * indistinguishable from silence (the extension answers an origin that is not
 * on the user's list by dropping the port without a word). `connect()` turns
 * that silence into the one message that actually helps: the gate compares the
 * EXACT origin, port included, while the relay is injected per host — so
 * `localhost:5173` in the popup does not serve a page on `localhost:3000`.
 *
 * The `ready` frame is treated as a hint and never required: it dispatches in a
 * later task, so a page that only listens can miss it. The marker cannot be
 * missed.
 */
import { flattenToolResult, type McpClientLike, type McpToolDef } from '@/lib/mcp'

/** What a WebCLI server row carries in its `url` field. Deliberately not an
 *  address: the relay's marker names the build that is actually installed, so
 *  the row records only "this is WebCLI, over the relay". */
export const WEBCLI_RELAY_URL = 'webcli://relay'

export function isWebcliRelayUrl(url: string): boolean {
  return url.trim() === WEBCLI_RELAY_URL
}

/** The relay's presence marker: WebCLI's extension id, or null when the relay
 *  isn't on this page — not installed, or this origin isn't on the user's list.
 *  Synchronous by design (set at document_start), so callers never have to wait
 *  for a handshake to know whether setup is done. */
export function relayExtensionId(): string | null {
  const doc = (globalThis as { document?: Document }).document
  const id = doc?.documentElement?.dataset?.webcliRelay?.trim()
  return id ? id : null
}

/** Shown when the marker is absent. Kept short: it doubles as the row label in
 *  Settings, where the setup steps sit right underneath. */
export const RELAY_ABSENT_MESSAGE =
  'WebCLI has not been allowed to talk to this site — see the setup steps.'

/** Shown when the relay IS here but the extension never answers, which is
 *  exactly what an origin missing from the user's list looks like. */
const RELAY_SILENT_MESSAGE =
  'WebCLI is on this page but did not answer — its "Web app access" list must contain this exact address, port included. Add it, then reload.'

/** Handshake round trips are instant when the origin is allowed, so a slow one
 *  means "no answer is coming" rather than "still working". */
const HANDSHAKE_TIMEOUT_MS = 15_000

/**
 * Tool calls drive a real browser — a page load plus an extraction is routinely
 * tens of seconds, and `generic__fetch_url` is also how CORS-blocked HTTP tools
 * reach the web. The extension caps its own calls at 240s, so we sit just past
 * that: its own "call timed out" reaches the model with the real reason, and
 * this only fires when the far side is truly gone. Cutting a live call short
 * here would report a failure for work that is still running.
 */
const CALL_TIMEOUT_MS = 250_000

interface RpcError {
  code: number
  message: string
}

interface RelayFrame {
  webcli?: unknown
  dir?: unknown
  ext?: unknown
  ready?: unknown
  msg?: unknown
}

/** The `window` the page and the relay share. Absent under vitest's node
 *  environment, and the error says so rather than throwing a TypeError. */
function pageWindow(): Window {
  const win = (globalThis as { window?: Window }).window
  if (!win) throw new Error('WebCLI needs a browser window — there is none here')
  return win
}

export class McpRelayClient implements McpClientLike {
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  /** The install we address, re-read from the marker per request: a dev build
   *  replacing the store build changes the id under us, and an untargeted frame
   *  would be executed by BOTH installs — twice, which matters as soon as a
   *  write tool is involved. */
  private ext: string | null = null
  private listener: ((e: MessageEvent) => void) | null = null
  /** Never called: there is no lifecycle event to observe. A relay that stopped
   *  answering surfaces as a timeout on the next call, which the store already
   *  turns into a red row. */
  onLost?: (reason: string) => void

  /** Takes no config on purpose: the marker supplies the target, and there is
   *  no URL, id or token for a user to get wrong. */

  dispose(): void {
    const win = (globalThis as { window?: Window }).window
    if (this.listener && win) win.removeEventListener('message', this.listener)
    this.listener = null
    this.onLost = undefined
    // Nothing else will ever settle these — the listener is gone. Reject rather
    // than leave a caller waiting out the full call timeout. The wording stays
    // clear of isRecoverable()'s vocabulary: the call may have run, so it must
    // not be resent.
    const err = new Error('WebCLI transport was replaced')
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  /** Resolve the target install and make sure we're listening. Throws when the
   *  relay isn't on this page. */
  private attach(): { win: Window; ext: string } {
    const ext = relayExtensionId()
    if (!ext) throw new Error(RELAY_ABSENT_MESSAGE)
    const win = pageWindow()
    this.ext = ext
    if (!this.listener) {
      this.listener = (e: MessageEvent) => this.onFrame(win, e)
      win.addEventListener('message', this.listener)
    }
    return { win, ext }
  }

  private onFrame(win: Window, e: MessageEvent): void {
    if (e.source !== win) return // only this page's own frames
    const d = e.data as RelayFrame | null
    if (!d || d.webcli !== 'mcp' || d.dir !== 'to-page' || !d.msg) return
    // A second install (store + dev) answering something we didn't send it.
    if (this.ext && typeof d.ext === 'string' && d.ext !== this.ext) return
    const m = d.msg as { id?: unknown; result?: unknown; error?: RpcError; method?: unknown }
    if (typeof m.method === 'string' && m.method.startsWith('notifications/')) return
    if (typeof m.id !== 'number') return
    const p = this.pending.get(m.id)
    if (!p) return
    this.pending.delete(m.id)
    if (m.error) p.reject(new Error(`${m.error.message} (${m.error.code})`))
    else p.resolve(m.result)
  }

  private post(win: Window, ext: string, msg: unknown): void {
    win.postMessage({ webcli: 'mcp', dir: 'to-ext', ext, msg }, win.location.origin)
  }

  private rpc(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const { win, ext } = this.attach()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP ${method} timed out (${Math.round(timeoutMs / 1000)}s)`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v: unknown) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e: Error) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error('aborted'))
      })
      this.post(win, ext, { jsonrpc: '2.0', id, method, params })
    })
  }

  async connect(): Promise<McpToolDef[]> {
    try {
      await this.rpc(
        'initialize',
        {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'browser-md', version: '0.1.0' },
        },
        HANDSHAKE_TIMEOUT_MS,
      )
    } catch (err) {
      // Silence here is the refused-origin case, and "timed out" would send the
      // user looking for a slow network instead of a popup setting.
      if (/timed out/.test((err as Error).message)) throw new Error(RELAY_SILENT_MESSAGE)
      throw err
    }
    const { win, ext } = this.attach()
    this.post(win, ext, { jsonrpc: '2.0', method: 'notifications/initialized' })
    const result = (await this.rpc('tools/list', {}, HANDSHAKE_TIMEOUT_MS)) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
    }
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    }))
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = (await this.rpc(
      'tools/call',
      { name, arguments: args },
      CALL_TIMEOUT_MS,
      signal,
    )) as { content?: Array<Record<string, unknown>>; isError?: boolean }
    return flattenToolResult(result ?? {})
  }
}
