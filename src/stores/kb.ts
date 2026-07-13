import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as fs from '@/lib/fs'
import { isE2eMode } from '@/lib/e2e'
import { saveRecent, listRecents, removeRecent, type RecentKb } from '@/lib/idb'

export const useKbStore = defineStore('kb', () => {
  const name = ref<string | null>(null)
  const isOpen = ref(false)
  const recents = ref<RecentKb[]>([])
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
    }
  }

  async function openHandle(handle: FileSystemDirectoryHandle): Promise<boolean> {
    error.value = null
    if (!(await fs.ensurePermission(handle))) {
      error.value = 'Permission to access the folder was declined.'
      return false
    }
    fs.setRoot(handle)
    name.value = handle.name
    isOpen.value = true
    await acquireLock(handle.name)
    if (!isE2eMode()) {
      // Memory handles from E2E runs must not pollute the real recents list.
      await saveRecent(handle)
      await refreshRecents()
    }
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

  function close(): void {
    releaseLock?.()
    releaseLock = null
    lockedByOther.value = false
    fs.setRoot(null)
    name.value = null
    isOpen.value = false
  }

  return {
    name,
    isOpen,
    recents,
    error,
    lockedByOther,
    refreshRecents,
    pickAndOpen,
    openRecent,
    openHandle, // used by the E2E bootstrap (memory-fs handle)
    close,
  }
})
