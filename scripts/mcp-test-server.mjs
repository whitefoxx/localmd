/**
 * Minimal Streamable-HTTP MCP server for local e2e testing:
 *   node scripts/mcp-test-server.mjs   →  http://localhost:8901/mcp
 * Tools: add(a,b) and echo(text). CORS is wide open (test only).
 */
import http from 'node:http'

const TOOLS = [
  {
    name: 'add',
    description: 'Add two numbers and return the sum',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
  {
    name: 'echo',
    description: 'Echo the given text back',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
]

function handle(msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-test', version: '1.0.0' },
      },
    }
  }
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
  if (method === 'tools/call') {
    const { name, arguments: args } = params
    if (name === 'add') {
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: String(args.a + args.b) }] },
      }
    }
    if (name === 'echo') {
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: args.text }] } }
    }
    return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool ${name}` } }
  }
  if (String(method).startsWith('notifications/')) return null // 202, no body
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${method}` } }
}

http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'content-type, authorization, mcp-session-id, mcp-protocol-version, accept',
    )
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    if (req.url !== '/mcp' || req.method !== 'POST') return res.writeHead(404).end()
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        const reply = handle(JSON.parse(body))
        if (!reply) return res.writeHead(202).end()
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'test-session' })
        res.end(JSON.stringify(reply))
      } catch (e) {
        res.writeHead(400).end(String(e))
      }
    })
  })
  .listen(8901, () => console.log('mcp-test-server on http://localhost:8901/mcp'))
