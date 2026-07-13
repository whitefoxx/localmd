/**
 * Review of agent edits — the browser replacement for trace-app's git-based
 * review flow, in two modes:
 *
 *  - auto (default): the write happens immediately; a before/after snapshot is
 *    recorded so the user can approve (keep) or discard (restore) afterwards.
 *  - ask: the write tool PAUSES on askApproval() until the user approves or
 *    rejects in this panel; rejected writes never touch the disk.
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

  /** Paths written during each session's CURRENT turn (for git checkpoints).
   *  Keyed by session so concurrent turns don't pollute each other's set. */
  const turnWrites = ref(new Map<string, Set<string>>())

  function beginTurn(sessionId: string): void {
    turnWrites.value.set(sessionId, new Set())
  }

  function turnWritesFor(sessionId: string): string[] {
    return [...(turnWrites.value.get(sessionId) ?? [])]
  }

  function clearTurn(sessionId: string): void {
    turnWrites.value.delete(sessionId)
  }

  function recordWrite(sessionId: string, path: string, before: string | null, after: string): void {
    let set = turnWrites.value.get(sessionId)
    if (!set) turnWrites.value.set(sessionId, (set = new Set()))
    set.add(path)
    const existing = pending.value.get(path)
    if (existing) {
      existing.after = after // keep the original `before` snapshot
    } else {
      pending.value.set(path, { path, before, after })
    }
  }

  /** Ask-first mode: register the proposed write and pause the tool until the
   *  user decides. Resolves false when rejected or the turn is stopped. */
  function askApproval(
    sessionId: string,
    path: string,
    before: string | null,
    after: string,
  ): Promise<boolean> {
    const existing = pending.value.get(path)
    if (existing) {
      existing.after = after
      existing.awaiting = true
    } else {
      pending.value.set(path, { path, before, after, awaiting: true })
    }
    panelOpen.value = true
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

  async function discard(path: string): Promise<void> {
    if (resolvers.has(path)) {
      decide(path, false)
      return
    }
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
    beginTurn,
    turnWritesFor,
    clearTurn,
    recordWrite,
    askApproval,
    decide,
    rejectAwaiting,
    approve,
    discard,
    approveAll,
    discardAll,
  }
})
