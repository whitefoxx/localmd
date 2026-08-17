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
  const error = ref<string | null>(null)
  /** Another tab holds this KB open — concurrent writes would clobber each
   *  other (autosave, .git/index, sidecars). We warn rather than hard-block. */
  const lockedByOther = ref(false)

  let releaseLock: (() => void) | null = null

  /** Try to take the exclusive Web Lock for this KB; held until close().
   *  Locks auto-release when the tab dies, so stale locks can't happen. */
  async function acquireLock(kbName: string): Promise<void> {
    releaseLock?.()
    releaseLock = null
    lockedByOther.value = false
    if (!('locks' in navigator)) return
    await new Promise<void>((ready) => {
      void navigator.locks.request(
        `browser-md:kb:${kbName}`,
        { ifAvailable: true },
        (lock) => {
          if (!lock) {
            lockedByOther.value = true
            ready()
            return
          }
          ready()
          return new Promise<void>((release) => {
            releaseLock = release
          })
        },
      )
    })
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
    opts: { ephemeral?: boolean } = {},
  ): Promise<boolean> {
    error.value = null
    if (!(await fs.ensurePermission(handle))) {
      error.value = 'Permission to access the folder was declined.'
      return false
    }
    fs.setRoot(handle)
    name.value = handle.name
    isOpen.value = true
    hydrateReadingPositions(handle.name)
    if (opts.ephemeral ?? isE2eMode()) return true
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
    releaseLock?.()
    releaseLock = null
    lockedByOther.value = false
    fs.setRoot(null)
    name.value = null
    isOpen.value = false
    // Closing is the user saying they want the start screen. Reopening this
    // folder on the next load would be overruling that.
    writeLastKb(null)
    hydrateReadingPositions(null)
  }

  return {
    name,
    isOpen,
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
