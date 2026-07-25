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
