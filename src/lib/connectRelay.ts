/**
 * localmd Connect transport — JSON-RPC/MCP over `window.postMessage`.
 *
 * localmd Connect is this app's companion extension: the generic browser
 * bridge (open/read/click/fetch with the user's cookies) plus marketplace site
 * adapters and persistent site scripts. There is no `externally_connectable`
 * path (that field is read once at install time; nothing at runtime can widen
 * it, and it cannot express "let the user add a site"), so the extension
 * registers a tiny relay content script per authorized origin and we exchange
 * JSON-RPC frames with the relay instead of a Port. https://localmd.app is
 * pre-authorized at install; only dev origins need adding in the popup under
 * "Web app access".
 *
 *   page → ext : { webcli:'mcp', dir:'to-ext', ext, msg:<jsonrpc> }
 *   ext → page : { webcli:'mcp', dir:'to-page', ext, msg:<jsonrpc> }
 *   on attach  : { webcli:'mcp', dir:'to-page', ext, ready:true }
 *
 * The `webcli:` envelope tag is the relay WIRE FORMAT, fixed on the extension
 * side — a protocol constant, not a product reference; it cannot be renamed
 * from here. Other extensions built from the same relay codebase listen for
 * the same envelope, so `ext` is a MUST on every to-ext frame: an untargeted
 * frame would be executed by every listener — twice or more, which matters the
 * moment a write tool is involved. `post()` is the only sender and always
 * addresses the install the marker names.
 *
 * Two things this buys us over the Port:
 *   - Nothing about the extension is pinned. The relay writes its own extension
 *     id to `<html data-localmd-connect>` at document_start, so detection is
 *     synchronous and race-free, a dev build works with no configuration, and
 *     the app has no store id to go stale.
 *   - No `initialize` state to lose. The extension's handler answers tools/call
 *     on a fresh port, and the relay silently redials its service worker when
 *     MV3 recycles it — so a reconnect-and-re-handshake dance has no
 *     equivalent here.
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
import {
  flattenToolResult,
  type McpClientLike,
  type McpToolDef,
  type McpWire,
} from '@/lib/mcp'

/** One extension speaking the relay protocol: which DOM marker announces it,
 *  and what to call it when talking to the user. A parameter rather than a
 *  constant baked into the client so tests can stand up a fake extension —
 *  and a future sibling build costs a declaration, not a fork. */
export interface RelayExtension {
  /** `documentElement.dataset` key of the presence marker (the camelCased form
   *  of the `data-*` attribute the relay content script writes). */
  marker: string
  /** Display name for error messages and row labels. */
  name: string
}

export const LOCALMD_CONNECT_EXTENSION: RelayExtension = {
  marker: 'localmdConnect',
  name: 'localmd Connect',
}

/** What a localmd Connect server row carries in its `url` field. Deliberately
 *  not an address: the relay's marker names the build that is actually
 *  installed, so the row records only "this is localmd Connect, over the
 *  relay" — never an address, never an id. */
export const LOCALMD_CONNECT_RELAY_URL = 'localmd-connect://relay'

export function isLocalmdConnectRelayUrl(url: string): boolean {
  return url.trim() === LOCALMD_CONNECT_RELAY_URL
}

/** The relay's presence marker: the extension's id, or null when its relay
 *  isn't on this page — not installed, or this origin isn't on the user's list.
 *  Synchronous by design (set at document_start), so callers never have to wait
 *  for a handshake to know whether setup is done. */
export function relayExtensionId(
  marker: string = LOCALMD_CONNECT_EXTENSION.marker,
): string | null {
  const doc = (globalThis as { document?: Document }).document
  const id = doc?.documentElement?.dataset?.[marker]?.trim()
  return id ? id : null
}

/** Shown when the marker is absent. Kept short: it doubles as the row label in
 *  Settings, where the setup steps sit right underneath. */
export function relayAbsentMessage(ext: RelayExtension): string {
  return `${ext.name} has not been allowed to talk to this site — see the setup steps.`
}

/** Shown when the relay IS here but the extension never answers, which is
 *  exactly what an origin missing from the user's list looks like. */
function relaySilentMessage(ext: RelayExtension): string {
  return `${ext.name} is on this page but did not answer — its "Web app access" list must contain this exact address, port included. Add it, then reload.`
}

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

/* ── fetch_url as a generic HTTP transport ───────────────────────────────── */

/**
 * What `generic__fetch_url` answers with. The extension returns more fields than
 * this (url, statusText, format, bytes, truncated, with_cookies…); these are the
 * ones anything here reads.
 *
 * `headers` is what makes this usable as an MCP transport at all: Streamable
 * HTTP keeps its session in the `Mcp-Session-Id` RESPONSE header, and OAuth
 * discovery begins at `WWW-Authenticate` — and that second one is not merely
 * convenient here, it is only available here. A page cannot read
 * `WWW-Authenticate` off a cross-origin 401 unless the server sends
 * `Access-Control-Expose-Headers`, which almost none do; through the extension
 * every header is readable.
 */
export interface ExtensionFetchResult {
  status?: number
  ok?: boolean
  headers?: Record<string, string>
  content_type?: string
  body?: string
  note?: string
  /** Set when `stream_stop` ended the read early: `body` is a PREFIX of what the
   *  server was still willing to send. */
  stream_open?: boolean
}

/** Parse a fetch_url result. The bridge reports its own failures as plain text
 *  rather than a result object, so a parse failure IS the error message. */
export function parseExtensionFetch(out: string): ExtensionFetchResult {
  try {
    return JSON.parse(out) as ExtensionFetchResult
  } catch {
    throw new Error(out.slice(0, 300))
  }
}

/** Header lookup that does not care how the far side cased its keys. */
function lowerKeys(h: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = v
  return out
}

/**
 * How long a proxied read may sit quiet before we take what we have.
 *
 * MCP Streamable HTTP lets a server answer a POST with an SSE stream and then
 * KEEP IT OPEN. A buffered proxy waiting for the body to end can only time out
 * there, so we ask fetch_url to stop on an idle stream instead.
 *
 * `idle` rather than `first_event`: a server may put a progress notification on
 * the stream ahead of the response, and stopping at the first event would return
 * that instead. Idle costs nothing when the server closes the stream normally —
 * the read ends at the close, not at the timer — so the wait is only ever paid
 * by servers that hold the stream open, which are the ones this exists for.
 */
const STREAM_IDLE_MS = 2_000

/** Cap on a proxied response, matching what the extension will return. */
const PROXY_MAX_BYTES = 2_000_000

/** The extension's own call budget is 240s; this bounds one HTTP exchange well
 *  inside it so a slow endpoint reports as itself rather than as a dead relay. */
const PROXY_TIMEOUT_MS = 60_000

/**
 * The extension's `fetch_url` as an MCP wire — the transport for endpoints that
 * refuse browsers outright. `call` runs one fetch_url tool call and returns its
 * raw text result; stores/mcp.ts binds it to whichever server row provides the
 * tool, which is also why this takes a function rather than importing the tool
 * name (that lives in toolCatalog, which imports from here).
 */
export function extensionWire(
  call: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>,
): McpWire {
  return async (req, signal) => {
    const out = await call(
      {
        url: req.url,
        method: req.method,
        headers: JSON.stringify(req.headers),
        ...(req.body !== undefined ? { body: req.body } : {}),
        format: 'text',
        stream_stop: 'idle',
        idle_timeout_ms: STREAM_IDLE_MS,
        timeout_ms: PROXY_TIMEOUT_MS,
        max_bytes: PROXY_MAX_BYTES,
      },
      signal,
    )
    const r = parseExtensionFetch(out)
    return {
      status: r.status ?? 0,
      ok: r.ok === true,
      headers: lowerKeys(r.headers),
      body: r.body ?? '',
      contentType: r.content_type ?? '',
    }
  }
}

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
function pageWindow(ext: RelayExtension): Window {
  const win = (globalThis as { window?: Window }).window
  if (!win) throw new Error(`${ext.name} needs a browser window — there is none here`)
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

  /** The only config is WHICH extension — its marker supplies the target
   *  install, so there is still no URL, id or token for a user to get wrong. */
  constructor(private target: RelayExtension = LOCALMD_CONNECT_EXTENSION) {}

  dispose(): void {
    const win = (globalThis as { window?: Window }).window
    if (this.listener && win) win.removeEventListener('message', this.listener)
    this.listener = null
    this.onLost = undefined
    // Nothing else will ever settle these — the listener is gone. Reject rather
    // than leave a caller waiting out the full call timeout. The wording stays
    // clear of isRecoverable()'s vocabulary: the call may have run, so it must
    // not be resent.
    const err = new Error(`${this.target.name} transport was replaced`)
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  /** Resolve the target install and make sure we're listening. Throws when the
   *  relay isn't on this page. */
  private attach(): { win: Window; ext: string } {
    const ext = relayExtensionId(this.target.marker)
    if (!ext) throw new Error(relayAbsentMessage(this.target))
    const win = pageWindow(this.target)
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
          clientInfo: { name: 'localmd', version: '0.1.0' },
        },
        HANDSHAKE_TIMEOUT_MS,
      )
    } catch (err) {
      // Silence here is the refused-origin case, and "timed out" would send the
      // user looking for a slow network instead of a popup setting.
      if (/timed out/.test((err as Error).message)) {
        throw new Error(relaySilentMessage(this.target))
      }
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
