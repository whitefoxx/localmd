import { describe, it, expect } from 'vitest'
import {
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
