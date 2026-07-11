/**
 * Exact-string edits for the agent's edit_file tool (Claude Code semantics):
 * old_string must match exactly and — unless replaceAll — uniquely, so the
 * model can't silently clobber the wrong occurrence.
 */

export type EditResult = { ok: true; content: string; count: number } | { ok: false; error: string }

export function applyEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): EditResult {
  if (!oldString) return { ok: false, error: 'old_string must not be empty' }
  if (oldString === newString) {
    return { ok: false, error: 'old_string and new_string are identical' }
  }
  const count = content.split(oldString).length - 1
  if (count === 0) {
    return { ok: false, error: 'old_string not found in the file — read the file again and copy the text exactly (whitespace matters)' }
  }
  if (count > 1 && !replaceAll) {
    return {
      ok: false,
      error: `old_string occurs ${count} times — provide a longer unique snippet, or set replace_all to true`,
    }
  }
  return { ok: true, content: content.split(oldString).join(newString), count }
}
