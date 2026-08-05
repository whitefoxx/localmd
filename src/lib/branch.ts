/**
 * The conversation as a TREE rather than a list.
 *
 * A session keeps every message it has ever held — including the ones on paths
 * the user walked away from — and each message records `parentId`, the message
 * it was said after. What the user reads, and what the model is sent, is the
 * single path from a root down to `leafId`. Re-asking a question appends a
 * sibling rather than destroying the answer that was already there.
 *
 * Nothing here rewrites an earlier message, which is why branching costs
 * nothing in cache terms (docs/token-optimization.md): continuing from an old
 * point replays bytes the provider has already seen.
 *
 * Pure functions over the message array — the store owns every mutation.
 */

/** The shape these functions need; `UiMessage` satisfies it. */
export interface BranchNode {
  id: number
  /** The message this one was said after — null for a conversation's first. */
  parentId?: number | null
  role: 'user' | 'assistant'
  /** The wire messages this one contributed to the model-facing history, raw
   *  and never rewritten. Absent on messages recorded before sessions were
   *  trees, which is what makes them unreplayable (see `branchableIds`). */
  wire?: unknown[]
  /** `wire` is the WHOLE history up to and including this message rather than
   *  this message's own contribution — a self-contained checkpoint. A session
   *  that predates branching has exactly one such message: `linearize` hands
   *  its single flat history to the last one, so everything said from there on
   *  replays cleanly even though the messages before it were never recorded
   *  individually. */
  wireIsCheckpoint?: boolean
}

/** The messages from a root down to `leafId`, oldest first — the conversation
 *  as it currently reads. No leaf means an empty conversation. Tolerates a
 *  broken chain (a cycle, a missing parent) by stopping rather than hanging. */
export function branchPath<T extends BranchNode>(
  messages: T[],
  leafId: number | null | undefined,
): T[] {
  if (leafId == null) return []
  const byId = new Map(messages.map((m) => [m.id, m]))
  const out: T[] = []
  const seen = new Set<number>()
  let cur = byId.get(leafId)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.push(cur)
    cur = cur.parentId == null ? undefined : byId.get(cur.parentId)
  }
  return out.reverse()
}

/** Direct children of `parentId` — the roots when null — in the order they were
 *  said, which is the order the version switcher walks. */
export function childrenOf<T extends BranchNode>(messages: T[], parentId: number | null): T[] {
  return messages.filter((m) => (m.parentId ?? null) === parentId)
}

/** Follow a subtree down to a leaf, taking the most recent child at every fork:
 *  switching to a branch lands where that branch left off, not on its first
 *  message. */
export function deepestLeaf<T extends BranchNode>(messages: T[], fromId: number): number {
  let cur = fromId
  const seen = new Set<number>()
  for (;;) {
    if (seen.has(cur)) return cur
    seen.add(cur)
    const kids = childrenOf(messages, cur)
    if (!kids.length) return cur
    cur = kids[kids.length - 1].id
  }
}

/** Which of the sibling versions of `id` is showing, 1-based. `total` is 1 when
 *  the message was never re-asked — the switcher hides itself then. */
export function versionsOf<T extends BranchNode>(
  messages: T[],
  id: number,
): { index: number; total: number } {
  const node = messages.find((m) => m.id === id)
  if (!node) return { index: 1, total: 1 }
  const sibs = childrenOf(messages, node.parentId ?? null)
  return { index: sibs.findIndex((m) => m.id === id) + 1, total: sibs.length }
}

/** Give a pre-tree session its links: a flat list is a tree with no forks.
 *  Returns the leaf to start from.
 *
 *  Its `history` — one flat array for the whole conversation, since nothing
 *  recorded which message contributed what — is handed to the last message as a
 *  checkpoint. That is the honest split: everything up to there can be replayed
 *  only as a whole, and everything said afterwards branches like any other. */
export function linearize<T extends BranchNode>(
  messages: T[],
  history?: unknown[],
): number | null {
  let prev: number | null = null
  for (const m of messages) {
    m.parentId = prev
    prev = m.id
  }
  const last = messages[messages.length - 1]
  if (last && history) {
    last.wire = history
    last.wireIsCheckpoint = true
  }
  return prev
}

/** The model-facing history for a path: each message's own contribution, in
 *  order. Raw by design — trimming and compaction rewrite the working copy and
 *  are never written back onto the messages, so a branch always rebuilds from
 *  full fidelity and re-earns its hygiene on the next send. */
export function rebuildWire<T extends BranchNode>(path: T[]): unknown[] {
  const out: unknown[] = []
  for (const m of path) {
    if (m.wireIsCheckpoint) out.length = 0 // a checkpoint stands for all of it
    if (m.wire) out.push(...m.wire)
  }
  return out
}

/** Ids of the user messages on `path` that can be re-asked. Re-asking replays
 *  everything said before the message, so it needs an unbroken run of `wire`
 *  back to the root — or back to a checkpoint, which carries that history
 *  wholesale. A session recorded before messages kept their own wire slice
 *  therefore reads and continues normally, and becomes branchable again from
 *  the point it was picked back up. */
export function branchableIds<T extends BranchNode>(path: T[]): Set<number> {
  const out = new Set<number>()
  let replayable = true
  for (const m of path) {
    if (replayable && m.role === 'user') out.add(m.id)
    if (m.wire === undefined) replayable = false
    else if (m.wireIsCheckpoint) replayable = true
  }
  return out
}
