import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import * as fs from '@/lib/fs'
import { createMemoryRoot } from '@/lib/memfs'
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

    files.revealPath('.trace/pdf-index/foo/toc.md')

    expect(files.selectedPath).toBe('AGENTS.md')
    expect(files.expandedDirs.has('.trace')).toBe(false)
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
