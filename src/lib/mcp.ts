/**
 * MCP (Model Context Protocol) client over Streamable HTTP — one endpoint,
 * JSON-RPC over POST, responses either application/json or a text/event-stream
 * body. A server row picks how it is REACHED (McpWire below: the browser's own
 * fetch, or WebCLI's fetch_url for endpoints that refuse browsers) and, for
 * WebCLI itself, an entirely different transport — the postMessage relay in
 * lib/webcliRelay.ts, which satisfies McpClientLike rather than McpWire.
 *
 * External tools are namespaced `mcp__<server>__<tool>` (Claude Code's
 * convention) so they can't shadow built-in tools.
 *
 * We speak protocol version 2025-03-26. Note what the 2026-07-28 revision did
 * to the two most awkward parts of this file: it removed the `Mcp-Session-Id`
 * header and the initialize/notifications-initialized handshake outright, and
 * dropped SSE resumability and server-initiated requests with them. So the
 * session plumbing here is backwards compatibility, not the direction of
 * travel — when servers in the wild move, it becomes deletable rather than
 * something to extend. Advertising a newer version is not urgent: a 2026-07-28
 * server still answers a 2025-03-26 client, and almost nothing implements the
 * new revision yet.
 */

export interface McpServerConfig {
  id: string
  /** Short name used in tool namespacing — sanitized to [a-z0-9-]. */
  name: string
  /** A Streamable-HTTP endpoint, or WEBCLI_RELAY_URL for WebCLI's relay.
   *  May carry `{{secret:<id>}}` — see resolveServerSecrets. */
  url: string
  /** Optional bearer token — sugar for `headers: { Authorization: 'Bearer …' }`,
   *  kept because it is the shape most servers and every existing config use.
   *  May carry `{{secret:<id>}}`. */
  token?: string
  /**
   * Extra request headers, values possibly carrying `{{secret:<id>}}`.
   *
   * Bearer is the common case, not the only one: hosted MCP servers ask for a
   * key in whatever header they chose (`x-api-key` and friends), or in the URL.
   * Rather than grow a branch per service, the machinery carries arbitrary
   * headers and a URL template, and a catalog entry is then just data that
   * names a header and a secret — which is also all the user has to supply.
   */
  headers?: Record<string, string>
  /** How to reach `url`. 'direct' (default) is a browser fetch, so the endpoint
   *  must allow CORS. 'webcli' proxies every exchange through the WebCLI
   *  extension's fetch_url, which runs in a service worker and is not bound by
   *  page CORS — the only way to reach the majority of hosted MCP servers, which
   *  send no CORS headers at all. Ignored when `url` is WEBCLI_RELAY_URL: that
   *  row IS WebCLI. */
  transport?: 'direct' | 'webcli'
  /** false = keep the config but don't connect (default true). */
  enabled?: boolean
}

export interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export function sanitizeServerName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'server'
  )
}

export function externalToolName(server: string, tool: string): string {
  return `mcp__${sanitizeServerName(server)}__${tool}`
}

/* ── secrets ─────────────────────────────────────────────────────────────── */

/** Same spelling HTTP tools use, so one thing is learned once. */
const SECRET_REF = /\{\{secret:([a-zA-Z0-9_-]+)\}\}/g

/** Every secret id a row references — what the UI collects, and all a KB-scoped
 *  config is ever allowed to name. Never the value. */
export function serverSecretRefs(cfg: {
  url?: string
  token?: string
  headers?: Record<string, string>
}): string[] {
  const seen = new Set<string>()
  const scan = (s: string | undefined): void => {
    for (const m of String(s ?? '').matchAll(SECRET_REF)) seen.add(m[1])
  }
  scan(cfg.url)
  scan(cfg.token)
  for (const v of Object.values(cfg.headers ?? {})) scan(v)
  return [...seen]
}

/**
 * Substitute `{{secret:<id>}}` throughout a row, at CONNECT time rather than at
 * install time. A row therefore stores the reference, never the value: the user
 * can add the server before the key, rotate the key without touching the row,
 * and the secret keeps living in exactly one place.
 *
 * A referenced secret with no value is reported rather than substituted with
 * emptiness — sending a half-built credential produces a 401 the user has to
 * decode, when the real answer is "you have not entered the key yet".
 */
export function resolveServerSecrets(
  cfg: McpServerConfig,
  lookup: (id: string) => string | undefined,
): { config: McpServerConfig } | { missing: string[] } {
  const missing = serverSecretRefs(cfg).filter((id) => !lookup(id))
  if (missing.length) return { missing }
  const sub = (s: string): string => s.replace(SECRET_REF, (_, id: string) => lookup(id) ?? '')
  return {
    config: {
      ...cfg,
      url: sub(cfg.url),
      ...(cfg.token ? { token: sub(cfg.token) } : {}),
      ...(cfg.headers
        ? { headers: Object.fromEntries(Object.entries(cfg.headers).map(([k, v]) => [k, sub(v)])) }
        : {}),
    },
  }
}

/** Split a namespaced tool name; null when it isn't an external tool. */
export function parseExternalToolName(name: string): { server: string; tool: string } | null {
  const m = /^mcp__([a-z0-9-]+)__(.+)$/.exec(name)
  return m ? { server: m[1], tool: m[2] } : null
}

/**
 * A Streamable-HTTP POST may answer with an SSE body; the JSON-RPC response is
 * the last `data:` event that parses as JSON.
 *
 * `id` narrows that: a server is allowed to put other messages on the same
 * stream — a progress notification, a server-initiated request — and "last one
 * wins" would hand back whichever happened to arrive last. When the caller says
 * which id it is waiting for, a message carrying that id wins outright; the
 * last-parsed value stays the fallback for servers that answer without echoing
 * one.
 */
export function parseSseResponse(body: string, id?: number): unknown {
  let last: unknown = null
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const parsed = JSON.parse(payload)
      if (id !== undefined && (parsed as { id?: unknown })?.id === id) return parsed
      last = parsed
    } catch {
      /* keep scanning */
    }
  }
  return last
}

/* ── the wire ────────────────────────────────────────────────────────────── */

export interface McpWireRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

export interface McpWireReply {
  status: number
  ok: boolean
  /** Lowercased keys. Two of these carry protocol state rather than metadata:
   *  `mcp-session-id` is the whole of Streamable HTTP's session, and
   *  `www-authenticate` is where OAuth discovery starts. A transport that drops
   *  headers cannot speak MCP. */
  headers: Record<string, string>
  body: string
  contentType: string
}

/**
 * One request/response exchange, and the only thing that differs between
 * reaching a server directly and reaching it through WebCLI. Everything else —
 * the JSON-RPC framing, the session header, SSE parsing, the teardown — is
 * written once in McpHttpClient and works over either.
 */
export type McpWire = (req: McpWireRequest, signal?: AbortSignal) => Promise<McpWireReply>

const TIMEOUT_MS = 60_000

/** The browser's own fetch. Subject to CORS, which is the entire reason the
 *  other wire exists. */
export const directWire: McpWire = async (req, signal) => {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    ...(req.body !== undefined ? { body: req.body } : {}),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  const headers: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  return {
    status: res.status,
    ok: res.ok,
    headers,
    body: await res.text(),
    contentType: res.headers.get('content-type') ?? '',
  }
}

/** Flatten an MCP tools/call result into text for the model. */
export function flattenToolResult(result: {
  content?: Array<Record<string, unknown>>
  isError?: boolean
}): string {
  const parts = (result.content ?? []).map((c) => {
    if (c.type === 'text') return String(c.text ?? '')
    if (c.type === 'image') return `[image ${c.mimeType ?? ''}]`
    if (c.type === 'resource') {
      const r = c.resource as { text?: string; uri?: string } | undefined
      return r?.text ?? `[resource ${r?.uri ?? ''}]`
    }
    if (c.type === 'resource_link') return `[resource link ${c.uri ?? ''}]`
    return ''
  })
  const text = parts.filter(Boolean).join('\n') || '(empty result)'
  return result.isError ? `Error: ${text}` : text
}

interface RpcError {
  code: number
  message: string
}

export class McpHttpClient implements McpClientLike {
  private nextId = 1
  private sessionId: string | null = null
  onLost?: (reason: string) => void

  /** `wire` defaults to the browser's fetch; stores/mcp.ts hands in the WebCLI
   *  one for rows whose endpoint refuses browsers. */
  constructor(
    private cfg: McpServerConfig,
    private wire: McpWire = directWire,
  ) {}

  /** Tell the server the session is over (spec teardown), best-effort: we are
   *  dropping this client either way, and a server that ignores DELETE is fine. */
  dispose(): void {
    const session = this.sessionId
    this.sessionId = null
    if (!session) return
    void this.wire({
      url: this.cfg.url,
      method: 'DELETE',
      // Same auth as every other request: a server that rejects the teardown
      // for want of a key just leaks a session until it expires.
      headers: {
        ...(this.cfg.headers ?? {}),
        ...(this.cfg.token ? { Authorization: `Bearer ${this.cfg.token}` } : {}),
        'Mcp-Session-Id': session,
      },
    }).catch(() => {
      /* the session dies with the page anyway */
    })
  }

  /** Configured headers sit between the defaults and the protocol's own, so a
   *  row can set Accept or its own auth header, but nothing a user typed can
   *  dislodge the session header the transport depends on. */
  private headers(json: boolean): Record<string, string> {
    return {
      Accept: 'application/json, text/event-stream',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(this.cfg.headers ?? {}),
      ...(this.cfg.token ? { Authorization: `Bearer ${this.cfg.token}` } : {}),
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
    }
  }

  private async post(payload: unknown, signal?: AbortSignal): Promise<McpWireReply> {
    return this.wire(
      {
        url: this.cfg.url,
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify(payload),
      },
      signal,
    )
  }

  private async rpc(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++
    const resp = await this.post({ jsonrpc: '2.0', id, method, params }, signal)
    if (!resp.ok) {
      throw new Error(`MCP ${method} HTTP ${resp.status}: ${resp.body.slice(0, 200)}`)
    }
    const session = resp.headers['mcp-session-id']
    if (session) this.sessionId = session
    const message = resp.contentType.includes('text/event-stream')
      ? parseSseResponse(resp.body, id)
      : resp.body
        ? JSON.parse(resp.body)
        : null
    const m = message as { result?: unknown; error?: RpcError } | null
    if (!m) throw new Error(`MCP ${method}: empty response`)
    if (m.error) throw new Error(`MCP ${method}: ${m.error.message} (${m.error.code})`)
    return m.result
  }

  private async notify(method: string): Promise<void> {
    await this.post({ jsonrpc: '2.0', method }).catch(() => {
      /* notifications are best-effort */
    })
  }

  /** initialize handshake + tools/list. */
  async connect(): Promise<McpToolDef[]> {
    await this.rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'browser-md', version: '0.1.0' },
    })
    await this.notify('notifications/initialized')
    const result = (await this.rpc('tools/list', {})) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
    }
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    }))
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const result = (await this.rpc('tools/call', { name, arguments: args }, signal)) as {
      content?: Array<Record<string, unknown>>
      isError?: boolean
    }
    return flattenToolResult(result ?? {})
  }
}

export interface McpClientLike {
  connect(): Promise<McpToolDef[]>
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>
  /** Release the transport. The client is dead afterwards — a replacement is
   *  built by whoever reconnects, so nothing here has to survive. */
  dispose(): void
  /** Set by the store: the transport dropped on its own. Without it a dead
   *  connection keeps its green dot. */
  onLost?: (reason: string) => void
}

/** Failures where the request provably never reached the server, so reconnecting
 *  and sending it again cannot run the tool twice: the session was gone, or we
 *  never had a connection to begin with. A plain tool error, a timeout, or a 500
 *  is NOT in here — those may have had effects. */
export function isRecoverable(err: unknown): boolean {
  const m = (err as Error)?.message ?? ''
  return (
    /not connected/i.test(m) ||
    /connection closed/i.test(m) ||
    /HTTP 404/.test(m) ||
    /session/i.test(m)
  )
}

/* ── config parsing & merging (global Settings + KB .agents/mcp.json) ────── */

/** KB-level config file: tool-neutral location, travels with the KB via git. */
export const KB_MCP_CONFIG_PATH = '.agents/mcp.json'

/** Parse a raw server list (from Settings storage or the KB file). Invalid
 *  entries are dropped; `enabled` defaults to true. `makeId` supplies stable
 *  ids for entries that lack one (KB entries derive from name+url). */
/** String-valued entries only. A KB's mcp.json is someone else's file, so a
 *  header whose value is an object or a number is dropped rather than coerced
 *  into `[object Object]` and sent. */
function headersFrom(raw: unknown): { headers: Record<string, string> } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k && typeof v === 'string') out[k] = v
  }
  return Object.keys(out).length ? { headers: out } : null
}

export function normalizeMcpServerList(
  raw: unknown,
  makeId: (s: { name: string; url: string }) => string,
): McpServerConfig[] {
  if (!Array.isArray(raw)) return []
  const out: McpServerConfig[] = []
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue
    const ss = s as Record<string, unknown>
    const url = String(ss.url ?? '').trim()
    if (!url) continue
    const name = String(ss.name ?? 'server')
    out.push({
      id: typeof ss.id === 'string' && ss.id ? ss.id : makeId({ name, url }),
      name,
      url,
      ...(ss.token ? { token: String(ss.token) } : {}),
      ...(headersFrom(ss.headers) ?? {}),
      ...(ss.transport === 'webcli' ? { transport: 'webcli' as const } : {}),
      ...(ss.enabled === false ? { enabled: false } : {}),
    })
  }
  return out
}

/** Merge global + KB server lists. Duplicate targets (same url/extension id)
 *  keep the KB entry — the KB is the more specific scope. */
export function mergeMcpConfigs(
  global: McpServerConfig[],
  kb: McpServerConfig[],
): Array<McpServerConfig & { source: 'global' | 'kb' }> {
  const kbUrls = new Set(kb.map((s) => s.url))
  return [
    ...kb.map((s) => ({ ...s, source: 'kb' as const })),
    ...global.filter((s) => !kbUrls.has(s.url)).map((s) => ({ ...s, source: 'global' as const })),
  ]
}

/* ── deferred loading (tool-schema bloat control) ────────────────────────── */

/** Servers with more tools than this get DEFERRED: their tools stay out of
 *  the request until the model activates them via enable_tools. The system
 *  prompt carries a one-line-per-tool catalog instead (~10 tokens/tool vs
 *  hundreds for a full schema). */
export const DEFER_THRESHOLD = 8

/** Is this tool deferred right now? */
export function isDeferredTool(
  qualifiedName: string,
  serverToolCount: number,
  activated: ReadonlySet<string>,
  threshold = DEFER_THRESHOLD,
): boolean {
  if (serverToolCount <= threshold) return false
  return !activated.has(qualifiedName)
}

/** One catalog line for the system prompt. */
export function catalogEntry(qualifiedName: string, description: string): string {
  const desc = description.replace(/\s+/g, ' ').trim()
  return `- ${qualifiedName}: ${desc.length > 80 ? `${desc.slice(0, 80)}…` : desc}`
}

/* ── recall (pre-activating what this KB actually uses) ──────────────────── */

/** How many deferred tools a KB may carry into a fresh session. Their schemas
 *  then ride along with EVERY request of that session, so this is the ceiling
 *  on what pre-activation can cost when the session turns out not to need
 *  them — deliberately small. Only tools the agent actually CALLED are
 *  remembered; merely enabling one is not enough to earn a slot. */
export const MAX_RECALLED_TOOLS = 8

/** Move `name` to the front of the recall list (most recent first) and trim to
 *  the cap — plain LRU. Returns a new array; the input is never mutated. */
export function recallTouch(list: readonly string[], name: string, max = MAX_RECALLED_TOOLS): string[] {
  return [name, ...list.filter((n) => n !== name)].slice(0, Math.max(0, max))
}
