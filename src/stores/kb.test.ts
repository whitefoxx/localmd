import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

/**
 * Which knowledge base is open is the store's answer, not the address bar's.
 *
 * `?demo` is a door — what a link hands someone. Reading it as a state meant
 * that opening your own folder from inside the demo left every demo
 * affordance on screen, and that a reload re-seeded the demo over the folder
 * you had just chosen, because the bootstrap runs off the same parameter.
 */
vi.mock('@/lib/fs', () => ({
  ensurePermission: () => Promise.resolve(true),
  setRoot: () => {},
  queryPermission: () => Promise.resolve('granted'),
}))
vi.mock('@/lib/idb', () => ({
  saveRecent: () => Promise.resolve(),
  listRecents: () => Promise.resolve([]),
  removeRecent: () => Promise.resolve(),
}))
vi.mock('@/lib/viewMemory', () => ({ hydrateReadingPositions: () => {} }))

const handle = { name: 'notes' } as unknown as FileSystemDirectoryHandle

/** A lock manager with the property that matters here: the release happens
 *  after the callback's promise settles, not when release() is called. */
function fakeLocks(): { request: (name: string, opts: unknown, cb: (l: unknown) => unknown) => Promise<void> } {
  const held = new Set<string>()
  return {
    async request(name, _opts, cb) {
      if (held.has(name)) {
        await cb(null)
        return
      }
      held.add(name)
      try {
        await cb({ name })
      } finally {
        held.delete(name)
      }
    },
  }
}

describe('demo is a property of the open KB', () => {
  let href: string

  beforeEach(async () => {
    setActivePinia(createPinia())
    href = 'https://localmd.app/?demo=1'
    vi.stubGlobal('location', { get href() { return href }, get search() { return new URL(href).search } })
    vi.stubGlobal('history', {
      replaceState: (_s: unknown, _t: string, url: string) => (href = String(url)),
    })
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('marks the demo only when the demo bootstrap says so', async () => {
    const { useKbStore } = await import('./kb')
    const kb = useKbStore()
    expect(kb.isDemo).toBe(false)
    await kb.openHandle(handle, { ephemeral: true, demo: true })
    expect(kb.isDemo).toBe(true)
  })

  it('opening a real folder clears the demo, and the address stops saying it', async () => {
    const { useKbStore } = await import('./kb')
    const kb = useKbStore()
    await kb.openHandle(handle, { ephemeral: true, demo: true })
    expect(new URL(href).searchParams.has('demo')).toBe(true)

    await kb.openHandle(handle)
    expect(kb.isDemo).toBe(false)
    // …or the next reload seeds the demo over the folder just chosen.
    expect(new URL(href).searchParams.has('demo')).toBe(false)
  })

  it('closing the KB is not the demo either', async () => {
    const { useKbStore } = await import('./kb')
    const kb = useKbStore()
    await kb.openHandle(handle, { ephemeral: true, demo: true })
    kb.close()
    expect(kb.isDemo).toBe(false)
  })

  it('does not mistake this tab for another one after a trip through the demo', async () => {
    vi.stubGlobal('navigator', { locks: fakeLocks() })
    const { useKbStore } = await import('./kb')
    const kb = useKbStore()

    await kb.openHandle(handle) // a real folder: takes the lock
    expect(kb.lockedByOther).toBe(false)

    // The demo takes no lock of its own — and must let go of this one.
    await kb.openHandle({ name: 'localmd-demo' } as unknown as FileSystemDirectoryHandle, {
      ephemeral: true,
      demo: true,
    })
    expect(kb.lockedByOther).toBe(false)

    // Back to the folder. Asking for a lock whose release is still in flight is
    // how the warning used to fire against this very tab.
    await kb.openHandle(handle)
    expect(kb.lockedByOther).toBe(false)
  })
})
