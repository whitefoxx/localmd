import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as fs from '@/lib/fs'
import { isE2eMode } from '@/lib/e2e'
import { saveRecent, listRecents, removeRecent, type RecentKb } from '@/lib/idb'
import { hydrateReadingPositions } from '@/lib/viewMemory'

/** Marks that this browser had a KB open when the page last went away. Only a
 *  hint — the handle itself lives in IndexedDB — but a synchronous one, which
 *  is the point: it is read before the first paint to decide whether the start
 *  screen may render at all (see `restoring`). */
const LAST_KB_KEY = 'browser-md:lastKb'

function readLastKb(): string | null {
  try {
    return localStorage.getItem(LAST_KB_KEY)
  } catch {
    return null // private mode / storage disabled — just never auto-restore
  }
}

function writeLastKb(value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(LAST_KB_KEY)
    else localStorage.setItem(LAST_KB_KEY, value)
  } catch {
    /* see above */
  }
}

/** The demo bootstraps its own in-memory KB from main.ts; restoring a folder
 *  underneath it would open two KBs in a race. Checked here rather than
 *  imported from lib/demo, which pulls memfs in with it. */
function isDemoUrl(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')
}

/**
 * Stop the address saying `demo` once a real folder is open.
 *
 * `?demo` is a door, not a state: it is what a link hands someone, and the app
 * used to keep reading it as "you are in the demo" for as long as it sat there.
 * Open your own folder from inside the demo and the badge, the "save this demo"
 * item and the demo notice all stayed — and worse, a reload re-seeded the demo
 * over the folder you had just chosen, because the bootstrap runs off the same
 * parameter. Which KB is open is the KB store's answer (see `isDemo`), and the
 * URL has to stop disagreeing with it.
 */
function dropDemoParam(): void {
  if (typeof location === 'undefined' || !isDemoUrl()) return
  const url = new URL(location.href)
  url.searchParams.delete('demo')
  history.replaceState(null, '', url)
}

export const useKbStore = defineStore('kb', () => {
  const name = ref<string | null>(null)
  const isOpen = ref(false)
  const recents = ref<RecentKb[]>([])
  /** False until the first read of the recents list has come back. An empty
   *  list and a list nobody has looked at yet are different things, and the
   *  start screen shows a different half of itself for each — without this it
   *  renders the first-visit copy for a frame and then yanks it away. */
  const recentsKnown = ref(false)
  /** True while the app is still deciding whether to reopen last session's
   *  folder, so the start screen can be held back until the answer is known —
   *  a returning user would otherwise get the landing page for a beat and then
   *  have it yanked away, the same flicker `recentsKnown` exists to prevent,
   *  one level up. Seeded from a synchronous localStorage read so that anyone
   *  with no folder to restore (a first visit, or a KB deliberately closed)
   *  pays nothing at all: for them this is false before the first paint and
   *  the landing renders exactly as it did. */
  const restoring = ref(!isE2eMode() && !isDemoUrl() && readLastKb() !== null)
  /** The open KB is THE demo — not merely memory-backed (E2E is that too), and
   *  not merely "the URL says so". Only the demo bootstrap sets it. */
  const isDemo = ref(false)
  const error = ref<string | null>(null)
  /** Another tab holds this KB open — concurrent writes would clobber each
   *  other (autosave, .git/index, sidecars). We warn rather than hard-block. */
  const lockedByOther = ref(false)

  let releaseLock: (() => void) | null = null
  /** Resolves once the browser has actually let go of the lock above. */
  let lockHeld: Promise<void> | null = null
  /** Cancels a still-pending wait for a lock somebody else is holding. */
  let waiting: AbortController | null = null
  /** How long a lock may stay taken before we believe it really is another tab.
   *  A reload's old document holds its locks for a few milliseconds after the
   *  new one starts asking; concluding from that first miss is how a single tab
   *  came to warn about itself on every refresh. */
  const OTHER_TAB_GRACE_MS = 500

  /**
   * Let go of the lock this tab holds — and wait for the browser to have let go.
   *
   * `releaseLock()` only settles the promise the lock is held on; the lock
   * manager releases afterwards, on its own turn. Asking for the same name in
   * the meantime gets "taken", which is how the app came to tell you that your
   * own tab was another tab: open a folder, go to the demo (which takes no lock
   * and so never released this one), come back, and the re-request raced its
   * own release.
   */
  async function releaseHeldLock(): Promise<void> {
    waiting?.abort()
    waiting = null
    releaseLock?.()
    releaseLock = null
    const done = lockHeld
    lockHeld = null
    if (done) await done
  }

  /** Keep the lock until someone calls `releaseLock`. */
  function holdLock(): Promise<void> {
    return new Promise<void>((release) => {
      releaseLock = release
    })
  }

  /**
   * Try to take the exclusive Web Lock for this KB; held until close().
   * Locks auto-release when the tab dies, so stale locks can't happen.
   *
   * Taking it is instant or it isn't ours, so the caller is not made to wait:
   * if the lock is busy we queue for it in the background and warn — but only
   * once it has stayed busy longer than a reload takes to let go, and we take
   * the warning back the moment the lock comes to us. The alternative, which
   * this replaces, was to conclude "another tab" from a single miss and never
   * look again: a warning that was wrong every time you pressed ⌘R, and stayed
   * wrong for as long as the folder was open.
   */
  async function acquireLock(kbName: string): Promise<void> {
    await releaseHeldLock()
    lockedByOther.value = false
    if (!('locks' in navigator)) return
    const key = `browser-md:kb:${kbName}`
    await new Promise<void>((ready) => {
      lockHeld = navigator.locks
        .request(key, { ifAvailable: true }, (lock) => {
          ready()
          return lock ? holdLock() : undefined
        })
        .then(
          () => undefined,
          () => undefined,
        )
    })
    if (releaseLock) return // it was free — this tab holds it

    const ctl = new AbortController()
    waiting = ctl
    const warn = setTimeout(() => {
      if (waiting === ctl) lockedByOther.value = true
    }, OTHER_TAB_GRACE_MS)
    lockHeld = navigator.locks
      .request(key, { signal: ctl.signal }, () => {
        clearTimeout(warn)
        if (ctl.signal.aborted) return
        waiting = null
        lockedByOther.value = false
        return holdLock()
      })
      .then(
        () => undefined,
        () => {
          clearTimeout(warn)
        },
      )
  }

  async function refreshRecents(): Promise<void> {
    try {
      recents.value = await listRecents()
    } catch {
      recents.value = []
    } finally {
      recentsKnown.value = true
    }
  }

  /**
   * Open a folder. `ephemeral` marks a memory-backed handle (the demo KB, E2E)
   * — one that exists only in this tab. Those skip both the recents list and
   * the lock, because neither means anything for them: the handle cannot be
   * reopened later, so a recents row would be a dead end, and there is no
   * shared folder on disk for a second tab to clobber, so a "another tab has
   * this open" warning would be alarming and false.
   */
  async function openHandle(
    handle: FileSystemDirectoryHandle,
    opts: { ephemeral?: boolean; demo?: boolean } = {},
  ): Promise<boolean> {
    error.value = null
    if (!(await fs.ensurePermission(handle))) {
      error.value = 'Permission to access the folder was declined.'
      return false
    }
    fs.setRoot(handle)
    name.value = handle.name
    isOpen.value = true
    isDemo.value = opts.demo === true
    if (!opts.demo) dropDemoParam()
    hydrateReadingPositions(handle.name)
    if (opts.ephemeral ?? isE2eMode()) {
      // A memory-backed KB takes no lock — and must not leave the folder we
      // just walked away from locked by this tab either.
      await releaseHeldLock()
      lockedByOther.value = false
      return true
    }
    await acquireLock(handle.name)
    writeLastKb(handle.name)
    await saveRecent(handle)
    await refreshRecents()
    return true
  }

  /**
   * Reopen the folder from last time, if the browser still remembers saying
   * yes. A page reload — a new build, a crash, a discarded tab, plain ⌘R —
   * should land the user back where they were rather than on the start screen;
   * the handle has been persisted for exactly this since the recents list
   * existed, and nothing ever picked it up.
   *
   * Reads `recents`, so the list has to have been loaded first (App.vue's
   * boot does that). Decides on its own terms rather than on `restoring` —
   * that flag is only about what may be painted, and a restore that arrives
   * late should still arrive.
   *
   * Silent or nothing: `requestPermission` needs a user gesture and a page
   * load is not one, so a folder whose permission has lapsed is left to the
   * recents list on the start screen, where a click is a gesture. Chrome only
   * keeps the grant across loads when the user chose "allow on every visit",
   * so for many people this correctly does nothing.
   */
  async function restoreLast(): Promise<boolean> {
    try {
      if (isE2eMode() || isDemoUrl()) return false
      const want = readLastKb()
      if (!want) return false
      const last = recents.value.find((r) => r.name === want)
      if (!last) return false
      if ((await fs.queryPermission(last.handle)) !== 'granted') return false
      return await openHandle(last.handle)
    } catch {
      // Folder moved, deleted, or the handle no longer resolves. Nothing to
      // say: the start screen is about to render and the entry is on it.
      return false
    } finally {
      restoring.value = false
    }
  }

  /** Open via the native directory picker (requires a user gesture). */
  async function pickAndOpen(): Promise<boolean> {
    const handle = await fs.pickDirectory()
    if (!handle) return false
    return openHandle(handle)
  }

  /** Reopen a persisted recent folder (requires a user gesture if permission lapsed). */
  async function openRecent(entry: RecentKb): Promise<boolean> {
    try {
      return await openHandle(entry.handle)
    } catch (err) {
      // Folder may have been moved/deleted since it was persisted.
      error.value = `Could not open “${entry.name}”: ${(err as Error).message}`
      await removeRecent(entry.name)
      await refreshRecents()
      return false
    }
  }

  /** Drop a folder from the recent list (does not touch the folder itself). */
  async function forgetRecent(name: string): Promise<void> {
    if (readLastKb() === name) writeLastKb(null)
    await removeRecent(name)
    await refreshRecents()
  }

  function close(): void {
    void releaseHeldLock()
    lockedByOther.value = false
    fs.setRoot(null)
    name.value = null
    isOpen.value = false
    isDemo.value = false
    // Closing is the user saying they want the start screen. Reopening this
    // folder on the next load would be overruling that.
    writeLastKb(null)
    hydrateReadingPositions(null)
  }

  return {
    name,
    isOpen,
    isDemo,
    recents,
    recentsKnown,
    restoring,
    error,
    lockedByOther,
    refreshRecents,
    forgetRecent,
    pickAndOpen,
    openRecent,
    restoreLast,
    openHandle, // used by the E2E bootstrap (memory-fs handle)
    close,
  }
})
