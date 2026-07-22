/**
 * Interactive file operations (prompt/confirm + store mutation + git status
 * refresh), shared by the file-tree UI and the global hotkeys so both paths
 * behave identically.
 */
import * as fs from '@/lib/fs'
import { useFilesStore } from '@/stores/files'
import { useGitStore } from '@/stores/git'

/** File operations change git status immediately — refresh so the tree's
 *  U/M/D decorations don't show a stale snapshot until the next focus. */
export function refreshGitStatus(): void {
  const git = useGitStore()
  if (git.isRepo) void git.refresh()
}

/** Prompt for a name and create a file in the tree's target dir (selected
 *  folder / selected file's parent / KB root). Extensionless names get .md. */
export async function newFileInteractive(): Promise<void> {
  const files = useFilesStore()
  const name = prompt('New file name (e.g. idea.md):')?.trim()
  if (!name) return
  const rel = files.targetDir ? `${files.targetDir}/${name}` : name
  const path = /\.[^/]+$/.test(rel) ? rel : `${rel}.md`
  const stem = path.split('/').pop()!.replace(/\.md$/, '')
  await files.createFile(path, path.endsWith('.md') ? `# ${stem}\n\n` : '')
  refreshGitStatus()
}

/** Move a file/dir into targetDir ('' = KB root). No-ops when it's already
 *  there or would move a directory into itself; refuses name collisions. */
export async function moveEntry(source: string, isDir: boolean, targetDir: string): Promise<void> {
  const files = useFilesStore()
  const name = source.slice(source.lastIndexOf('/') + 1)
  const parent = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : ''
  if (parent === targetDir) return
  if (isDir && (targetDir === source || targetDir.startsWith(`${source}/`))) return
  const dest = targetDir ? `${targetDir}/${name}` : name
  if (await fs.exists(dest)) {
    window.alert(`${name} already exists under "${targetDir || 'KB root'}"; move cancelled`)
    return
  }
  await files.renameEntry(source, dest, isDir)
  refreshGitStatus()
}

/** The entry hotkeys operate on: the tree selection, or the open file. */
function hotkeyTarget(): { path: string; isDir: boolean } | null {
  const files = useFilesStore()
  if (files.selectedPath) return { path: files.selectedPath, isDir: files.selectedIsDir }
  if (files.currentPath) return { path: files.currentPath, isDir: false }
  return null
}

/** Hotkey: move the selected entry (or current file) via a directory prompt.
 *  A missing target directory is created implicitly by the write. */
export async function moveInteractive(): Promise<void> {
  const t = hotkeyTarget()
  if (!t) return
  const parent = t.path.includes('/') ? t.path.slice(0, t.path.lastIndexOf('/')) : ''
  const input = prompt(`Move "${t.path}" to directory (empty = KB root):`, parent)
  if (input === null) return
  await moveEntry(t.path, t.isDir, input.trim().replace(/^\/+|\/+$/g, ''))
}

/** Confirm-then-delete; used by the context menu and the ⌘D hotkey. */
export async function deleteInteractive(path: string, isDir: boolean): Promise<void> {
  const files = useFilesStore()
  const what = isDir ? 'folder (and its contents)' : 'file'
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (!confirm(`Delete ${what} “${name}”? This cannot be undone.`)) return
  await files.deleteEntry(path, isDir)
  refreshGitStatus()
}

/** Hotkey: delete the selected entry (or current file). */
export async function deleteSelectedInteractive(): Promise<void> {
  const t = hotkeyTarget()
  if (t) await deleteInteractive(t.path, t.isDir)
}
