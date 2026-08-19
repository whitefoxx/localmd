/**
 * Interactive file operations (prompt/confirm + store mutation + git status
 * refresh) backing the file-tree UI — the "+" button, context menu, drag-to-move.
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

/**
 * What the UI owes any filesystem change, wherever it came from: the tree
 * re-scanned and, in a repo, git status re-read.
 *
 * The interactive helpers below have always done both. The agent's writes did
 * only the first — so a file it created appeared in the tree straight away
 * while its "new file" tint arrived whenever something else happened to ask
 * git, which is the half of "sometimes it syncs, sometimes I have to refresh"
 * that is not about dropped refreshes. One function so a new write path cannot
 * remember one and forget the other.
 *
 * Both halves are coalesced (lib/async), so calling this after every write in
 * a busy turn costs one visible pass, not one per file.
 */
export async function syncAfterFsChange(): Promise<void> {
  await useFilesStore().refreshTree()
  refreshGitStatus()
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

/** Confirm-then-delete; used by the file-tree context menu. */
export async function deleteInteractive(path: string, isDir: boolean): Promise<void> {
  const files = useFilesStore()
  const what = isDir ? 'folder (and its contents)' : 'file'
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (!confirm(`Delete ${what} “${name}”? This cannot be undone.`)) return
  await files.deleteEntry(path, isDir)
  refreshGitStatus()
}
