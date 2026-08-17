import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as fs from '@/lib/fs'
import { isE2eMode } from '@/lib/e2e'
import { saveRecent, listRecents, removeRecent, type RecentKb } from '@/lib/idb'
import { hydrateReadingPositions } from '@/lib/viewMemory'

export const useKbStore = defineStore('kb', () => {
  const name = ref<string | null>(null)
  const isOpen = ref(false)
  const recents = ref<RecentKb[]>([])
  /** False until the first read of the recents list has come back. An empty
   *  list and a list nobody has looked at yet are different things, and the
   *  start screen shows a different half of itself for each — without this it
   *  renders the first-visit copy for a frame and then yanks it away. */
  const recentsKnown = ref(false)
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
    await saveRecent(handle)
    await refreshRecents()
    return true
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
    hydrateReadingPositions(null)
  }

  return {
    name,
    isOpen,
    recents,
    recentsKnown,
    error,
    lockedByOther,
    refreshRecents,
    forgetRecent,
    pickAndOpen,
    openRecent,
    openHandle, // used by the E2E bootstrap (memory-fs handle)
    close,
  }
})
