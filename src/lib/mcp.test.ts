import { describe, it, expect } from 'vitest'
import {
  sanitizeServerName,
  externalToolName,
  parseExternalToolName,
  parseSseResponse,
  flattenToolResult,
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
    expect(out).toBe('hello\n[图片 image/png]\nembedded')
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
