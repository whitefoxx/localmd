/**
 * MCP (Model Context Protocol) client over Streamable HTTP — the browser-
 * reachable transport: one endpoint, JSON-RPC over POST, responses either
 * application/json or a text/event-stream body. Only servers that allow
 * browser CORS work (same constraint as LLM endpoints — document it).
 *
 * External tools are namespaced `mcp__<server>__<tool>` (Claude Code's
 * convention) so they can't shadow built-in tools.
 */

export interface McpServerConfig {
  id: string
  /** Short name used in tool namespacing — sanitized to [a-z0-9-]. */
  name: string
  /** HTTP endpoint, or a 32-char Chrome extension ID (Port transport). */
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
    if (c.type === 'image') return `[图片 ${c.mimeType ?? ''}]`
    if (c.type === 'resource') {
      const r = c.resource as { text?: string; uri?: string } | undefined
      return r?.text ?? `[资源 ${r?.uri ?? ''}]`
    }
    if (c.type === 'resource_link') return `[资源链接 ${c.uri ?? ''}]`
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

export class McpHttpClient {
  private nextId = 1
  private sessionId: string | null = null

  constructor(private cfg: McpServerConfig) {}

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

/* ── Chrome-extension transport (web-agent bridge) ───────────────────────── */

/** Chrome extension IDs are exactly 32 chars of a-p. When a "server" entry's
 *  url field matches, we speak the same JSON-RPC shapes over a
 *  chrome.runtime Port instead of HTTP (externally_connectable). */
export function isExtensionId(s: string): boolean {
  return /^[a-p]{32}$/.test(s.trim())
}

export interface McpClientLike {
  connect(): Promise<McpToolDef[]>
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>
}

interface ChromePort {
  postMessage(msg: unknown): void
  disconnect(): void
  onMessage: { addListener(cb: (msg: unknown) => void): void }
  onDisconnect: { addListener(cb: () => void): void }
}

interface ChromeRuntimeGlobal {
  runtime?: {
    connect(extensionId: string): ChromePort
    lastError?: { message?: string }
  }
}

const HANDSHAKE_TIMEOUT_MS = 10_000
/** Web tasks legitimately take minutes (the extension runs a whole agent loop). */
const CALL_TIMEOUT_MS = 600_000

export class McpExtensionClient implements McpClientLike {
  private port: ChromePort | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  constructor(private cfg: McpServerConfig) {}

  private ensurePort(): ChromePort {
    if (this.port) return this.port
    const chrome = (globalThis as unknown as { chrome?: ChromeRuntimeGlobal }).chrome
    if (!chrome?.runtime?.connect) {
      throw new Error(
        'chrome.runtime 不可用——需要安装对应扩展,且其 externally_connectable 允许本页面源',
      )
    }
    const port = chrome.runtime.connect(this.cfg.url.trim())
    port.onMessage.addListener((msg) => this.onMessage(msg))
    port.onDisconnect.addListener(() => {
      this.port = null
      const detail = chrome.runtime?.lastError?.message
      const err = new Error(`扩展连接已断开${detail ? `: ${detail}` : ''}`)
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    })
    this.port = port
    return port
  }

  private onMessage(msg: unknown): void {
    const m = msg as { id?: number; result?: unknown; error?: RpcError; method?: string }
    if (typeof m.method === 'string' && m.method.startsWith('notifications/')) return
    if (typeof m.id !== 'number') return
    const p = this.pending.get(m.id)
    if (!p) return
    this.pending.delete(m.id)
    if (m.error) p.reject(new Error(`${m.error.message} (${m.error.code})`))
    else p.resolve(m.result)
  }

  private rpc(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const port = this.ensurePort()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP ${method} 超时(${Math.round(timeoutMs / 1000)}s)`))
      }, timeoutMs)
      const settle = {
        resolve: (v: unknown) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e: Error) => {
          clearTimeout(timer)
          reject(e)
        },
      }
      signal?.addEventListener('abort', () => {
        this.pending.delete(id)
        settle.reject(new Error('aborted'))
      })
      this.pending.set(id, settle)
      port.postMessage({ jsonrpc: '2.0', id, method, params })
    })
  }

  async connect(): Promise<McpToolDef[]> {
    await this.rpc(
      'initialize',
      {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'browser-md', version: '0.1.0' },
      },
      HANDSHAKE_TIMEOUT_MS,
    )
    this.port?.postMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const result = (await this.rpc('tools/list', {}, HANDSHAKE_TIMEOUT_MS)) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
    }
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    }))
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const result = (await this.rpc('tools/call', { name, arguments: args }, CALL_TIMEOUT_MS, signal)) as {
      content?: Array<Record<string, unknown>>
      isError?: boolean
    }
    return flattenToolResult(result ?? {})
  }
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
