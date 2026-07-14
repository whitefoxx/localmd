import type { FileChange } from '@/lib/git'

/**
 * VS Code–style decoration for a git change kind — the name/letter color and
 * the single-letter status marker. Shared by the file tree and the Git panel
 * so both read the same: new = green U, modified = orange M, deleted = red D.
 */
export const GIT_DECOR: Record<FileChange['kind'], { class: string; letter: string }> = {
  new: { class: 'text-added', letter: 'U' },
  // Softer amber for "modified": bright yellow was harsh, orange read as red.
  modified: { class: 'text-amber-600 dark:text-amber-300/90', letter: 'M' },
  deleted: { class: 'text-removed', letter: 'D' },
}
