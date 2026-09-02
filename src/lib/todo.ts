/**
 * The palette's `[]` mode: one line onto the knowledge base's todo list.
 *
 * The same shape as a jot (lib/jot) and for the same reason — the palette is
 * the only surface reachable without leaving what you were doing, which is the
 * whole of why a passing "I should…" gets written down at all. Two paths on
 * purpose: when the list is the file on screen the append goes through the
 * editor buffer, because writing the file underneath a dirty buffer would be
 * overwritten by the next autosave and the item would vanish with no error
 * anywhere. Any other time it is a plain read-modify-write.
 */
import * as fs from '@/lib/fs'
import { openInEditor } from '@/lib/openInEditor'
import { useFilesStore } from '@/stores/files'
import { syncAfterFsChange } from '@/lib/fileOps'

/**
 * Where todos live: one well-known file at the root of the folder.
 *
 * Not a hidden one, and not a store only this app can read. A list you cannot
 * find is a list you stop keeping, and `- [ ] …` is a GFM task list — GitHub,
 * Obsidian, any editor's preview and every agent already render and tick it.
 * Nothing here is ours alone, which is the point: leaving costs nothing.
 */
export const TODOS_PATH = 'todos.md'

export function emptyTodos(): string {
  return '# Todos\n\n'
}

/**
 * Append items to the list, as task-list lines.
 *
 * Pure, so what the file ends up looking like is testable without a folder.
 * A line that already carries its own bullet or checkbox is left as the user
 * typed it — pasting `- [x] done` should not become `- [ ] - [x] done`.
 */
export function appendTodo(content: string, text: string): string {
  const items = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^([-*+]|\d+\.)\s/.test(l) ? l : `- [ ] ${l}`))
  if (!items.length) return content
  const head = content.trim() ? `${content.replace(/\s+$/, '')}\n` : emptyTodos()
  return `${head}${items.join('\n')}\n`
}

/** Add a line to the todo list. Returns where it went, or null when there was
 *  nothing to write. */
export async function addTodo(text: string): Promise<string | null> {
  if (!text.trim()) return null
  const files = useFilesStore()
  if (files.currentPath === TODOS_PATH && !files.unreadable) {
    files.onEdited(appendTodo(files.content, text))
    await files.flush() // durable the moment it is made, not 800ms later
  } else {
    const existing = (await fs.tryReadFile(TODOS_PATH)) ?? ''
    await fs.writeFile(TODOS_PATH, appendTodo(existing, text))
    await syncAfterFsChange()
  }
  return TODOS_PATH
}

/** Open the list itself, creating it when there is none. The `[]` line is for
 *  one thing in passing; this is for going through them. */
export async function openTodos(): Promise<void> {
  const files = useFilesStore()
  if (await fs.exists(TODOS_PATH)) await openInEditor(TODOS_PATH)
  else await files.createFile(TODOS_PATH, emptyTodos())
  files.mode = 'edit'
}
