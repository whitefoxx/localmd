/**
 * Interactive file operations (prompt/confirm + store mutation + git status
 * refresh) backing the file-tree UI — the "+" button, context menu,
 * drag-to-move.
 *
 * Everything that acts on the tree takes a LIST of rows, even when the user
 * picked one. The file tree lets a selection be several rows, and a batch
 * delete or move is not "the single-row one, N times": it asks once, checks
 * everything before it touches anything, and drops the entries a folder in the
 * same batch is already carrying. Two code paths for one gesture is how the
 * second one ends up asking a different question.
 */
import * as fs from '@/lib/fs'
import { askDelete } from '@/lib/confirmDelete'
import { useFilesStore, type SelectedRow } from '@/stores/files'
import { useGitStore } from '@/stores/git'
import { t } from '@/i18n'

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const dirOf = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

/**
 * Drop rows that a folder in the same batch already carries.
 *
 * Selecting a folder and something inside it is easy to do and means one thing:
 * move/delete the folder. Acting on the child too would either count it twice
 * or, worse, chase a path that stopped existing when its parent moved.
 */
function topLevelOnly(rows: SelectedRow[]): SelectedRow[] {
  const dirs = rows.filter((r) => r.isDir).map((r) => r.path)
  return rows.filter((r) => !dirs.some((d) => d !== r.path && r.path.startsWith(`${d}/`)))
}

/**
 * Drop rows whose file is no longer there.
 *
 * A selection is a list of paths, and paths in this app go stale for reasons
 * that are all normal: the user renamed the file in Finder, the agent moved it,
 * a previous action in this same batch took its parent. The batch then hits a
 * path that is not there, `renameEntry` throws in the middle of the loop, and
 * everything after it silently does not happen — the half-finished state the
 * pre-flight checks exist to prevent, arriving through the one door they do not
 * watch. Found by dragging a two-file selection that still held a third row
 * whose folder had gone: nothing moved, and nothing said so.
 */
async function stillThere(rows: SelectedRow[]): Promise<SelectedRow[]> {
  const out: SelectedRow[] = []
  for (const r of rows) if ((await fs.statKind(r.path)) !== null) out.push(r)
  return out
}

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
  const name = prompt(t('files.newFilePrompt'))?.trim()
  if (!name) return
  const rel = files.targetDir ? `${files.targetDir}/${name}` : name
  const path = /\.[^/]+$/.test(rel) ? rel : `${rel}.md`
  const stem = path.split('/').pop()!.replace(/\.md$/, '')
  await files.createFile(path, path.endsWith('.md') ? `# ${stem}\n\n` : '')
  refreshGitStatus()
}

/**
 * Move rows into `targetDir` ('' = KB root).
 *
 * Every check runs before the first rename, and a failed one cancels the whole
 * batch. There is no undo behind this: a move that stops halfway leaves the
 * folder in a state neither the user nor we asked for, and the user is the one
 * who has to work out which half happened.
 */
export async function moveRows(rows: SelectedRow[], targetDir: string): Promise<void> {
  const files = useFilesStore()
  const wanted = topLevelOnly(rows).filter((r) => dirOf(r.path) !== targetDir)
  const moving = await stillThere(wanted)
  if (!moving.length) return

  const intoSelf = moving.find(
    (r) => r.isDir && (targetDir === r.path || targetDir.startsWith(`${r.path}/`)),
  )
  if (intoSelf) {
    window.alert(t('files.moveIntoSelf', { name: nameOf(intoSelf.path) }))
    return
  }
  if (targetDir && (await fs.statKind(targetDir)) !== 'dir') {
    window.alert(t('files.moveNoTarget', { dir: targetDir }))
    return
  }
  const where = targetDir || t('files.kbRoot')
  for (const r of moving) {
    const name = nameOf(r.path)
    if (await fs.exists(targetDir ? `${targetDir}/${name}` : name)) {
      window.alert(t('files.moveExists', { name, dir: where }))
      return
    }
  }

  const landed: SelectedRow[] = []
  for (const r of moving) {
    const dest = targetDir ? `${targetDir}/${nameOf(r.path)}` : nameOf(r.path)
    try {
      await files.renameEntry(r.path, dest, r.isDir)
    } catch (err) {
      console.error('move failed', r.path, err)
      window.alert(t('files.moveFailed', { name: nameOf(r.path) }))
      break
    }
    landed.push({ path: dest, isDir: r.isDir })
  }
  if (!landed.length) return
  // `renameEntry` selects each row as it lands, so without this a batch move
  // ends with only its last entry highlighted — the selection the user is
  // still working with, quietly reduced to one.
  files.selectMany(landed)
  refreshGitStatus()
}

/** Ask where to move, then move. The current folder is the default, so the
 *  prompt opens on the answer to "where am I" and is edited from there. */
export async function moveInteractive(rows: SelectedRow[]): Promise<void> {
  if (!rows.length) return
  const answer = prompt(t('files.moveToPrompt'), dirOf(rows[rows.length - 1]!.path))
  if (answer === null) return // cancelled — distinct from "" (the KB root)
  await moveRows(rows, answer.trim().replace(/^\/+|\/+$/g, ''))
}

/**
 * How many files live under a folder, read off the tree already in memory.
 *
 * Undercounts by whatever sits in a hidden subdirectory (`.git`, `.obsidian`,
 * `node_modules` — see IGNORED in lib/fs): those are not in the tree, and
 * `removeDir` is recursive, so it takes them anyway. The number is here to
 * convey scale, and one that is slightly low is still the whole difference
 * between "4 items" and "4 items, and the 431 files inside two of them".
 */
function fileCount(dir: string, all: string[]): number {
  const prefix = `${dir}/`
  return all.filter((p) => p.startsWith(prefix)).length
}

/**
 * Ask, then delete what came back.
 *
 * The user gets the list itself rather than a sentence about it, and can take
 * rows back out of the batch — so what is deleted is what they were looking at
 * when they clicked, not what was selected when the menu opened. An empty
 * answer is a complete answer: it means no.
 */
export async function deleteRows(rows: SelectedRow[]): Promise<void> {
  const files = useFilesStore()
  const doomed = await stillThere(topLevelOnly(rows))
  if (!doomed.length) return
  const all = files.allFiles
  const picked = await askDelete(
    doomed.map((r) => ({
      path: r.path,
      isDir: r.isDir,
      files: r.isDir ? fileCount(r.path, all) : 0,
    })),
  )
  if (!picked.length) return
  for (const c of picked) {
    try {
      await files.deleteEntry(c.path, c.isDir)
    } catch (err) {
      console.error('delete failed', c.path, err)
      window.alert(t('files.deleteFailed', { name: nameOf(c.path) }))
      break
    }
  }
  refreshGitStatus()
}

/* ── the drag payload ─────────────────────────────────────────────────────── */

/**
 * What a tree drag carries: the rows being moved, as JSON.
 *
 * One definition, read by the rows and by the blank space around them. It used
 * to be two loose string literals repeated in both files, which worked right up
 * until the payload needed a second field.
 */
export const DRAG_ROWS = 'application/x-bmd-rows'

export function writeDragRows(dt: DataTransfer, rows: SelectedRow[]): void {
  dt.effectAllowed = 'move'
  dt.setData(DRAG_ROWS, JSON.stringify(rows))
}

/** The rows out of a drop — empty for anything that is not one of ours. */
export function readDragRows(dt: DataTransfer | null): SelectedRow[] {
  try {
    const raw: unknown = JSON.parse(dt?.getData(DRAG_ROWS) ?? '')
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (r: unknown): r is SelectedRow =>
        !!r &&
        typeof (r as SelectedRow).path === 'string' &&
        typeof (r as SelectedRow).isDir === 'boolean',
    )
  } catch {
    return []
  }
}
