import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as fs from '@/lib/fs'
import { saveRecent, listRecents, removeRecent, type RecentKb } from '@/lib/idb'

export const useKbStore = defineStore('kb', () => {
  const name = ref<string | null>(null)
  const isOpen = ref(false)
  const recents = ref<RecentKb[]>([])
  const error = ref<string | null>(null)

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

  function close(): void {
    fs.setRoot(null)
    name.value = null
    isOpen.value = false
  }

  return { name, isOpen, recents, error, refreshRecents, pickAndOpen, openRecent, close }
})
