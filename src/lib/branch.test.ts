import { describe, it, expect } from 'vitest'
import {
  branchPath,
  childrenOf,
  deepestLeaf,
  versionsOf,
  linearize,
  rebuildWire,
  branchableIds,
  type BranchNode,
} from './branch'

/** A message reduced to what the tree cares about. */
function node(id: number, parentId: number | null, role: 'user' | 'assistant', wire = true): BranchNode {
  return { id, parentId, role, ...(wire ? { wire: [`w${id}`] } : {}) }
}

/**
 *   1 user ── 2 asst ─┬─ 3 user ── 4 asst        (original)
 *                     └─ 5 user ── 6 asst        (re-asked)
 */
const tree: BranchNode[] = [
  node(1, null, 'user'),
  node(2, 1, 'assistant'),
  node(3, 2, 'user'),
  node(4, 3, 'assistant'),
  node(5, 2, 'user'),
  node(6, 5, 'assistant'),
]

describe('branchPath', () => {
  it('reads a branch oldest-first from the leaf', () => {
    expect(branchPath(tree, 6).map((m) => m.id)).toEqual([1, 2, 5, 6])
    expect(branchPath(tree, 4).map((m) => m.id)).toEqual([1, 2, 3, 4])
  })

  it('is empty with no leaf — a session before its first message', () => {
    expect(branchPath(tree, null)).toEqual([])
    expect(branchPath(tree, undefined)).toEqual([])
  })

  it('stops instead of hanging on a broken chain', () => {
    expect(branchPath(tree, 99)).toEqual([])
    const cyclic: BranchNode[] = [node(1, 2, 'user'), node(2, 1, 'assistant')]
    expect(branchPath(cyclic, 2).map((m) => m.id)).toEqual([1, 2])
  })
})

describe('childrenOf', () => {
  it('finds a fork', () => {
    expect(childrenOf(tree, 2).map((m) => m.id)).toEqual([3, 5])
  })

  it('treats roots as children of null', () => {
    expect(childrenOf(tree, null).map((m) => m.id)).toEqual([1])
  })
})

describe('deepestLeaf', () => {
  it('lands where a branch left off, not on its first message', () => {
    expect(deepestLeaf(tree, 5)).toBe(6)
    expect(deepestLeaf(tree, 2)).toBe(6) // most recent child at the fork
  })

  it('returns the message itself when nothing follows it', () => {
    expect(deepestLeaf(tree, 6)).toBe(6)
  })
})

describe('versionsOf', () => {
  it('numbers siblings in the order they were asked', () => {
    expect(versionsOf(tree, 3)).toEqual({ index: 1, total: 2 })
    expect(versionsOf(tree, 5)).toEqual({ index: 2, total: 2 })
  })

  it('reports a lone message as the only version', () => {
    expect(versionsOf(tree, 1)).toEqual({ index: 1, total: 1 })
    expect(versionsOf(tree, 404)).toEqual({ index: 1, total: 1 })
  })
})

describe('linearize', () => {
  it('turns a pre-tree session into a chain and names its leaf', () => {
    const flat: BranchNode[] = [
      { id: 7, role: 'user' },
      { id: 8, role: 'assistant' },
      { id: 9, role: 'user' },
    ]
    expect(linearize(flat)).toBe(9)
    expect(flat.map((m) => m.parentId)).toEqual([null, 7, 8])
  })

  it('hands the old flat history to the last message as a checkpoint', () => {
    const flat: BranchNode[] = [
      { id: 7, role: 'user' },
      { id: 8, role: 'assistant' },
    ]
    linearize(flat, ['h1', 'h2', 'h3'])
    expect(flat[0].wire).toBeUndefined()
    expect(flat[1]).toMatchObject({ wire: ['h1', 'h2', 'h3'], wireIsCheckpoint: true })
  })

  it('leaves an empty session without a leaf', () => {
    expect(linearize([])).toBeNull()
  })
})

describe('rebuildWire', () => {
  it('concatenates only the branch that is showing', () => {
    expect(rebuildWire(branchPath(tree, 6))).toEqual(['w1', 'w2', 'w5', 'w6'])
    expect(rebuildWire(branchPath(tree, 4))).toEqual(['w1', 'w2', 'w3', 'w4'])
  })

  it('skips messages that carry nothing', () => {
    const path = [node(1, null, 'user', false), node(2, 1, 'assistant')]
    expect(rebuildWire(path)).toEqual(['w2'])
  })

  it('lets a checkpoint stand for everything before it', () => {
    const path: BranchNode[] = [
      node(1, null, 'user', false),
      { id: 2, parentId: 1, role: 'assistant', wire: ['old1', 'old2'], wireIsCheckpoint: true },
      node(3, 2, 'user'),
    ]
    expect(rebuildWire(path)).toEqual(['old1', 'old2', 'w3'])
  })
})

describe('branchableIds', () => {
  it('offers every user message when the branch replays cleanly', () => {
    expect([...branchableIds(branchPath(tree, 6))]).toEqual([1, 5])
  })

  it('stops offering once an unreplayable message is behind us', () => {
    // A pre-tree session: no message carries a wire slice.
    const legacy = [
      node(1, null, 'user', false),
      node(2, 1, 'assistant', false),
      node(3, 2, 'user', false),
    ]
    // The first message needs nothing replayed before it, so it stays branchable.
    expect([...branchableIds(legacy)]).toEqual([1])
  })

  it('keeps offering messages recorded after the gap closes', () => {
    const mixed = [node(1, null, 'user'), node(2, 1, 'assistant'), node(3, 2, 'user')]
    expect([...branchableIds(mixed)]).toEqual([1, 3])
  })

  it('resumes at a checkpoint — a migrated session branches from where it was picked up', () => {
    // What adoptSession produces for an old conversation the user continues:
    // two unrecorded messages, the checkpoint holding their history, then new
    // messages that recorded themselves.
    const migrated: BranchNode[] = [
      node(1, null, 'user', false),
      { id: 2, parentId: 1, role: 'assistant', wire: ['old'], wireIsCheckpoint: true },
      node(3, 2, 'user'),
      node(4, 3, 'assistant'),
      node(5, 4, 'user'),
    ]
    // 3 and 5 replay from the checkpoint. 1 is offered too, but for the other
    // reason: it opens the conversation, so re-asking it replays nothing at all.
    expect([...branchableIds(migrated)]).toEqual([1, 3, 5])
  })
})
