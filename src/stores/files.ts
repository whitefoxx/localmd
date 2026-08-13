import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import * as fs from '@/lib/fs'
import { invalidateGitFsCache } from '@/lib/gitfs'
import { fileStem, dirName } from '@/lib/wiki'
import { fileKind } from '@/lib/filetypes'
import { isAnnotationsPath } from '@/lib/annotations'
import { readTabs, writeTabs } from '@/lib/tabsMemory'
import type { TreeNode } from '@/lib/fs'

function isTextual(path: string): boolean {
  const kind = fileKind(path)
  return kind === 'markdown' || kind === 'text'
}

export type SaveState = 'saved' | 'dirty' | 'saving'

const AUTOSAVE_MS = 800

export const useFilesStore = defineStore('files', () => {
  const tree = ref<TreeNode[]>([])
  const currentPath = ref<string | null>(null)
  /** Open file tabs, in opening order. Buffers always flush on switch, so a
   *  tab is just a path — content loads when it becomes current. */
  const openTabs = ref<string[]>([])
  const content = ref('')
  const saveState = ref<SaveState>('saved')
  const mode = ref<'edit' | 'preview'>('preview')
  /** The tree node the user has selected (file OR directory) — drives the row
   *  highlight and is the target for new files/folders/imports. '' = nothing
   *  selected (= KB root). Cleared by clicking blank space in the tree. */
  const selectedPath = ref('')
  const selectedIsDir = ref(false)
  /** Directory new items land in: the selected folder, a selected file's
   *  parent, or '' (KB root) when nothing is selected. */
  const targetDir = computed(() => {
    if (!selectedPath.value) return ''
    if (selectedIsDir.value) return selectedPath.value
    const i = selectedPath.value.lastIndexOf('/')
    return i < 0 ? '' : selectedPath.value.slice(0, i)
  })

  function select(path: string, isDir: boolean): void {
    selectedPath.value = path
    selectedIsDir.value = isDir
  }
  function clearSelection(): void {
    selectedPath.value = ''
    selectedIsDir.value = false
  }
  /** Set of directory paths currently expanded in the file tree. Centralized so
   *  "collapse all" is a single clear() rather than per-node signalling. */
  const expandedDirs = ref(new Set<string>())
  /** Seed top-level folders open exactly once per KB — not on every refresh, so
   *  collapse-all survives a later refresh/focus. */
  let expansionSeeded = false
  /** Gate for tab persistence: false until restoreTabs() has run for the open
   *  KB, so the empty state during a KB switch/close can't clobber saved tabs. */
  let tabsReady = false

  /**
   * Point the tree at `path`: expand the folders on the way to it and make it
   * THE selected row (selection is single, so every other highlight drops).
   * The state half of "reveal the active file" — FileTree does the scrolling.
   * Paths the tree doesn't show (.trace/, .git/) are ignored: selecting a row
   * that isn't rendered would only strand `targetDir` inside a hidden folder.
   */
  function revealPath(path: string): void {
    if (!allFiles.value.includes(path)) return
    const segs = path.split('/')
    segs.pop()
    let dir = ''
    for (const seg of segs) {
      dir = dir ? `${dir}/${seg}` : seg
      expandedDirs.value.add(dir)
    }
    select(path, false)
  }

  function toggleDir(path: string): void {
    const s = expandedDirs.value
    if (s.has(path)) s.delete(path)
    else s.add(path)
  }

  function collapseAll(): void {
    expandedDirs.value.clear()
  }

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
    const t = target.trim()
    // Path-style targets ([[wiki/entities/foo]]) resolve as KB paths directly.
    if (t.includes('/')) {
      const withExt = t.endsWith('.md') ? t : `${t}.md`
      if (mdFiles.value.includes(withExt)) return withExt
      if (allFiles.value.includes(t)) return t
    }
    return stemIndex.value.get(t.toLowerCase()) ?? null
  }

  /**
   * Resolve a standard markdown-link href from the linking file to a KB path.
   * Absolute hrefs (`/tables/x.md`) are bundle-relative — bundle root == KB
   * root, per OKF. Relative hrefs (`./x`, `../y`, `x`) resolve against the
   * linking file's own directory, with `..`/`.` segments applied. Returns the
   * KB path if the target (or target + `.md`) exists, else null.
   */
  function resolveMarkdownLink(fromPath: string, href: string): string | null {
    let h = decodeURIComponent(href.trim()).replace(/[?#].*$/, '')
    if (!h) return null
    const parts = h.startsWith('/') ? [] : dirName(fromPath).split('/').filter(Boolean)
    if (h.startsWith('/')) h = h.slice(1)
    for (const seg of h.split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') parts.pop()
      else parts.push(seg)
    }
    const rel = parts.join('/')
    if (!rel) return null
    if (allFiles.value.includes(rel)) return rel
    const withExt = `${rel}.md`
    return mdFiles.value.includes(withExt) ? withExt : null
  }

  async function refreshTree(): Promise<void> {
    if (!fs.hasRoot()) return
    tree.value = await fs.readTree()
    if (!expansionSeeded) {
      for (const n of tree.value) if (n.kind === 'dir') expandedDirs.value.add(n.path)
      expansionSeeded = true
    }
  }

  function currentKbName(): string | null {
    return fs.hasRoot() ? fs.getRoot().name : null
  }

  /**
   * Reopen the tabs persisted for the current KB, dropping any whose file no
   * longer exists, then focus the previously-active tab. Call once after the
   * tree has loaded; it also enables tab persistence for this session.
   */
  async function restoreTabs(): Promise<void> {
    const kb = currentKbName()
    const saved = kb ? readTabs(kb) : null
    if (saved) {
      const exist = new Set(allFiles.value)
      const survivors = saved.tabs.filter((p) => exist.has(p))
      openTabs.value = survivors
      const active =
        saved.active && survivors.includes(saved.active) ? saved.active : (survivors[0] ?? null)
      if (active) {
        currentPath.value = null // force a load even if it equals a stale value
        await openFile(active)
      }
    }
    tabsReady = true
  }

  // Persist the working set whenever it changes (once restoreTabs has run, so a
  // KB switch's transient empty state can't overwrite the saved tabs).
  watch(
    () => JSON.stringify({ t: openTabs.value, a: currentPath.value }),
    () => {
      if (!tabsReady) return
      const kb = currentKbName()
      if (kb) writeTabs(kb, { tabs: openTabs.value, active: currentPath.value })
    },
  )

  /** One-shot request for the editor to scroll to and select a substring —
   *  used to jump straight to a broken link's location from the health panel.
   *  The editor consumes it by the monotonic nonce; a stale value is harmless. */
  const reveal = ref<{ path: string; target: string; nonce: number } | null>(null)
  let revealNonce = 0

  /** Open `path` in edit mode and reveal the first occurrence of `target`
   *  (e.g. a broken `[[link]]`) so it can be fixed in place. */
  async function openAndReveal(path: string, target: string): Promise<void> {
    await openFile(path)
    mode.value = 'edit'
    reveal.value = { path, target, nonce: ++revealNonce }
  }

  async function openFile(path: string): Promise<void> {
    const wasOpen = openTabs.value.includes(path)
    if (!wasOpen) openTabs.value.push(path)
    if (currentPath.value === path) return
    await flush()
    if (isTextual(path)) {
      let text = await fs.tryReadFile(path)
      if (text === null) {
        // An annotations sidecar is only written by the first highlight, so
        // until then "missing" means "nothing highlighted yet" — the reader's
        // View annotations button has to open the empty view rather than do
        // nothing, and the view says so itself.
        if (isAnnotationsPath(path)) text = ''
        else {
          // Nothing to open. Don't leave behind the tab we just created for it;
          // a tab the user already had stays, because its file may come back.
          if (!wasOpen) openTabs.value = openTabs.value.filter((p) => p !== path)
          return
        }
      }
      currentPath.value = path
      content.value = text
      loadedMtime = await fs.statMtime(path)
    } else {
      // Binary formats (image/pdf/epub) are loaded by their viewer components.
      currentPath.value = path
      content.value = ''
      loadedMtime = null
    }
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
    if (!currentPath.value || saveState.value !== 'saved' || !isTextual(currentPath.value)) return
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

  /** Reload the buffer when `path` is the open file and there are no unsaved
   *  edits — used after agent writes and review discards. */
  async function reloadIfClean(path: string): Promise<void> {
    if (currentPath.value !== path || saveState.value !== 'saved' || !isTextual(path)) return
    const text = await fs.tryReadFile(path)
    if (text === null) {
      closeCurrent()
      return
    }
    content.value = text
    loadedMtime = await fs.statMtime(path)
  }

  async function createFile(path: string, initial = ''): Promise<void> {
    await fs.writeFile(path, initial)
    await refreshTree()
    await openFile(path)
    mode.value = 'edit'
  }

  function closeCurrent(): void {
    if (currentPath.value) {
      openTabs.value = openTabs.value.filter((p) => p !== currentPath.value)
    }
    currentPath.value = null
    content.value = ''
    saveState.value = 'saved'
  }

  /** Close a tab; when it is the current file, switch to a neighbor. */
  async function closeTab(path: string): Promise<void> {
    const idx = openTabs.value.indexOf(path)
    if (idx < 0) return
    if (currentPath.value !== path) {
      openTabs.value.splice(idx, 1)
      return
    }
    await flush()
    openTabs.value.splice(idx, 1)
    const neighbor = openTabs.value[Math.min(idx, openTabs.value.length - 1)]
    if (neighbor) {
      currentPath.value = null // force reload even if neighbor === old current
      await openFile(neighbor)
    } else {
      currentPath.value = null
      content.value = ''
      saveState.value = 'saved'
    }
  }

  /** Hotkey tab cycling (⌘[/⌘]): jump to the previous/next open tab, wrapping. */
  async function cycleTab(delta: 1 | -1): Promise<void> {
    const tabs = openTabs.value
    if (tabs.length < 2) return
    const i = currentPath.value ? tabs.indexOf(currentPath.value) : -1
    await openFile(tabs[(i + delta + tabs.length) % tabs.length])
  }

  /** Close a set of tabs at once, switching away from the current file if it is
   *  among them (flushing it first). */
  async function closeTabs(paths: string[]): Promise<void> {
    if (!paths.length) return
    const set = new Set(paths)
    const closingCurrent = currentPath.value !== null && set.has(currentPath.value)
    if (closingCurrent) await flush()
    const curIdx = currentPath.value ? openTabs.value.indexOf(currentPath.value) : -1
    openTabs.value = openTabs.value.filter((p) => !set.has(p))
    if (closingCurrent) {
      currentPath.value = null
      if (openTabs.value.length) {
        await openFile(openTabs.value[Math.min(curIdx, openTabs.value.length - 1)])
      } else {
        content.value = ''
        saveState.value = 'saved'
      }
    }
  }

  async function closeOtherTabs(keep: string): Promise<void> {
    await closeTabs(openTabs.value.filter((p) => p !== keep))
    if (currentPath.value !== keep) await openFile(keep)
  }

  async function closeTabsToRight(from: string): Promise<void> {
    const i = openTabs.value.indexOf(from)
    if (i < 0) return
    await closeTabs(openTabs.value.slice(i + 1))
  }

  /** Close every tab with no unsaved edits — only the current buffer can be
   *  dirty, so it's the sole candidate to keep. */
  async function closeSavedTabs(): Promise<void> {
    const keep = currentPath.value && saveState.value !== 'saved' ? currentPath.value : null
    await closeTabs(openTabs.value.filter((p) => p !== keep))
  }

  async function closeAllTabs(): Promise<void> {
    await closeTabs([...openTabs.value])
  }

  /** Rename a file or directory in place; retargets open tabs and selection. */
  async function renameEntry(oldPath: string, newPath: string, isDir: boolean): Promise<void> {
    if (oldPath === newPath) return
    const underOld = (p: string): boolean => p === oldPath || (isDir && p.startsWith(`${oldPath}/`))
    if (currentPath.value && underOld(currentPath.value)) await flush()
    if (isDir) {
      await fs.renameDir(oldPath, newPath)
      invalidateGitFsCache() // cached handles under the old dir are dead
    } else {
      await fs.renameFile(oldPath, newPath)
    }
    const remap = (p: string): string =>
      p === oldPath ? newPath : underOld(p) ? newPath + p.slice(oldPath.length) : p
    openTabs.value = openTabs.value.map(remap)
    if (currentPath.value) currentPath.value = remap(currentPath.value)
    await refreshTree()
    select(newPath, isDir)
  }

  /** Delete a file or directory; closes affected tabs and clears selection. */
  async function deleteEntry(path: string, isDir: boolean): Promise<void> {
    if (isDir) {
      await fs.removeDir(path)
      invalidateGitFsCache() // cached handles under the removed dir are dead
    } else {
      await fs.removeFile(path)
    }
    const affected = (p: string): boolean => p === path || (isDir && p.startsWith(`${path}/`))
    if (currentPath.value !== null && affected(currentPath.value)) {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer)
        autosaveTimer = null
      }
      currentPath.value = null
      openTabs.value = openTabs.value.filter((p) => !affected(p))
      const next = openTabs.value[openTabs.value.length - 1]
      if (next) await openFile(next)
      else {
        content.value = ''
        saveState.value = 'saved'
      }
    } else {
      openTabs.value = openTabs.value.filter((p) => !affected(p))
    }
    if (affected(selectedPath.value)) clearSelection()
    await refreshTree()
  }

  function reset(): void {
    tabsReady = false // off until the next restoreTabs, so we don't persist [] over saved tabs
    tree.value = []
    openTabs.value = []
    clearSelection()
    expandedDirs.value.clear()
    expansionSeeded = false
    closeCurrent()
  }

  return {
    tree,
    currentPath,
    openTabs,
    closeTab,
    content,
    saveState,
    mode,
    selectedPath,
    selectedIsDir,
    targetDir,
    select,
    clearSelection,
    cycleTab,
    expandedDirs,
    toggleDir,
    collapseAll,
    revealPath,
    renameEntry,
    deleteEntry,
    closeOtherTabs,
    closeTabsToRight,
    closeSavedTabs,
    closeAllTabs,
    mdFiles,
    allFiles,
    resolveWikilink,
    resolveMarkdownLink,
    refreshTree,
    restoreTabs,
    openFile,
    reveal,
    openAndReveal,
    onEdited,
    flush,
    refreshOnFocus,
    reloadIfClean,
    createFile,
    closeCurrent,
    reset,
  }
})
