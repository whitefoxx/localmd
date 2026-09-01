/**
 * Writing a jot to today's capture page — the one write behind the palette's
 * `:` mode (see lib/daily for what a capture page is and where it lives).
 *
 * Two paths on purpose. When today's page is the file on screen, the append
 * goes through the editor buffer: writing the file underneath a dirty buffer
 * would be overwritten by the next autosave, and the jot would disappear with
 * no error anywhere — the one failure a capture surface may not have. Any
 * other time it is a plain read-modify-write.
 */
import * as fs from '@/lib/fs'
import { openInEditor } from '@/lib/openInEditor'
import { useFilesStore } from '@/stores/files'
import { usesRawLayout } from '@/lib/capture'
import { syncAfterFsChange } from '@/lib/fileOps'
import { todayIso, resolveDailyPath, appendJot, emptyDailyPage } from '@/lib/daily'

/** Where a jot written now would land. Resolved against the current tree, so
 *  it answers before anything is written — the palette shows it, and showing
 *  it is what makes the write predictable rather than a guess. */
export async function todayPath(now?: Date): Promise<string> {
  const files = useFilesStore()
  return resolveDailyPath(todayIso(now), files.allFiles, await usesRawLayout())
}

/**
 * Open today's capture page in edit mode, creating it when today has none.
 *
 * The jot line is for one thought in passing; this is for sitting down in the
 * page itself. Note where the file comes from: this keystroke, or a jot —
 * never a schedule. A day nobody wrote anything has no page, which is what
 * keeps a folder of them worth opening.
 */
export async function openTodayPage(now?: Date): Promise<void> {
  const files = useFilesStore()
  const path = await todayPath(now)
  if (await fs.exists(path)) await openInEditor(path)
  else await files.createFile(path, emptyDailyPage(todayIso(now)))
  files.mode = 'edit'
}

/** Append a line to today's capture page. Returns where it went, or null when
 *  there was nothing to write. */
export async function jotToday(text: string, now?: Date): Promise<string | null> {
  if (!text.trim()) return null
  const files = useFilesStore()
  const date = todayIso(now)
  const path = resolveDailyPath(date, files.allFiles, await usesRawLayout())

  if (files.currentPath === path && !files.unreadable) {
    files.onEdited(appendJot(files.content, text, date))
    await files.flush() // a jot is durable the moment it is made, not 800ms later
  } else {
    const existing = (await fs.tryReadFile(path)) ?? ''
    await fs.writeFile(path, appendJot(existing, text, date))
    await syncAfterFsChange()
  }
  return path
}
