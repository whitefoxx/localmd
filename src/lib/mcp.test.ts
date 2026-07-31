import { describe, it, expect } from 'vitest'
import {
  isRecoverable,
  isAuthFailure,
  sanitizeServerName,
  externalToolName,
  parseExternalToolName,
  parseSseResponse,
  flattenToolResult,
  normalizeMcpServerList,
  mergeMcpConfigs,
  isDeferredTool,
  catalogEntry,
  recallTouch,
  MAX_RECALLED_TOOLS,
  McpHttpClient,
  serverSecretRefs,
  resolveServerSecrets,
  type McpWire,
  type McpWireReply,
  type McpWireRequest,
} from './mcp'

describe('tool namespacing', () => {
  it('builds and parses mcp__server__tool names', () => {
    expect(externalToolName('DeepWiki', 'ask_question')).toBe('mcp__deepwiki__ask_question')
    expect(parseExternalToolName('mcp__deepwiki__ask_question')).toEqual({
      server: 'deepwiki',
      tool: 'ask_question',
    })
  })
  it('sanitizes odd server names', () => {
    expect(sanitizeServerName('我的 Server!')).toBe('server')
    expect(sanitizeServerName('ctx7 (prod)')).toBe('ctx7-prod')
  })
  it('rejects non-external names', () => {
    expect(parseExternalToolName('read_file')).toBeNull()
    expect(parseExternalToolName('mcp__bad')).toBeNull()
  })
})

describe('parseSseResponse', () => {
  it('extracts the last JSON data event', () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'
    expect(parseSseResponse(body)).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } })
  })
  it('skips keepalives and non-JSON events', () => {
    const body = ': ping\ndata: not-json\ndata: {"a":1}\ndata: {"b":2}\n'
    expect(parseSseResponse(body)).toEqual({ b: 2 })
  })
  it('returns null for empty bodies', () => {
    expect(parseSseResponse('')).toBeNull()
  })
  it('prefers the message carrying the id being waited on', () => {
    // A progress notification and a later unrelated frame both sit on the same
    // stream; "last one wins" would hand back the wrong one.
    const body = [
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"n":1}}',
      'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
      'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}',
      '',
    ].join('\n')
    expect(parseSseResponse(body, 7)).toEqual({ jsonrpc: '2.0', id: 7, result: { ok: true } })
  })
  it('falls back to the last event when no id matches', () => {
    const body = 'data: {"a":1}\ndata: {"b":2}\n'
    expect(parseSseResponse(body, 99)).toEqual({ b: 2 })
  })
})

describe('server secrets', () => {
  const has = (values: Record<string, string>) => (id: string) => values[id]

  it('finds references in url, token and any header', () => {
    expect(
      serverSecretRefs({
        url: 'https://e/mcp?k={{secret:in_url}}',
        token: '{{secret:in_token}}',
        headers: { 'x-api-key': '{{secret:in_header}}', 'x-plain': 'literal' },
      }).sort(),
    ).toEqual(['in_header', 'in_token', 'in_url'])
  })

  it('substitutes everywhere, leaving literals alone', () => {
    const out = resolveServerSecrets(
      {
        id: 'a',
        name: 'a',
        url: 'https://e/mcp?k={{secret:k}}',
        headers: { 'x-api-key': '{{secret:k}}', accept: 'application/json' },
      },
      has({ k: 'VALUE' }),
    )
    expect(out).toEqual({
      config: {
        id: 'a',
        name: 'a',
        url: 'https://e/mcp?k=VALUE',
        headers: { 'x-api-key': 'VALUE', accept: 'application/json' },
      },
    })
  })

  it('reports a missing secret rather than substituting emptiness', () => {
    // Half a credential reaches the server as a 401 the user has to decode; the
    // real answer is that they have not entered the key yet.
    const out = resolveServerSecrets(
      { id: 'a', name: 'a', url: 'https://e/mcp', headers: { 'x-api-key': '{{secret:nope}}' } },
      has({}),
    )
    expect(out).toEqual({ missing: ['nope'] })
  })

  it('passes a row with no references straight through', () => {
    const cfg = { id: 'a', name: 'a', url: 'https://e/mcp' }
    expect(resolveServerSecrets(cfg, has({}))).toEqual({ config: cfg })
  })
})

describe('McpHttpClient over an injected wire', () => {
  /** A wire that answers from a script, recording what it was asked to send. */
  function fakeWire(replies: McpWireReply[]) {
    const sent: McpWireRequest[] = []
    const wire: McpWire = async (req) => {
      sent.push(req)
      return replies.shift() ?? { status: 500, ok: false, headers: {}, body: '', contentType: '' }
    }
    return { wire, sent }
  }
  const json = (body: unknown, headers: Record<string, string> = {}): McpWireReply => ({
    status: 200,
    ok: true,
    headers,
    body: JSON.stringify(body),
    contentType: 'application/json',
  })

  it('handshakes, adopts the session header and namespaces nothing', async () => {
    const { wire, sent } = fakeWire([
      json({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 'sess-1' }),
      json({ jsonrpc: '2.0', result: {} }), // notifications/initialized
      json({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'search' }] } }),
    ])
    const client = new McpHttpClient({ id: 'x', name: 'x', url: 'https://e/mcp' }, wire)
    const tools = await client.connect()
    expect(tools).toEqual([{ name: 'search', description: '', inputSchema: { type: 'object', properties: {} } }])
    // The session arrived on the FIRST response and must ride every later request.
    expect(sent[0].headers['Mcp-Session-Id']).toBeUndefined()
    expect(sent[2].headers['Mcp-Session-Id']).toBe('sess-1')
  })

  it('reads a JSON-RPC response out of an SSE body', async () => {
    const { wire } = fakeWire([
      {
        status: 200,
        ok: true,
        headers: {},
        body: 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}\n\n',
        contentType: 'text/event-stream',
      },
      json({ jsonrpc: '2.0', result: {} }),
      json({ jsonrpc: '2.0', id: 2, result: { tools: [] } }),
    ])
    const client = new McpHttpClient({ id: 'x', name: 'x', url: 'https://e/mcp' }, wire)
    await expect(client.connect()).resolves.toEqual([])
  })

  it('surfaces an HTTP failure with the body, not a bare status', async () => {
    const { wire } = fakeWire([
      { status: 401, ok: false, headers: {}, body: '{"error":"invalid_token"}', contentType: 'application/json' },
    ])
    const client = new McpHttpClient({ id: 'x', name: 'x', url: 'https://e/mcp' }, wire)
    await expect(client.connect()).rejects.toThrow(/HTTP 401.*invalid_token/)
  })

  it('sends configured headers, and the protocol keeps the ones it owns', async () => {
    const { wire, sent } = fakeWire([
      json({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 'sess-1' }),
      json({ jsonrpc: '2.0', result: {} }),
      json({ jsonrpc: '2.0', id: 2, result: { tools: [] } }),
    ])
    const client = new McpHttpClient(
      { id: 'x', name: 'x', url: 'https://e/mcp', headers: { 'x-api-key': 'KEY', 'Mcp-Session-Id': 'forged' } },
      wire,
    )
    await client.connect()
    expect(sent[0].headers['x-api-key']).toBe('KEY')
    // A row cannot dislodge the session header the transport depends on.
    expect(sent[2].headers['Mcp-Session-Id']).toBe('sess-1')
  })

  it('sends the bearer token when one is configured', async () => {
    const { wire, sent } = fakeWire([
      json({ jsonrpc: '2.0', id: 1, result: {} }),
      json({ jsonrpc: '2.0', result: {} }),
      json({ jsonrpc: '2.0', id: 2, result: { tools: [] } }),
    ])
    const client = new McpHttpClient({ id: 'x', name: 'x', url: 'https://e/mcp', token: 'tok' }, wire)
    await client.connect()
    expect(sent[0].headers.Authorization).toBe('Bearer tok')
  })
})

describe('flattenToolResult', () => {
  it('joins text parts and labels non-text content', () => {
    const out = flattenToolResult({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', mimeType: 'image/png', data: 'x' },
        { type: 'resource', resource: { text: 'embedded' } },
      ],
    })
    expect(out).toBe('hello\n[image image/png]\nembedded')
  })
  it('marks isError results', () => {
    expect(flattenToolResult({ content: [{ type: 'text', text: 'boom' }], isError: true })).toBe(
      'Error: boom',
    )
  })
  it('handles empty content', () => {
    expect(flattenToolResult({})).toBe('(empty result)')
  })
})

describe('normalizeMcpServerList', () => {
  const makeId = (s: { name: string; url: string }) => `kb:${s.name}:${s.url}`
  it('parses valid entries, defaults enabled, drops garbage', () => {
    const out = normalizeMcpServerList(
      [
        { name: 'a', url: 'https://x/mcp' },
        { name: 'b', url: 'https://y/mcp', enabled: false, token: 't' },
        { url: '' },
        'junk',
        null,
      ],
      makeId,
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ id: 'kb:a:https://x/mcp', name: 'a', url: 'https://x/mcp' })
    expect(out[1].enabled).toBe(false)
    expect(out[1].token).toBe('t')
  })
  it('returns empty for non-arrays', () => {
    expect(normalizeMcpServerList({ servers: [] }, makeId)).toEqual([])
    expect(normalizeMcpServerList(undefined, makeId)).toEqual([])
  })
  it('carries transport:webcli through, and only that spelling', () => {
    const out = normalizeMcpServerList(
      [
        { name: 'a', url: 'https://a/mcp', transport: 'webcli' },
        { name: 'b', url: 'https://b/mcp', transport: 'direct' },
        { name: 'c', url: 'https://c/mcp', transport: 'nonsense' },
      ],
      makeId,
    )
    expect(out[0].transport).toBe('webcli')
    // 'direct' is the default, so it is absent rather than stored — a KB file
    // that says it and one that omits it must produce the same config.
    expect(out[1].transport).toBeUndefined()
    expect(out[2].transport).toBeUndefined()
  })
})

describe('mergeMcpConfigs', () => {
  it('KB entries win on duplicate targets; sources are tagged', () => {
    const merged = mergeMcpConfigs(
      [
        { id: 'g1', name: 'shared', url: 'https://same/mcp' },
        { id: 'g2', name: 'globalonly', url: 'https://g/mcp' },
      ],
      [{ id: 'k1', name: 'shared-kb', url: 'https://same/mcp' }],
    )
    expect(merged.map((s) => `${s.source}:${s.id}`)).toEqual(['kb:k1', 'global:g2'])
  })
})

describe('deferred loading', () => {
  it('defers only big-server tools that are not activated', () => {
    const none = new Set<string>()
    expect(isDeferredTool('mcp__wa__generic__click', 34, none)).toBe(true)
    expect(isDeferredTool('mcp__wa__generic__click', 34, new Set(['mcp__wa__generic__click']))).toBe(false)
    expect(isDeferredTool('mcp__small__add', 2, none)).toBe(false)
  })
  it('renders compact catalog lines', () => {
    expect(catalogEntry('mcp__x__y', 'short  desc')).toBe('- mcp__x__y: short desc')
    expect(catalogEntry('mcp__x__y', 'z'.repeat(100))).toContain('…')
  })
})

describe('recallTouch', () => {
  it('moves a used tool to the front without duplicating it', () => {
    expect(recallTouch(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
    expect(recallTouch(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('drops the least recently used past the cap', () => {
    const full = Array.from({ length: MAX_RECALLED_TOOLS }, (_, i) => `t${i}`)
    const next = recallTouch(full, 'new')
    expect(next).toHaveLength(MAX_RECALLED_TOOLS)
    expect(next[0]).toBe('new')
    expect(next).not.toContain(`t${MAX_RECALLED_TOOLS - 1}`) // the oldest fell off
  })

  it('never mutates the input', () => {
    const list = ['a', 'b']
    recallTouch(list, 'c')
    expect(list).toEqual(['a', 'b'])
  })
})

describe('isRecoverable', () => {
  it('accepts failures where the request never reached the server', () => {
    expect(isRecoverable(new Error('MCP server not connected: x'))).toBe(true)
    expect(isRecoverable(new Error('Extension connection closed'))).toBe(true)
    expect(isRecoverable(new Error('MCP tools/call HTTP 404: session expired'))).toBe(true)
  })

  it('refuses failures that may have already run the tool', () => {
    // A retry here could book the flight twice.
    expect(isRecoverable(new Error('MCP tools/call HTTP 500: boom'))).toBe(false)
    expect(isRecoverable(new Error('MCP tools/call timed out (600s)'))).toBe(false)
    expect(isRecoverable(new Error('Error: the page had no such element'))).toBe(false)
  })
})

describe('when a failed call may be sent again', () => {
  /**
   * The invariant both predicates serve: a retry is only allowed when the
   * request provably never ran, so it cannot execute a tool twice.
   */
  it('accepts a 401 — the server turned it away before dispatching anything', () => {
    expect(isAuthFailure('MCP tools/call HTTP 401: {"error":"invalid_token"}')).toBe(false)
    expect(isAuthFailure(new Error('MCP tools/call HTTP 401: {"error":"invalid_token"}'))).toBe(true)
    expect(isAuthFailure(new Error('{"error":"invalid_token"}'))).toBe(true)
  })

  it('refuses a 403 — refreshing changes nothing about being forbidden', () => {
    expect(isAuthFailure(new Error('MCP tools/call HTTP 403: forbidden'))).toBe(false)
  })

  it('does not mistake an unrelated 401 in the body for an auth failure', () => {
    // The status is what counts; 4011 is a different number.
    expect(isAuthFailure(new Error('MCP tools/call HTTP 500: upstream said 4011'))).toBe(false)
  })

  it('keeps the two remedies apart', () => {
    // An auth failure is not "reconnect and hope" — reconnecting with the same
    // rejected token earns a second 401, so it must not qualify here.
    expect(isRecoverable(new Error('MCP tools/call HTTP 401: invalid_token'))).toBe(false)
    expect(isAuthFailure(new Error('connection closed'))).toBe(false)
  })
})
