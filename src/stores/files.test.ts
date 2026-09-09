import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import * as fs from '@/lib/fs'
import { createMemoryRoot } from '@/lib/memfs'
import { todayIso } from '@/lib/daily'
import { useFilesStore } from './files'

describe('files store — revealPath (tree follows the active file)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    fs.setRoot(createMemoryRoot())
    await fs.writeFile('wiki/concepts/deep.md', 'D')
    await fs.writeFile('AGENTS.md', 'A')
    await useFilesStore().refreshTree()
  })

  it('expands every folder on the way down and selects the file alone', () => {
    const files = useFilesStore()
    files.select('AGENTS.md', false)
    files.collapseAll()

    files.revealPath('wiki/concepts/deep.md')

    expect([...files.expandedDirs].sort()).toEqual(['wiki', 'wiki/concepts'])
    expect(files.selectedPath).toBe('wiki/concepts/deep.md')
    expect(files.selectedIsDir).toBe(false)
    // Selection is single: the previous highlight is gone, and new files now
    // land beside the revealed one.
    expect(files.targetDir).toBe('wiki/concepts')
  })

  it('ignores paths the tree does not render, keeping the selection where it was', () => {
    const files = useFilesStore()
    files.select('AGENTS.md', false)

    files.revealPath('.localmd/pdf-index/foo/toc.md')

    expect(files.selectedPath).toBe('AGENTS.md')
    expect(files.expandedDirs.has('.localmd')).toBe(false)
  })
})

describe('files store — openFile with a file that is not there', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    fs.setRoot(createMemoryRoot())
    await fs.writeFile('wiki/index.md', 'I')
    await useFilesStore().refreshTree()
  })

  it('opens an annotations sidecar that does not exist yet, empty', async () => {
    // The sidecar is written by the first highlight. Until then the reader's
    // View annotations button used to do nothing at all: the tab was added,
    // the read failed, and the view never changed.
    const files = useFilesStore()
    await files.openFile('raw/papers/x.pdf.annotations.json')

    expect(files.currentPath).toBe('raw/papers/x.pdf.annotations.json')
    expect(files.content).toBe('')
    expect(files.openTabs).toContain('raw/papers/x.pdf.annotations.json')
  })

  it('leaves no tab behind for an ordinary file that cannot be read', async () => {
    const files = useFilesStore()
    await files.openFile('wiki/index.md')

    await files.openFile('wiki/gone.md')

    expect(files.currentPath).toBe('wiki/index.md') // unchanged
    expect(files.openTabs).not.toContain('wiki/gone.md')
  })

  it('says whether the file is actually on screen', async () => {
    // What the agent panel needs in order to decide: it leaves its full-window
    // layout to reveal a file the transcript named, and a reference to a file
    // that is gone must not cost the user that layout for nothing.
    const files = useFilesStore()

    expect(await files.openFile('wiki/index.md')).toBe(true)
    expect(await files.openFile('wiki/index.md')).toBe(true) // already current
    expect(await files.openFile('wiki/gone.md')).toBe(false)
  })

  it('keeps a tab the user already had, even when its file goes missing', async () => {
    const files = useFilesStore()
    await files.openFile('wiki/index.md')
    await fs.removeFile('wiki/index.md')

    // Switch away and back: the file is gone, but the tab is the user's.
    await files.openFile('wiki/index.md.annotations.json')
    await files.openFile('wiki/index.md')

    expect(files.openTabs).toContain('wiki/index.md')
  })
})

describe('files store — text is decided by the bytes, not the extension', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    fs.setRoot(createMemoryRoot())
    await fs.writeFile('.env', 'OPENAI_API_KEY=sk-test\n')
    await fs.writeFile('wiki/index.md', 'I')
    await fs.writeFile('data/blob.unknown', new Blob([new Uint8Array([1, 0, 2, 0])]))
    await useFilesStore().refreshTree()
  })

  it('opens a file with no known extension as text', async () => {
    const files = useFilesStore()
    await files.openFile('.env')

    expect(files.currentPath).toBe('.env')
    expect(files.content).toBe('OPENAI_API_KEY=sk-test\n')
    expect(files.unreadable).toBe(null)
  })

  it('shows the placeholder instead of mojibake when the bytes are binary', async () => {
    const files = useFilesStore()
    await files.openFile('data/blob.unknown')

    expect(files.currentPath).toBe('data/blob.unknown')
    expect(files.unreadable).toBe('binary')
    expect(files.content).toBe('')
    // No editor is mounted over it, and nothing can save an empty buffer back.
    files.onEdited('clobber')
    expect(files.saveState).toBe('saved')
    expect(files.content).toBe('')
  })

  it('clears the placeholder when the next file is readable', async () => {
    const files = useFilesStore()
    await files.openFile('data/blob.unknown')
    await files.openFile('wiki/index.md')

    expect(files.unreadable).toBe(null)
    expect(files.content).toBe('I')
  })

  it('picks the file up once its bytes become text', async () => {
    const files = useFilesStore()
    await files.openFile('data/blob.unknown')
    await fs.writeFile('data/blob.unknown', 'now text\n')

    await files.reloadIfClean('data/blob.unknown')

    expect(files.unreadable).toBe(null)
    expect(files.content).toBe('now text\n')
  })
})

describe('files store — what a KB opens on with no tabs to restore', () => {
  const today = todayIso()

  beforeEach(() => {
    setActivePinia(createPinia())
    fs.setRoot(createMemoryRoot())
  })

  it("lands on today's capture page when the day already has one", async () => {
    await fs.writeFile('wiki/index.md', '# Index')
    await fs.writeFile(`raw/daily/${today}.md`, `# ${today}\n\n- something\n`)
    const files = useFilesStore()
    await files.refreshTree()

    await files.restoreTabs()

    expect(files.currentPath).toBe(`raw/daily/${today}.md`)
  })

  it('lands on the index while today is still unwritten — and creates nothing', async () => {
    await fs.writeFile('wiki/index.md', '# Index')
    await fs.writeFile('raw/daily/2020-01-01.md', '# 2020-01-01')
    const files = useFilesStore()
    await files.refreshTree()

    await files.restoreTabs()

    expect(files.currentPath).toBe('wiki/index.md')
    expect(await fs.exists(`raw/daily/${today}.md`)).toBe(false)
  })

  it('leaves the pane empty for a folder that has neither', async () => {
    // A folder of PDFs has no home page, and inventing one for it would be the
    // app grafting its own layout onto someone's folder.
    await fs.writeFile('papers/x.md', '# X')
    const files = useFilesStore()
    await files.refreshTree()

    await files.restoreTabs()

    expect(files.currentPath).toBeNull()
  })
})

describe('files store — the tree selection', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    fs.setRoot(createMemoryRoot())
    await fs.writeFile('wiki/a.md', 'A')
    await fs.writeFile('wiki/b.md', 'B')
    await fs.writeFile('wiki/c.md', 'C')
    await fs.writeFile('raw/x.md', 'X')
    const files = useFilesStore()
    await files.refreshTree()
    files.collapseAll()
  })

  it('reads as a single selection until a modifier says otherwise', () => {
    const files = useFilesStore()
    files.select('wiki/a.md', false)

    expect([...files.selectedPaths]).toEqual(['wiki/a.md'])
    expect(files.selectedPath).toBe('wiki/a.md')
    expect(files.targetDir).toBe('wiki')
  })

  it('adds and removes one row at a time, and the lead follows the last click', () => {
    const files = useFilesStore()
    files.select('wiki/a.md', false)
    files.toggleSelect('raw/x.md', false)

    expect([...files.selectedPaths].sort()).toEqual(['raw/x.md', 'wiki/a.md'])
    // New files land beside the row last picked, not the one picked first.
    expect(files.targetDir).toBe('raw')

    files.toggleSelect('raw/x.md', false)
    expect([...files.selectedPaths]).toEqual(['wiki/a.md'])
  })

  it('ranges over what the tree is drawing, skipping a collapsed folder', () => {
    const files = useFilesStore()
    // raw and wiki are both shut, so the range between them is those two rows —
    // not the four files hidden underneath.
    files.select('raw', true)
    files.extendSelection('wiki', true)

    expect([...files.selectedPaths].sort()).toEqual(['raw', 'wiki'])

    files.toggleDir('wiki')
    files.select('wiki', true)
    files.extendSelection('wiki/b.md', false)
    expect([...files.selectedPaths]).toEqual(['wiki', 'wiki/a.md', 'wiki/b.md'])
  })

  it('re-ranges from the same anchor, so a range can shrink as well as grow', () => {
    const files = useFilesStore()
    files.toggleDir('wiki')
    files.select('wiki/a.md', false)

    files.extendSelection('wiki/c.md', false)
    expect(files.selectedPaths.size).toBe(3)

    files.extendSelection('wiki/b.md', false)
    expect([...files.selectedPaths]).toEqual(['wiki/a.md', 'wiki/b.md'])
  })

  it('ends a backwards range on the clicked row, so the target dir follows the cursor', () => {
    const files = useFilesStore()
    files.toggleDir('wiki')
    files.select('wiki/c.md', false)

    files.extendSelection('wiki/a.md', false)

    expect(files.selectedPath).toBe('wiki/a.md')
    expect(files.selectedPaths.size).toBe(3)
  })

  it('keeps the rest of the selection when one of its rows is deleted', async () => {
    // A batch delete removes its entries one at a time. Clearing the whole
    // selection on the first would strand the ones still to go.
    const files = useFilesStore()
    files.toggleDir('wiki')
    files.select('wiki/a.md', false)
    files.toggleSelect('wiki/b.md', false)

    await files.deleteEntry('wiki/a.md', false)

    expect([...files.selectedPaths]).toEqual(['wiki/b.md'])
  })

  it('drops a folder\'s children from the selection when the folder goes', async () => {
    const files = useFilesStore()
    files.toggleDir('wiki')
    files.select('wiki/a.md', false)
    files.toggleSelect('raw/x.md', false)

    await files.deleteEntry('wiki', true)

    expect([...files.selectedPaths]).toEqual(['raw/x.md'])
  })
})
