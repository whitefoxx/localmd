import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as fs from '@/lib/fs'
import { fileStem } from '@/lib/wiki'
import type { TreeNode } from '@/lib/fs'

export type SaveState = 'saved' | 'dirty' | 'saving'

const AUTOSAVE_MS = 800

export const useFilesStore = defineStore('files', () => {
  const tree = ref<TreeNode[]>([])
  const currentPath = ref<string | null>(null)
  const content = ref('')
  const saveState = ref<SaveState>('saved')
  const mode = ref<'edit' | 'preview'>('preview')

  /** Disk mtime of the current file at load/save time, for external-change detection. */
  let loadedMtime: number | null = null
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null

  const allFiles = computed(() => fs.collectFiles(tree.value))
  const mdFiles = computed(() => allFiles.value.filter((p) => p.endsWith('.md')))

  /** stem (lowercased) → path, for wikilink resolution. First match wins;
   *  wiki/ pages take priority over other dirs. */
  const stemIndex = computed(() => {
    const map = new Map<string, string>()
    const ordered = [...mdFiles.value].sort((a, b) => {
      const aw = a.startsWith('wiki/') ? 0 : 1
      const bw = b.startsWith('wiki/') ? 0 : 1
      return aw - bw
    })
    for (const p of ordered) {
      const stem = fileStem(p).toLowerCase()
      if (!map.has(stem)) map.set(stem, p)
    }
    return map
  })

  function resolveWikilink(target: string): string | null {
    return stemIndex.value.get(target.trim().toLowerCase()) ?? null
  }

  async function refreshTree(): Promise<void> {
    if (!fs.hasRoot()) return
    tree.value = await fs.readTree()
  }

  async function openFile(path: string): Promise<void> {
    if (currentPath.value === path) return
    await flush()
    const text = await fs.tryReadFile(path)
    if (text === null) return
    currentPath.value = path
    content.value = text
    loadedMtime = await fs.statMtime(path)
    saveState.value = 'saved'
  }

  function onEdited(next: string): void {
    if (next === content.value) return
    content.value = next
    saveState.value = 'dirty'
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => void flush(), AUTOSAVE_MS)
  }

  /** Persist the buffer now if dirty. */
  async function flush(): Promise<void> {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    }
    if (saveState.value !== 'dirty' || !currentPath.value) return
    saveState.value = 'saving'
    try {
      await fs.writeFile(currentPath.value, content.value)
      loadedMtime = await fs.statMtime(currentPath.value)
      saveState.value = 'saved'
    } catch (err) {
      saveState.value = 'dirty'
      throw err
    }
  }

  /**
   * Window-focus refresh: re-scan the tree, and if the current file changed on
   * disk (e.g. edited in Obsidian) while our buffer is clean, reload it.
   * The Access API has no watcher, so focus-time polling is the substitute.
   */
  async function refreshOnFocus(): Promise<void> {
    if (!fs.hasRoot()) return
    await refreshTree()
    if (!currentPath.value || saveState.value !== 'saved') return
    const mtime = await fs.statMtime(currentPath.value)
    if (mtime !== null && loadedMtime !== null && mtime > loadedMtime) {
      const text = await fs.tryReadFile(currentPath.value)
      if (text !== null) {
        content.value = text
        loadedMtime = mtime
      }
    } else if (mtime === null) {
      // File was deleted externally.
      currentPath.value = null
      content.value = ''
    }
  }

  async function createFile(path: string, initial = ''): Promise<void> {
    await fs.writeFile(path, initial)
    await refreshTree()
    await openFile(path)
    mode.value = 'edit'
  }

  function closeCurrent(): void {
    currentPath.value = null
    content.value = ''
    saveState.value = 'saved'
  }

  function reset(): void {
    tree.value = []
    closeCurrent()
  }

  return {
    tree,
    currentPath,
    content,
    saveState,
    mode,
    mdFiles,
    resolveWikilink,
    refreshTree,
    openFile,
    onEdited,
    flush,
    refreshOnFocus,
    createFile,
    closeCurrent,
    reset,
  }
})
