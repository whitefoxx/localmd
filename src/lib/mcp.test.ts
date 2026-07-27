import { describe, it, expect, afterEach } from 'vitest'
import {
  McpExtensionClient,
  isRecoverable,
  sanitizeServerName,
  externalToolName,
  parseExternalToolName,
  parseSseResponse,
  flattenToolResult,
  isExtensionId,
  normalizeMcpServerList,
  mergeMcpConfigs,
  isDeferredTool,
  catalogEntry,
  recallTouch,
  MAX_RECALLED_TOOLS,
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

describe('isExtensionId', () => {
  it('matches 32-char a-p Chrome extension IDs', () => {
    expect(isExtensionId('lggfijacmifhgidnjeicdffpgkjhpnla')).toBe(true)
    expect(isExtensionId(' lggfijacmifhgidnjeicdffpgkjhpnla ')).toBe(true)
  })
  it('rejects URLs and malformed ids', () => {
    expect(isExtensionId('http://localhost:8901/mcp')).toBe(false)
    expect(isExtensionId('lggfijacmifhgidnjeicdffpgkjhpnl')).toBe(false) // 31 chars
    expect(isExtensionId('zggfijacmifhgidnjeicdffpgkjhpnla')).toBe(false) // z not in a-p
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
  it('never defers web_task', () => {
    expect(isDeferredTool('mcp__wa__web_task', 34, new Set())).toBe(false)
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

/* ── extension transport ─────────────────────────────────────────────────── */

/** A chrome.runtime stand-in: every request gets an empty result back, and the
 *  test can drop the port the way a reloading extension does. */
function fakeChrome() {
  const sent: Array<{ method: string; id?: number }> = []
  let drop = () => {}
  let connects = 0
  const runtime = {
    connect() {
      connects++
      let onMessage: (m: unknown) => void = () => {}
      const port = {
        postMessage(msg: unknown) {
          const m = msg as { id?: number; method: string }
          sent.push({ method: m.method, id: m.id })
          if (m.id !== undefined) {
            const result = m.method === 'tools/list' ? { tools: [] } : {}
            queueMicrotask(() => onMessage({ jsonrpc: '2.0', id: m.id, result }))
          }
        },
        disconnect() {
          drop()
        },
        onMessage: { addListener: (cb: (m: unknown) => void) => (onMessage = cb) },
        onDisconnect: { addListener: (cb: () => void) => (drop = cb) },
      }
      return port
    },
  }
  return {
    runtime,
    sent,
    get connects() {
      return connects
    },
    /** What a reloaded extension does to the page's port. */
    dropPort: () => drop(),
  }
}

const EXT_CFG = { id: 's1', name: 'webcli', url: 'a'.repeat(32), enabled: true }

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
})

describe('McpExtensionClient', () => {
  it('re-handshakes on a port the extension replaced under us', async () => {
    const chrome = fakeChrome()
    ;(globalThis as { chrome?: unknown }).chrome = chrome
    const client = new McpExtensionClient(EXT_CFG)
    await client.connect()
    expect(chrome.sent.map((s) => s.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ])

    chrome.dropPort() // extension reloaded
    chrome.sent.length = 0
    await client.callTool('do_thing', {})

    // The fresh port is introduced to before it is used — sending tools/call
    // straight down an un-initialized port is what used to break after a reload.
    expect(chrome.sent[0].method).toBe('initialize')
    expect(chrome.sent.map((s) => s.method)).toContain('tools/call')
    expect(chrome.connects).toBe(2)
  })

  it('reports a drop that killed work in flight', async () => {
    const chrome = fakeChrome()
    ;(globalThis as { chrome?: unknown }).chrome = chrome
    const client = new McpExtensionClient(EXT_CFG)
    const lost: string[] = []
    client.onLost = (reason) => lost.push(reason)
    // Dropped mid-handshake: the in-flight rpc rejects, which is the point.
    const connecting = client.connect().catch(() => {})

    chrome.dropPort()
    await connecting
    expect(lost).toHaveLength(1)
    expect(lost[0]).toMatch(/closed/i)
  })

  it('says nothing when an idle port closes — dormant is not broken', async () => {
    const chrome = fakeChrome()
    ;(globalThis as { chrome?: unknown }).chrome = chrome
    const client = new McpExtensionClient(EXT_CFG)
    await client.connect()
    const lost: string[] = []
    client.onLost = (reason) => lost.push(reason)

    chrome.dropPort() // extension service worker went to sleep
    expect(lost).toEqual([])

    // …and the connection is still usable: it simply re-introduces itself.
    chrome.sent.length = 0
    await client.callTool('do_thing', {})
    expect(chrome.sent[0].method).toBe('initialize')
  })

  it('stays quiet when WE are the one closing the port', async () => {
    const chrome = fakeChrome()
    ;(globalThis as { chrome?: unknown }).chrome = chrome
    const client = new McpExtensionClient(EXT_CFG)
    const lost: string[] = []
    client.onLost = (reason) => lost.push(reason)
    await client.connect()

    client.dispose()
    expect(lost).toEqual([])
  })
})
