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

interface FakeOpts {
  ifAvailable?: boolean
  signal?: AbortSignal
}

/** A lock manager with the two properties that matter here: the release happens
 *  after the callback's promise settles, not when release() is called; and a
 *  request without `ifAvailable` QUEUES for a lock somebody else holds rather
 *  than being turned away — which is the whole difference between "busy for a
 *  moment while a tab reloads" and "another tab has it". */
function fakeLocks(): {
  request: (name: string, opts: FakeOpts, cb: (l: unknown) => unknown) => Promise<void>
  query: () => Promise<{ held: { name: string }[]; pending: { name: string }[] }>
  /** Take a lock from outside the store, as a second tab would. */
  grab: (name: string) => () => void
  /** Drop a lock without waking anyone queued for it — a wake-up that never
   *  arrives is exactly the state the bar must not be trusted in. */
  vanish: (name: string) => void
} {
  const held = new Set<string>()
  const queues = new Map<string, (() => void)[]>()

  function release(name: string): void {
    held.delete(name)
    queues.get(name)?.shift()?.()
  }

  async function run(name: string, cb: (l: unknown) => unknown): Promise<void> {
    held.add(name)
    try {
      await cb({ name })
    } finally {
      release(name)
    }
  }

  return {
    async request(name, opts, cb) {
      if (!held.has(name)) return run(name, cb)
      if (opts?.ifAvailable) {
        await cb(null)
        return
      }
      await new Promise<void>((turn) => {
        const queue = queues.get(name) ?? []
        queues.set(name, queue)
        queue.push(turn)
        opts?.signal?.addEventListener('abort', () => {
          queues.set(
            name,
            (queues.get(name) ?? []).filter((t) => t !== turn),
          )
          turn()
        })
      })
      if (opts?.signal?.aborted) {
        await cb(null)
        return
      }
      return run(name, cb)
    },
    async query() {
      return {
        held: [...held].map((name) => ({ name })),
        pending: [...queues].flatMap(([name, q]) => q.map(() => ({ name }))),
      }
    },
    grab(name) {
      held.add(name)
      return () => release(name)
    },
    vanish(name) {
      held.delete(name)
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

  it('waits out a lock still held by the page it is replacing', async () => {
    // A reload: the outgoing document has not let go yet when the incoming one
    // asks. One miss is not another tab — the warning waits, and never comes.
    vi.useFakeTimers()
    const locks = fakeLocks()
    vi.stubGlobal('navigator', { locks })
    const letGo = locks.grab('localmd:kb:notes')

    const { useKbStore } = await import('./kb')
    const kb = useKbStore()
    await kb.openHandle(handle)
    expect(kb.lockedByOther).toBe(false) // nothing said yet

    letGo() // the old page finishes going away
    await vi.advanceTimersByTimeAsync(1000)
    expect(kb.lockedByOther).toBe(false)
    vi.useRealTimers()
  })

  it('does say so when the lock stays with somebody else', async () => {
    vi.useFakeTimers()
    const locks = fakeLocks()
    vi.stubGlobal('navigator', { locks })
    const letGo = locks.grab('localmd:kb:notes')

    const { useKbStore } = await import('./kb')
    const kb = useKbStore()
    await kb.openHandle(handle)

    await vi.advanceTimersByTimeAsync(1000)
    expect(kb.lockedByOther).toBe(true)

    // …and takes it back the moment that tab goes away.
    letGo()
    await vi.advanceTimersByTimeAsync(0)
    expect(kb.lockedByOther).toBe(false)
    vi.useRealTimers()
  })

  it('takes the bar down on the way back in when nobody holds the folder', async () => {
    // The queued request normally clears this by itself. When that wake-up
    // never arrives, coming back to the tab is the moment the bar is read —
    // and the moment it has to be true.
    vi.useFakeTimers()
    const locks = fakeLocks()
    vi.stubGlobal('navigator', { locks })
    locks.grab('localmd:kb:notes')

    const { useKbStore } = await import('./kb')
    const kb = useKbStore()
    await kb.openHandle(handle)
    await vi.advanceTimersByTimeAsync(1000)
    expect(kb.lockedByOther).toBe(true)

    await kb.recheckOtherTab()
    expect(kb.lockedByOther).toBe(true) // still held: the bar is right

    locks.vanish('localmd:kb:notes') // that tab went away, silently
    await kb.recheckOtherTab()
    expect(kb.lockedByOther).toBe(false)
    vi.useRealTimers()
  })

  it('leaves the bar alone when it cannot find out', async () => {
    vi.useFakeTimers()
    const locks = fakeLocks()
    vi.stubGlobal('navigator', {
      locks: { ...locks, query: () => Promise.reject(new Error('nope')) },
    })
    locks.grab('localmd:kb:notes')

    const { useKbStore } = await import('./kb')
    const kb = useKbStore()
    await kb.openHandle(handle)
    await vi.advanceTimersByTimeAsync(1000)
    expect(kb.lockedByOther).toBe(true)

    await kb.recheckOtherTab()
    expect(kb.lockedByOther).toBe(true) // not knowing is not "nobody is there"
    vi.useRealTimers()
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
