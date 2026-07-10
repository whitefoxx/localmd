/**
 * Snapshot-based review of agent edits — the browser replacement for
 * trace-app's git-based review flow. write_file snapshots the original
 * content before the first agent write to each path; the user can then
 * approve (keep) or discard (restore the snapshot / delete a new file).
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as fs from '@/lib/fs'
import { useFilesStore } from '@/stores/files'

export interface PendingChange {
  path: string
  /** Content before the agent's first write in this change set; null = new file. */
  before: string | null
  after: string
}

export const useReviewStore = defineStore('review', () => {
  const pending = ref<Map<string, PendingChange>>(new Map())
  const panelOpen = ref(false)

  const changes = computed(() => [...pending.value.values()])
  const count = computed(() => pending.value.size)

  function recordWrite(path: string, before: string | null, after: string): void {
    const existing = pending.value.get(path)
    if (existing) {
      existing.after = after // keep the original `before` snapshot
    } else {
      pending.value.set(path, { path, before, after })
    }
  }

  function approve(path: string): void {
    pending.value.delete(path)
  }

  async function discard(path: string): Promise<void> {
    const change = pending.value.get(path)
    if (!change) return
    if (change.before === null) {
      await fs.removeFile(path).catch(() => {})
    } else {
      await fs.writeFile(path, change.before)
    }
    pending.value.delete(path)
    const files = useFilesStore()
    await files.refreshTree()
    await files.reloadIfClean(path)
  }

  function approveAll(): void {
    pending.value.clear()
  }

  async function discardAll(): Promise<void> {
    for (const path of [...pending.value.keys()]) {
      await discard(path)
    }
  }

  return { pending, panelOpen, changes, count, recordWrite, approve, discard, approveAll, discardAll }
})
