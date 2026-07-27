/**
 * Review of agent edits — the browser replacement for trace-app's git-based
 * review flow, in two modes:
 *
 *  - auto (default): the write happens immediately; a before/after snapshot is
 *    recorded so the user can approve (keep) or discard (restore) afterwards.
 *  - ask: the write tool PAUSES on askApproval() until the user approves or
 *    rejects in this panel; rejected writes never touch the disk.
 *
 * Deletions ride the same flow: a removed text file keeps its content as the
 * `before` snapshot, so Discard restores it exactly like an unwanted write. A
 * directory or a binary can't be snapshotted — those deletions always ask
 * first (whatever the write mode) and the entry is only a receipt afterwards.
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
  /** Set while the agent is paused waiting for the user's decision (ask mode). */
  awaiting?: boolean
  /** The change REMOVES the path instead of writing it: `after` is empty, so the
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

  /** Writes paused in ask mode, keyed by path; sessionId attributes the pause
   *  to the chat session whose turn it belongs to, so stopping one session
   *  never rejects another's pending approvals. */
  const resolvers = new Map<string, { sessionId: string; resolve: (approved: boolean) => void }>()

  const changes = computed(() => [...pending.value.values()])
  const count = computed(() => pending.value.size)
  /** At least one write is paused on the user. Nothing pops open on its own, so
   *  this is what the activity bar turns into a visible "your turn". */
  const awaiting = computed(() => changes.value.some((c) => c.awaiting))

  /** Kind of the recorded change; absent fields mean "an ordinary write". */
  type ChangeMeta = Pick<PendingChange, 'deleted' | 'dir'>

  /** Register or update the entry for `path`, always keeping the ORIGINAL
   *  `before` snapshot — that is the pre-agent state Discard restores, however
   *  many times the agent touches the file afterwards. */
  function upsert(
    path: string,
    before: string | null,
    after: string,
    meta: ChangeMeta,
  ): PendingChange {
    const existing = pending.value.get(path)
    if (existing) {
      existing.after = after
      existing.deleted = meta.deleted ?? false
      existing.dir = meta.dir ?? false
      return existing
    }
    const change: PendingChange = { path, before, after, ...meta }
    pending.value.set(path, change)
    return change
  }

  function recordWrite(path: string, before: string | null, after: string): void {
    upsert(path, before, after, {})
  }

  /** Record an agent deletion. `before` is the text snapshot Discard puts back;
   *  null for binaries (nothing to restore), and for a directory it is the
   *  removed file listing — shown in the diff, never written back. */
  function recordDelete(path: string, before: string | null, dir: boolean): void {
    upsert(path, before, '', { deleted: true, dir })
  }

  /** Ask-first mode: register the proposed write and pause the tool until the
   *  user decides. Resolves false when rejected or the turn is stopped.
   *
   *  Deliberately does NOT open the panel: a dialog thrown over the screen
   *  interrupts whatever the user was reading. The activity bar carries the
   *  pending count and flags the wait — they open the diff when they are ready. */
  function askApproval(
    sessionId: string,
    path: string,
    before: string | null,
    after: string,
    meta: ChangeMeta = {},
  ): Promise<boolean> {
    upsert(path, before, after, meta).awaiting = true
    return new Promise((resolve) => {
      resolvers.get(path)?.resolve(false) // a superseded ask counts as rejected
      resolvers.set(path, { sessionId, resolve })
    })
  }

  function decide(path: string, approved: boolean): void {
    const entry = resolvers.get(path)
    if (!entry) return
    resolvers.delete(path)
    const change = pending.value.get(path)
    if (change) {
      if (approved) {
        change.awaiting = false // stays for post-hoc review/discard
      } else {
        pending.value.delete(path)
      }
    }
    entry.resolve(approved)
  }

  /** Stop/abort: paused writes of that session resolve as rejected (all
   *  sessions when omitted — KB switch / global teardown). */
  function rejectAwaiting(sessionId?: string): void {
    for (const [path, entry] of [...resolvers.entries()]) {
      if (sessionId === undefined || entry.sessionId === sessionId) decide(path, false)
    }
  }

  function approve(path: string): void {
    if (resolvers.has(path)) {
      decide(path, true)
      return
    }
    pending.value.delete(path)
  }

  /** A commit is an approval: the given paths are now in git history, so drop
   *  them from the review list without touching the files on disk. Ask-mode
   *  writes still awaiting a decision are left alone — an unwritten file can't
   *  have been committed. Paths not under review are ignored. */
  function markCommitted(paths: Iterable<string>): void {
    for (const path of paths) {
      const change = pending.value.get(path)
      if (change && !change.awaiting) pending.value.delete(path)
    }
  }

  async function discard(path: string): Promise<void> {
    if (resolvers.has(path)) {
      decide(path, false)
      return
    }
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
    for (const path of [...resolvers.keys()]) decide(path, true)
    pending.value.clear()
  }

  async function discardAll(): Promise<void> {
    rejectAwaiting()
    for (const path of [...pending.value.keys()]) {
      await discard(path)
    }
  }

  return {
    pending,
    panelOpen,
    changes,
    count,
    awaiting,
    recordWrite,
    recordDelete,
    askApproval,
    decide,
    rejectAwaiting,
    approve,
    markCommitted,
    discard,
    approveAll,
    discardAll,
  }
})
