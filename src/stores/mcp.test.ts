import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMcpStore } from './mcp'
import { MAX_RECALLED_TOOLS } from '@/lib/mcp'
import type { McpServerState } from './mcp'

/** A connected server exposing `n` tools named tool0..tool(n-1), plus the
 *  never-deferred `web_task` when asked. */
function server(id: string, n: number, withWebTask = false): McpServerState {
  const names = [...Array.from({ length: n }, (_, i) => `tool${i}`), ...(withWebTask ? ['web_task'] : [])]
  return {
    config: { id, name: id, url: `https://${id}/mcp` },
    source: 'global',
    status: 'ok',
    tools: names.map((name) => ({
      name,
      description: `the ${name} tool`,
      inputSchema: { type: 'object' as const },
    })),
  }
}

/** The store's constructor kicks off an async refresh() that resets `servers`;
 *  let it settle before planting the fixture. */
async function storeWith(...states: McpServerState[]) {
  const mcp = useMcpStore()
  await Promise.resolve()
  await Promise.resolve()
  mcp.servers = states
  return mcp
}

describe('mcp store — recall of deferred tools', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('remembers a used tool from a big (deferred) server', async () => {
    const mcp = await storeWith(server('big', 20))
    mcp.rememberUse('mcp__big__tool3')
    expect(mcp.recalled).toEqual(['mcp__big__tool3'])
  })

  it('ignores tools that are never deferred — they cost nothing to keep', async () => {
    const mcp = await storeWith(server('small', 3), server('big', 20, true))
    mcp.rememberUse('mcp__small__tool1') // small server: always in the request
    mcp.rememberUse('mcp__big__web_task') // web_task never defers
    mcp.rememberUse('mcp__big__nosuchtool') // unknown tool
    expect(mcp.recalled).toEqual([])
  })

  it('caps the list, dropping the least recently used', async () => {
    const mcp = await storeWith(server('big', 40))
    for (let i = 0; i <= MAX_RECALLED_TOOLS; i++) mcp.rememberUse(`mcp__big__tool${i}`)
    expect(mcp.recalled).toHaveLength(MAX_RECALLED_TOOLS)
    expect(mcp.recalled[0]).toBe(`mcp__big__tool${MAX_RECALLED_TOOLS}`)
    expect(mcp.recalled).not.toContain('mcp__big__tool0')
  })

  it('preactivates a session with the recalled tools, so they ship from request one', async () => {
    const mcp = await storeWith(server('big', 20))
    mcp.rememberUse('mcp__big__tool3')

    expect(mcp.activeToolsFor('s1').map((t) => t.qualifiedName)).toEqual([])
    mcp.preactivate('s1')
    expect(mcp.activeToolsFor('s1').map((t) => t.qualifiedName)).toEqual(['mcp__big__tool3'])
    // Other sessions are untouched — activation stays per session.
    expect(mcp.activeToolsFor('s2')).toEqual([])
  })

  it('skips recalled tools whose server is gone', async () => {
    const mcp = await storeWith(server('big', 20))
    mcp.rememberUse('mcp__big__tool3')
    mcp.servers = [] // server disconnected / removed from config
    mcp.preactivate('s1')
    expect(mcp.activeToolsFor('s1')).toEqual([])
  })

  it('leaves the frozen catalog alone — the system prompt must not move', async () => {
    const mcp = await storeWith(server('big', 20))
    const before = mcp.deferredCatalog.map((t) => t.qualifiedName)
    mcp.rememberUse('mcp__big__tool3')
    mcp.preactivate('s1')
    expect(mcp.deferredCatalog.map((t) => t.qualifiedName)).toEqual(before)
  })
})
