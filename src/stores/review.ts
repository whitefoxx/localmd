/**
 * Review of agent edits that already happened. Every write the agent lands (auto mode
 * immediately; ask mode once the user approves the card in the conversation)
 * is recorded here as a before/after snapshot, so the user can keep (approve)
 * or restore (discard) it afterwards, per file or in bulk.
 *
 * This store never blocks the agent. The pause-and-ask flow lives in
 * stores/approvals and renders as a card in the transcript; by the time an
 * entry lands here, the file on disk already changed.
 *
 * Deletions ride the same flow: a removed text file keeps its content as the
 * `before` snapshot, so Discard restores it exactly like an unwanted write. A
 * directory or a binary can't be snapshotted — their entries are receipts of
 * a deletion the user already confirmed, and Discard merely dismisses them.
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import * as fs from '@/lib/fs'
import { useFilesStore } from '@/stores/files'
import { useKbStore } from '@/stores/kb'

export interface PendingChange {
  path: string
  /** Content before the agent's first write in this change set; null = new file. */
  before: string | null
  after: string
  /** The change REMOVED the path instead of writing it: `after` is empty, so the
   *  diff reads as a pure deletion and Approve merely acknowledges it. */
  deleted?: boolean
  /** The removed path was a directory — `before` then holds its file listing for
   *  display only and must never be written back. */
  dir?: boolean
}

/** Whether Discard can put the file back: writes always restore, deletions only
 *  when we hold a text snapshot (directories and binaries are gone for good). */
export function isRestorable(c: PendingChange): boolean {
  return !c.deleted || (!c.dir && c.before !== null)
}

export const useReviewStore = defineStore('review', () => {
  const pending = ref<Map<string, PendingChange>>(new Map())
  const panelOpen = ref(false)

  /**
   * Paths the agent created in this session — the ones it may treat as its
   * own. A first write with no `before` is the whole test; nothing is stored
   * on disk, because "which files did the assistant create" is exactly the
   * kind of bookkeeping that must not end up in someone's folder (see
   * CLAUDE.md, "Recall is a view or a note, never a record").
   *
   * Unlike `pending`, approving a change does not remove it: the question
   * this answers is not "is there an undecided change" but "whose file is
   * this". It resets with the KB, which is deliberately conservative — next
   * session, a page the agent wrote last week is treated as the user's, and
   * touching it asks first.
   */
  const created = ref<Set<string>>(new Set())

  /** Whether the agent made this file itself, this session. */
  function isAgentCreated(path: string): boolean {
    return created.value.has(path)
  }

  const changes = computed(() => [...pending.value.values()])
  const count = computed(() => pending.value.size)

  /** Kind of the recorded change; absent fields mean "an ordinary write". */
  type ChangeMeta = Pick<PendingChange, 'deleted' | 'dir'>

  /** Register or update the entry for `path`, always keeping the ORIGINAL
   *  `before` snapshot — that is the pre-agent state Discard restores, however
   *  many times the agent touches the file afterwards. */
  function upsert(path: string, before: string | null, after: string, meta: ChangeMeta): void {
    const existing = pending.value.get(path)
    if (existing) {
      existing.after = after
      existing.deleted = meta.deleted ?? false
      existing.dir = meta.dir ?? false
      return
    }
    pending.value.set(path, { path, before, after, ...meta })
  }

  function recordWrite(path: string, before: string | null, after: string): void {
    // First write with nothing there before = the agent created this file.
    if (before === null && !pending.value.has(path)) created.value.add(path)
    upsert(path, before, after, {})
  }

  /** Record an agent deletion. `before` is the text snapshot Discard puts back;
   *  null for binaries (nothing to restore), and for a directory it is the
   *  removed file listing — shown in the diff, never written back. */
  function recordDelete(path: string, before: string | null, dir: boolean): void {
    upsert(path, before, '', { deleted: true, dir })
  }

  function approve(path: string): void {
    pending.value.delete(path)
  }

  /** A commit is an approval: the given paths are now in git history, so drop
   *  them from the review list without touching the files on disk. Paths not
   *  under review are ignored. */
  function markCommitted(paths: Iterable<string>): void {
    for (const path of paths) pending.value.delete(path)
  }

  async function discard(path: string): Promise<void> {
    const change = pending.value.get(path)
    if (!change) return
    if (change.deleted) {
      // Undo the removal when a text snapshot exists; for a directory or a
      // binary there is nothing to put back, so Discard just drops the receipt.
      if (isRestorable(change)) await fs.writeFile(path, change.before!)
    } else if (change.before === null) {
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

  /** Forget everything under review, without touching any file. */
  function reset(): void {
    created.value = new Set()
    pending.value.clear()
    panelOpen.value = false
  }

  // A change is a snapshot of a path inside ONE folder, and Discard writes that
  // snapshot back — through an fs root that now points somewhere else. Listing
  // the previous KB's edits after a switch is wrong on screen and dangerous on
  // click, so the list (and the panel it feeds) does not survive the swap.
  const kb = useKbStore()
  watch(() => kb.name, reset)

  return {
    pending,
    panelOpen,
    isAgentCreated,
    changes,
    count,
    reset,
    recordWrite,
    recordDelete,
    approve,
    markCommitted,
    discard,
    approveAll,
    discardAll,
  }
})
