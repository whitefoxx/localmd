/**
 * The confirm contract for localmd Connect's write surface: a write-flagged
 * eval_js snippet, a write-flagged interaction the extension refused (a click on
 * a write control, a Cmd/Ctrl+Enter submit), and a code-injecting site script
 * must not reach the extension without the user's approval recorded. A read (an
 * eval_js with no allow_write, or any read-side tool) passes untouched.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSetupStore } from '@/stores/setup'
import {
  siteScriptGate,
  confirmConnectCall,
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
    ...over,
  }
}

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
  it('reads the control label off a write_blocked result', () => {
    expect(parseWriteBlockedControl(JSON.stringify({ write_blocked: true, control: 'Post' }))).toBe('Post')
  })

  it('returns null for an ordinary result or non-JSON', () => {
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
      'generic__list_site_scripts',
      'generic__preview_site_script',
      'generic__find_in_dom',
      'generic__fetch_url',
      // click is gated result-side by the seam, not here — confirmConnectCall
      // lets it straight through.
      'generic__click',
    ]) {
      expect(await confirmConnectCall(ctx({ tool }))).toBeNull()
    }
    expect(useSetupStore().pending).toHaveLength(0)
  })
})
