import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import * as fs from '@/lib/fs'
import { createMemoryRoot } from '@/lib/memfs'
import { useFilesStore } from '@/stores/files'
import { watch } from 'vue'
import {
  pendingDelete,
  registerDeleteDialog,
  settleDelete,
  type DeleteCandidate,
} from './confirmDelete'
import { deleteRows, moveRows, readDragRows } from './fileOps'

/**
 * Stand in for the dialog: register as a listener and answer the moment a
 * question opens. `pick` is what the user leaves ticked — the identity function
 * is "delete everything offered", `() => []` is cancel.
 */
function answerDelete(pick: (c: DeleteCandidate[]) => DeleteCandidate[]): () => void {
  const unregister = registerDeleteDialog()
  const stop = watch(
    pendingDelete,
    (req) => {
      if (!req) return
      offered = req.candidates
      settleDelete(pick(req.candidates))
    },
    { flush: 'sync' },
  )
  return () => {
    stop()
    unregister()
  }
}
/** What the last question put in front of the user. */
let offered: DeleteCandidate[] = []
let closeDialog: (() => void) | null = null

/** What the batch helpers say when they refuse. */
let alerts: string[] = []

beforeEach(async () => {
  setActivePinia(createPinia())
  fs.setRoot(createMemoryRoot())
  alerts = []
  offered = []
  closeDialog = null
  vi.stubGlobal('window', {
    alert: (m: string) => alerts.push(m),
    addEventListener: () => {},
  })
  vi.stubGlobal('crypto', { randomUUID: () => `id-${Math.random()}` })
  await fs.writeFile('wiki/a.md', 'A')
  await fs.writeFile('wiki/b.md', 'B')
  await fs.writeFile('notes/deep/c.md', 'C')
  await fs.writeFile('notes/d.md', 'D')
  await fs.writeFile('top.md', 'T')
  await useFilesStore().refreshTree()
})

afterEach(() => {
  closeDialog?.()
  vi.unstubAllGlobals()
})

describe('moveRows', () => {
  it('moves a whole batch and leaves all of it selected where it landed', async () => {
    const files = useFilesStore()
    await moveRows(
      [
        { path: 'wiki/a.md', isDir: false },
        { path: 'wiki/b.md', isDir: false },
      ],
      'notes',
    )

    expect(await fs.exists('notes/a.md')).toBe(true)
    expect(await fs.exists('notes/b.md')).toBe(true)
    expect(await fs.exists('wiki/a.md')).toBe(false)
    // renameEntry selects each row as it lands; without the re-select at the
    // end a batch move would finish with only its last entry highlighted.
    expect([...files.selectedPaths].sort()).toEqual(['notes/a.md', 'notes/b.md'])
  })

  it('cancels the entire batch when any one name is already taken', async () => {
    await fs.writeFile('notes/a.md', 'existing')
    await useFilesStore().refreshTree()

    await moveRows(
      [
        { path: 'wiki/b.md', isDir: false },
        { path: 'wiki/a.md', isDir: false },
      ],
      'notes',
    )

    // b.md comes first and would have gone through under a per-entry check.
    // Nothing may move: a half-done move is a folder state nobody asked for.
    expect(await fs.exists('notes/b.md')).toBe(false)
    expect(await fs.exists('wiki/b.md')).toBe(true)
    expect(alerts).toHaveLength(1)
  })

  it('refuses a destination that is not a folder, and says nothing moved', async () => {
    await moveRows([{ path: 'wiki/a.md', isDir: false }], 'nowhere')

    expect(await fs.exists('wiki/a.md')).toBe(true)
    expect(alerts[0]).toContain('nowhere')
  })

  it('refuses to put a folder inside itself', async () => {
    await moveRows([{ path: 'notes', isDir: true }], 'notes/deep')

    expect(await fs.exists('notes/deep/c.md')).toBe(true)
    expect(alerts).toHaveLength(1)
  })

  it('lets a folder carry its own children rather than moving them twice', async () => {
    await moveRows(
      [
        { path: 'notes/deep', isDir: true },
        { path: 'notes/deep/c.md', isDir: false },
      ],
      'wiki',
    )

    expect(await fs.exists('wiki/deep/c.md')).toBe(true)
    expect(alerts).toEqual([])
  })

  it('carries on past a selected row whose file is already gone', async () => {
    // A selection is a list of paths, and paths go stale — the user renames in
    // Finder, the agent moves something. Before this, the loop threw on the
    // phantom and everything after it silently did not happen.
    await moveRows(
      [
        { path: 'wiki/gone.md', isDir: false },
        { path: 'wiki/a.md', isDir: false },
      ],
      'notes',
    )

    expect(await fs.exists('notes/a.md')).toBe(true)
    expect(alerts).toEqual([])
  })

  it('does nothing for rows already in the destination', async () => {
    await moveRows([{ path: 'wiki/a.md', isDir: false }], 'wiki')

    expect(await fs.exists('wiki/a.md')).toBe(true)
    expect(alerts).toEqual([])
  })
})

describe('deleteRows', () => {
  it('offers the whole batch, and deletes what the user leaves ticked', async () => {
    closeDialog = answerDelete((c) => c)
    await deleteRows([
      { path: 'wiki/a.md', isDir: false },
      { path: 'wiki/b.md', isDir: false },
    ])

    expect(offered.map((c) => c.path)).toEqual(['wiki/a.md', 'wiki/b.md'])
    expect(await fs.exists('wiki/a.md')).toBe(false)
    expect(await fs.exists('wiki/b.md')).toBe(false)
  })

  it('deletes only the rows still ticked, leaving the ones taken back out', async () => {
    // The point of the dialog over a confirm: the batch is editable in it.
    closeDialog = answerDelete((c) => c.filter((x) => x.path === 'wiki/a.md'))
    await deleteRows([
      { path: 'wiki/a.md', isDir: false },
      { path: 'wiki/b.md', isDir: false },
    ])

    expect(await fs.exists('wiki/a.md')).toBe(false)
    expect(await fs.exists('wiki/b.md')).toBe(true)
  })

  it('takes nothing when the dialog comes back empty', async () => {
    closeDialog = answerDelete(() => [])
    await deleteRows([{ path: 'wiki/a.md', isDir: false }])

    expect(await fs.exists('wiki/a.md')).toBe(true)
  })

  it('takes nothing when there is no dialog to answer', async () => {
    // A decision defaults to no: an unanswerable question must not fall
    // through to the delete, and must not hang the caller either.
    await deleteRows([{ path: 'wiki/a.md', isDir: false }])

    expect(await fs.exists('wiki/a.md')).toBe(true)
  })

  it('tells the dialog how many files a folder is carrying', async () => {
    // The number the old one-line confirm had no room for, and whose absence
    // let "delete these 3 items" mean an entire knowledge base.
    closeDialog = answerDelete(() => [])
    await deleteRows([
      { path: 'notes', isDir: true },
      { path: 'top.md', isDir: false },
    ])

    expect(offered).toEqual([
      { path: 'notes', isDir: true, files: 2 },
      { path: 'top.md', isDir: false, files: 0 },
    ])
  })

  it('does not offer a row that is already gone, or trip over it', async () => {
    closeDialog = answerDelete((c) => c)
    await deleteRows([
      { path: 'wiki/gone.md', isDir: false },
      { path: 'wiki/a.md', isDir: false },
    ])

    expect(offered.map((c) => c.path)).toEqual(['wiki/a.md'])
    expect(await fs.exists('wiki/a.md')).toBe(false)
  })

  it('counts a folder and its contents once', async () => {
    closeDialog = answerDelete((c) => c)
    await deleteRows([
      { path: 'notes/deep', isDir: true },
      { path: 'notes/deep/c.md', isDir: false },
    ])

    // The child would already be gone with its parent; offering it separately
    // would ask about the same delete twice and then throw on a dead path.
    expect(offered.map((c) => c.path)).toEqual(['notes/deep'])
    expect(await fs.exists('notes/deep/c.md')).toBe(false)
    expect(await fs.exists('notes/d.md')).toBe(true)
  })
})

describe('readDragRows', () => {
  const dt = (type: string, data: string): DataTransfer =>
    ({ getData: (t: string) => (t === type ? data : '') }) as unknown as DataTransfer

  it('reads back what a tree drag wrote', () => {
    expect(
      readDragRows(dt('application/x-bmd-rows', '[{"path":"wiki/a.md","isDir":false}]')),
    ).toEqual([{ path: 'wiki/a.md', isDir: false }])
  })

  it('is empty for a drag that is not ours, rather than throwing on it', () => {
    expect(readDragRows(dt('text/plain', 'hello'))).toEqual([])
    expect(readDragRows(dt('application/x-bmd-rows', 'not json'))).toEqual([])
    expect(readDragRows(dt('application/x-bmd-rows', '[{"path":1}]'))).toEqual([])
    expect(readDragRows(null)).toEqual([])
  })
})
