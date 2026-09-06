/**
 * The confirm contract for localmd Connect's write surface: a write-flagged
 * eval_js snippet, a write-access run_adapter (legacy, until the tool retires),
 * and a code-injecting site script must not reach the extension without the
 * user's approval recorded. A read (an eval_js with no allow_write, a read
 * adapter, or any read-side tool) passes untouched. An adapter whose access
 * cannot be determined is treated as write (fail closed).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSetupStore } from '@/stores/setup'
import {
  parseAdapterRows,
  siteScriptGate,
  noteConnectResult,
  confirmConnectCall,
  clearAdapterAccessCache,
  parseWriteBlockedControl,
  confirmWriteResult,
  type ConnectCallContext,
} from './connectGuard'

globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
} as unknown as Storage

beforeEach(() => {
  setActivePinia(createPinia())
  clearAdapterAccessCache()
})

/** Wait for the confirm card, then act on it as the user would. */
async function onCard(outcome: 'confirmed' | 'skipped'): Promise<void> {
  const setup = useSetupStore()
  for (let i = 0; i < 100 && !setup.pendingFor('s1'); i++) {
    await new Promise((r) => setTimeout(r, 0))
  }
  const req = setup.pendingFor('s1')
  if (req) setup.settle(req.id, outcome)
}

function ctx(over: Partial<ConnectCallContext> = {}): ConnectCallContext {
  return {
    sessionId: 's1',
    serverId: 'srv',
    tool: 'generic__eval_js',
    args: {},
    callTool: async () => {
      throw new Error('unexpected lookup')
    },
    ...over,
  }
}

const ROWS = JSON.stringify([
  { site: 'hackernews', name: 'top', access: 'read', type: 'pipeline', status: 'ok' },
  { site: 'twitter', name: 'post', access: 'write', type: 'func', status: 'ok' },
])

describe('parseAdapterRows', () => {
  it('reads a bare array of rows', () => {
    expect(parseAdapterRows(ROWS)).toEqual([
      { site: 'hackernews', name: 'top', access: 'read' },
      { site: 'twitter', name: 'post', access: 'write' },
    ])
  })

  it('finds rows nested under any key', () => {
    expect(parseAdapterRows(JSON.stringify({ adapters: [{ site: 'x', name: 'y', access: 'read' }] }))).toEqual([
      { site: 'x', name: 'y', access: 'read' },
    ])
  })

  it('yields nothing for prose or an error line', () => {
    expect(parseAdapterRows('no adapters found')).toEqual([])
  })

  it('drops rows whose access is not read/write', () => {
    expect(parseAdapterRows(JSON.stringify([{ site: 'x', name: 'y', access: 'admin' }]))).toEqual([])
  })
})

describe('siteScriptGate', () => {
  it('treats css or js as code, and shows the exact code', () => {
    const gate = siteScriptGate({
      matches: ['https://x.com/*'],
      css: '.ad { display: none }',
      js: 'console.log(1)',
    })
    expect(gate.level).toBe('code')
    expect(gate.detail).toContain('matches: https://x.com/*')
    expect(gate.detail).toContain('.ad { display: none }')
    expect(gate.detail).toContain('console.log(1)')
  })

  it('treats hide-only as the lighter level, selectors shown', () => {
    const gate = siteScriptGate({ matches: ['https://x.com/*'], hide_selectors: ['.ad', '.promo'] })
    expect(gate.level).toBe('hide')
    expect(gate.detail).toContain('.ad, .promo')
  })

  it('does not mistake a blank css string for code', () => {
    expect(siteScriptGate({ matches: 'https://x.com/*', css: '  ', hide_selectors: ['.a'] }).level).toBe('hide')
  })
})

describe('confirmConnectCall — eval_js write', () => {
  it('lets a read eval_js (no allow_write) through without a card', async () => {
    const result = await confirmConnectCall(ctx({ args: { code: 'return document.title' } }))
    expect(result).toBeNull()
    expect(useSetupStore().pending).toHaveLength(0)
  })

  it('confirms a write-flagged eval_js, and proceeds on approval', async () => {
    const run = confirmConnectCall(
      ctx({ args: { code: "fetch('/api/post', {method:'POST'})", allow_write: true } }),
    )
    await onCard('confirmed')
    expect(await run).toBeNull()
  })

  it('shows the exact code on the write card', async () => {
    const run = confirmConnectCall(ctx({ args: { code: 'doThePost()', allow_write: true } }))
    const setup = useSetupStore()
    for (let i = 0; i < 100 && !setup.pendingFor('s1'); i++) {
      await new Promise((r) => setTimeout(r, 0))
    }
    const card = setup.pendingFor('s1')
    expect(card?.kind).toBe('confirm')
    expect(card?.detail).toContain('doThePost()')
    setup.settle(card!.id, 'confirmed')
    expect(await run).toBeNull()
  })

  it('reports a decline instead of running, without an Error prefix', async () => {
    const run = confirmConnectCall(ctx({ args: { code: 'doThePost()', allow_write: true } }))
    await onCard('skipped')
    const out = await run
    expect(out).toMatch(/declined/)
    expect(out).toMatch(/Do not retry/)
    expect(out?.startsWith('Error')).toBe(false)
  })
})

describe('parseWriteBlockedControl', () => {
  it('reads the control label off a write_blocked click result', () => {
    expect(parseWriteBlockedControl(JSON.stringify({ write_blocked: true, control: 'Post' }))).toBe('Post')
  })

  it('returns null for an ordinary click result or non-JSON', () => {
    expect(parseWriteBlockedControl(JSON.stringify({ found: true, tag: 'button' }))).toBeNull()
    expect(parseWriteBlockedControl('clicked')).toBeNull()
  })

  it('falls back to a generic label when the control text is missing', () => {
    expect(parseWriteBlockedControl(JSON.stringify({ write_blocked: true }))).toBe('the control')
  })
})

describe('confirmWriteResult — seam-driven card with the extension label', () => {
  it('shows the resolved control label (not the opaque ref) and proceeds on approval', async () => {
    const run = confirmWriteResult('s1', 'Post')
    const setup = useSetupStore()
    for (let i = 0; i < 100 && !setup.pendingFor('s1'); i++) {
      await new Promise((r) => setTimeout(r, 0))
    }
    const card = setup.pendingFor('s1')
    expect(card?.detail).toContain('Post')
    setup.settle(card!.id, 'confirmed')
    expect(await run).toBeNull()
  })

  it('shows a press_key submit combo the same way', async () => {
    const run = confirmWriteResult('s1', 'Meta+Enter (submit)')
    const setup = useSetupStore()
    for (let i = 0; i < 100 && !setup.pendingFor('s1'); i++) {
      await new Promise((r) => setTimeout(r, 0))
    }
    const card = setup.pendingFor('s1')
    expect(card?.detail).toContain('Meta+Enter')
    setup.settle(card!.id, 'confirmed')
    expect(await run).toBeNull()
  })

  it('reports a decline instead of acting', async () => {
    const run = confirmWriteResult('s1', 'Delete')
    await onCard('skipped')
    expect(await run).toMatch(/declined/)
  })
})

describe('confirmConnectCall — run_adapter (legacy)', () => {
  it('lets a known read adapter through without a card', async () => {
    noteConnectResult('srv', 'generic__find_adapters', ROWS)
    const result = await confirmConnectCall(
      ctx({ tool: 'generic__run_adapter', args: { site: 'hackernews', name: 'top' } }),
    )
    expect(result).toBeNull()
    expect(useSetupStore().pending).toHaveLength(0)
  })

  it('confirms a known write adapter, and proceeds on approval', async () => {
    noteConnectResult('srv', 'generic__find_adapters', ROWS)
    const run = confirmConnectCall(
      ctx({ tool: 'generic__run_adapter', args: { site: 'twitter', name: 'post', args: { text: 'hi' } } }),
    )
    await onCard('confirmed')
    expect(await run).toBeNull()
  })

  it('reports a decline instead of running, without an Error prefix', async () => {
    noteConnectResult('srv', 'generic__find_adapters', ROWS)
    const run = confirmConnectCall(ctx({ tool: 'generic__run_adapter', args: { site: 'twitter', name: 'post' } }))
    await onCard('skipped')
    const out = await run
    expect(out).toMatch(/declined/)
    expect(out).toMatch(/Do not retry/)
    expect(out?.startsWith('Error')).toBe(false)
  })

  it('looks the adapter up itself when the cache has nothing', async () => {
    const queries: unknown[] = []
    const result = await confirmConnectCall(
      ctx({
        tool: 'generic__run_adapter',
        args: { site: 'hackernews', name: 'top' },
        callTool: async (tool, args) => {
          queries.push([tool, args])
          return ROWS
        },
      }),
    )
    expect(queries).toEqual([['generic__find_adapters', { query: 'hackernews' }]])
    expect(result).toBeNull()
  })

  it('fails closed: unknown access confirms as a write', async () => {
    const run = confirmConnectCall(
      ctx({
        tool: 'generic__run_adapter',
        args: { site: 'mystery', name: 'run' },
        callTool: async () => 'no such site',
      }),
    )
    await onCard('skipped')
    expect(await run).toMatch(/declined/)
  })

  it('scopes learned access to the server it came from', async () => {
    noteConnectResult('other-server', 'generic__find_adapters', ROWS)
    const run = confirmConnectCall(
      ctx({
        tool: 'generic__run_adapter',
        args: { site: 'hackernews', name: 'top' },
        callTool: async () => 'not json',
      }),
    )
    await onCard('skipped')
    // Nothing vouched for this server's adapter, so it confirmed.
    expect(await run).toMatch(/declined/)
  })

  it('ignores results from tools other than find_adapters', () => {
    noteConnectResult('srv', 'generic__run_adapter', ROWS)
    // Nothing cached: a later run_adapter for these would still look up/confirm.
    const setup = useSetupStore()
    expect(setup.pending).toHaveLength(0)
  })
})

describe('confirmConnectCall — create_site_script', () => {
  it('shows the exact code on the card and proceeds on approval', async () => {
    const run = confirmConnectCall(
      ctx({
        tool: 'generic__create_site_script',
        args: { matches: ['https://news.ycombinator.com/*'], js: 'alert(1)' },
      }),
    )
    const setup = useSetupStore()
    for (let i = 0; i < 100 && !setup.pendingFor('s1'); i++) {
      await new Promise((r) => setTimeout(r, 0))
    }
    const card = setup.pendingFor('s1')
    expect(card?.kind).toBe('confirm')
    expect(card?.detail).toContain('alert(1)')
    expect(card?.detail).toContain('https://news.ycombinator.com/*')
    setup.settle(card!.id, 'confirmed')
    expect(await run).toBeNull()
  })

  it('confirms hide-only scripts too (lighter, but still a card)', async () => {
    const run = confirmConnectCall(
      ctx({
        tool: 'generic__create_site_script',
        args: { matches: ['https://x.com/*'], hide_selectors: ['.ad'] },
      }),
    )
    await onCard('skipped')
    expect(await run).toMatch(/declined/)
  })

  it('never gates the read-side tools', async () => {
    for (const tool of [
      'generic__find_adapters',
      'generic__list_site_scripts',
      'generic__preview_site_script',
      'generic__find_in_dom',
      'generic__fetch_url',
      // click is gated result-side by the seam, not here — confirmConnectCall
      // lets it (and even a click carrying allow_write) straight through.
      'generic__click',
    ]) {
      expect(await confirmConnectCall(ctx({ tool }))).toBeNull()
    }
    expect(useSetupStore().pending).toHaveLength(0)
  })
})
