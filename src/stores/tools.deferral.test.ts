import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Deferral is orthogonal to the gate (asserted in licence.test.ts); enforced
// here it would empty the licensed specs and test nothing.
// The gate is mocked open, not switched off through the licence it happens to
// be backed by: `@/edition/gate` is what the code under test imports, so this
// says the same thing in an edition that has no licence module at all.
vi.mock('@/edition/gate', async () => {
  const { computed } = await import('vue')
  return {
    restricted: computed(() => false),
    toolRestricted: () => false,
    restrictedToolResult: (name: string) => `Error: ${name} is restricted.`,
  }
})

// Mutating settings.state fires its persist watch, and the recall/trust reads
// go to storage too — node has none (same shim as manageTools.test.ts).
globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
} as unknown as Storage

import { useToolsStore } from './tools'
import { useSettingsStore } from './settings'
import type { HttpToolSpec } from '@/lib/httpTools'

/** A minimal installed tool; `bundle` groups it like an MCP server groups tools. */
function tool(name: string, bundle?: string): HttpToolSpec {
  return {
    id: `id-${name}`,
    name,
    description: `the ${name} tool`,
    params: {},
    request: { method: 'GET', url: 'https://example.test/api' },
    response: { kind: 'json' },
    ...(bundle ? { bundle } : {}),
  } as unknown as HttpToolSpec
}

/** `n` tools sharing one bundle, named <bundle>_0.. — the big-server analog. */
function bundleOf(bundle: string, n: number): HttpToolSpec[] {
  return Array.from({ length: n }, (_, i) => tool(`${bundle}_${i}`, bundle))
}

/** Any size — the policy no longer reads group size at all. */
const BIG = 9

function storeWith(specs: HttpToolSpec[]) {
  const settings = useSettingsStore()
  settings.state.httpTools = specs
  return useToolsStore()
}

describe('tools store — deferral of installed bundles', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('defers everything installed — bundles and singletons alike — and pins the bundled pack', () => {
    // An installed tool is an opt-in extension whatever its group size; only
    // the product's baseline reach (the catalog's web pack) rides always.
    const store = storeWith([...bundleOf('big', BIG), ...bundleOf('duo', 2), tool('lone')])
    const active = store.activeSpecsFor('s1').map((s) => s.name)
    expect(active).toEqual(['web_fetch', 'web_search'])
    expect(store.deferredSpecsFor('s1')).toHaveLength(BIG + 3)
  })

  it('activates by exact name, per session', () => {
    const store = storeWith(bundleOf('big', BIG))
    expect(store.activate('s1', ['big_3', 'nope'])).toEqual(['big_3'])
    const fromBig = (id: string): string[] =>
      store.activeSpecsFor(id).map((s) => s.name).filter((n) => n.startsWith('big_'))
    expect(fromBig('s1')).toEqual(['big_3'])
    // the other session saw nothing happen
    expect(fromBig('s2')).toEqual([])
  })

  it('keeps the prompt catalog frozen across activation', () => {
    // The catalog is prompt bytes: activation must change which SCHEMAS are
    // sent, never the catalog text, or the cache prefix moves mid-session.
    const store = storeWith(bundleOf('big', BIG))
    const before = store.deferredCatalog.map((s) => s.name)
    store.activate('s1', ['big_0'])
    expect(store.deferredCatalog.map((s) => s.name)).toEqual(before)
  })

  it('remembers only deferred tools and preactivates a fresh session with them', () => {
    const store = storeWith([...bundleOf('big', BIG), tool('lone')])
    store.rememberUse('big_2')
    store.rememberUse('web_search') // pinned active — a slot here would be wasted
    store.rememberUse('ghost') // unknown
    store.preactivate('s-new')
    const fromBig = store
      .activeSpecsFor('s-new')
      .map((s) => s.name)
      .filter((n) => n.startsWith('big_'))
    expect(fromBig).toEqual(['big_2'])
  })
})
