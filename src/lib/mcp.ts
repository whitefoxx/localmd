/**
 * MCP (Model Context Protocol) client over Streamable HTTP — one endpoint,
 * JSON-RPC over POST, responses either application/json or a text/event-stream
 * body. Only servers that allow browser CORS work (same constraint as LLM
 * endpoints — document it). The other transport a server row can select is
 * WebCLI's postMessage relay, in lib/webcliRelay.ts; both speak the shapes
 * defined here and satisfy McpClientLike.
 *
 * External tools are namespaced `mcp__<server>__<tool>` (Claude Code's
 * convention) so they can't shadow built-in tools.
 */

export interface McpServerConfig {
  id: string
  /** Short name used in tool namespacing — sanitized to [a-z0-9-]. */
  name: string
  /** A Streamable-HTTP endpoint, or WEBCLI_RELAY_URL for WebCLI's relay. */
  url: string
  /** Optional bearer token. */
  token?: string
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

/** Split a namespaced tool name; null when it isn't an external tool. */
export function parseExternalToolName(name: string): { server: string; tool: string } | null {
  const m = /^mcp__([a-z0-9-]+)__(.+)$/.exec(name)
  return m ? { server: m[1], tool: m[2] } : null
}

/** A Streamable-HTTP POST may answer with an SSE body; the JSON-RPC response
 *  is the last `data:` event that parses as JSON. */
export function parseSseResponse(body: string): unknown {
  let last: unknown = null
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      last = JSON.parse(payload)
    } catch {
      /* keep scanning */
    }
  }
  return last
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

const TIMEOUT_MS = 60_000

interface RpcError {
  code: number
  message: string
}

export class McpHttpClient implements McpClientLike {
  private nextId = 1
  private sessionId: string | null = null
  onLost?: (reason: string) => void

  constructor(private cfg: McpServerConfig) {}

  /** Tell the server the session is over (spec teardown), best-effort: we are
   *  dropping this client either way, and a server that ignores DELETE is fine. */
  dispose(): void {
    const session = this.sessionId
    this.sessionId = null
    if (!session) return
    void fetch(this.cfg.url, {
      method: 'DELETE',
      headers: {
        ...(this.cfg.token ? { Authorization: `Bearer ${this.cfg.token}` } : {}),
        'Mcp-Session-Id': session,
      },
    }).catch(() => {
      /* the session dies with the page anyway */
    })
  }

  private headers(json: boolean): Record<string, string> {
    return {
      Accept: 'application/json, text/event-stream',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(this.cfg.token ? { Authorization: `Bearer ${this.cfg.token}` } : {}),
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
    }
  }

  private async post(payload: unknown, signal?: AbortSignal): Promise<Response> {
    return fetch(this.cfg.url, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(payload),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS),
    })
  }

  private async rpc(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++
    const resp = await this.post({ jsonrpc: '2.0', id, method, params }, signal)
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`MCP ${method} HTTP ${resp.status}: ${text.slice(0, 200)}`)
    }
    const session = resp.headers.get('mcp-session-id')
    if (session) this.sessionId = session
    const contentType = resp.headers.get('content-type') ?? ''
    const body = await resp.text()
    const message = contentType.includes('text/event-stream')
      ? parseSseResponse(body)
      : body
        ? JSON.parse(body)
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
