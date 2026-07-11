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
  url: string
  /** Optional bearer token. */
  token?: string
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
