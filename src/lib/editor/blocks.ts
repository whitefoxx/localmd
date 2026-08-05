/**
 * Line-level markdown editing: task items, headings, and fence completion.
 *
 * Pure over EditorState (see marks.ts for why). Line commands act on every
 * line the selection touches and are *uniform*: if every touched line is
 * already a task/heading the command removes it, otherwise it applies to all.
 * Toggling line by line instead would scramble a mixed selection into the
 * inverse of itself, which is never what anyone means by pressing the key
 * once.
 */
import type { EditorState, Line, TransactionSpec } from '@codemirror/state'

/** Every line the selection touches, in order, without repeats. */
function touchedLines(state: EditorState): Line[] {
  const lines: Line[] = []
  let last = -1
  for (const range of state.selection.ranges) {
    for (let pos = range.from; ; ) {
      const line = state.doc.lineAt(pos)
      if (line.number > last) {
        lines.push(line)
        last = line.number
      }
      if (line.to >= range.to) break
      pos = line.to + 1
    }
  }
  return lines
}

const TASK = /^(\s*)([-*+])(\s+)\[([ xX])\]\s/
const BULLET = /^(\s*)([-*+])(\s+)/
const HEADING = /^(\s*)(#{1,6})\s+/

/**
 * Turn the touched lines into task items, or back into plain lines when they
 * all already are. Existing bullets keep their marker and indentation.
 */
export function toggleTaskItem(state: EditorState): TransactionSpec {
  const lines = touchedLines(state)
  const allTasks = lines.every((l) => TASK.test(l.text))
  const changes = []

  for (const line of lines) {
    const task = TASK.exec(line.text)
    if (allTasks && task) {
      // Back to a plain bullet: drop just the `[ ] ` box.
      const boxAt = line.from + task[1].length + task[2].length + task[3].length
      changes.push({ from: boxAt, to: boxAt + 4, insert: '' })
      continue
    }
    if (task) continue // mixed selection: this one is already a task
    const bullet = BULLET.exec(line.text)
    if (bullet) {
      const at = line.from + bullet[0].length
      changes.push({ from: at, insert: '[ ] ' })
    } else {
      const indent = /^\s*/.exec(line.text)![0].length
      changes.push({ from: line.from + indent, insert: '- [ ] ' })
    }
  }
  return { changes }
}

/** Check/uncheck the touched task lines. Uniform, like toggleTaskItem. */
export function toggleTaskDone(state: EditorState): TransactionSpec | null {
  const lines = touchedLines(state).filter((l) => TASK.test(l.text))
  if (!lines.length) return null
  const allDone = lines.every((l) => /^\s*[-*+]\s+\[[xX]\]\s/.test(l.text))
  const changes = lines.map((line) => {
    const m = TASK.exec(line.text)!
    const at = line.from + m[1].length + m[2].length + m[3].length + 1
    return { from: at, to: at + 1, insert: allDone ? ' ' : 'x' }
  })
  return { changes }
}

/**
 * Set the touched lines to heading `level`, or strip the heading when they are
 * all already at that level (so the same key toggles). Level 0 always strips.
 */
export function setHeading(state: EditorState, level: number): TransactionSpec {
  const lines = touchedLines(state)
  const hashes = '#'.repeat(level)
  const strip =
    level === 0 || lines.every((l) => HEADING.exec(l.text)?.[2].length === level)
  const changes = []

  for (const line of lines) {
    const m = HEADING.exec(line.text)
    const from = line.from + (m ? m[1].length : /^\s*/.exec(line.text)![0].length)
    const to = from + (m ? m[0].length - m[1].length : 0)
    const insert = strip ? '' : `${hashes} `
    if (to > from || insert) changes.push({ from, to, insert })
  }
  return { changes }
}

/** Is `line` inside an open fenced code block? Counts fence toggles above it. */
function insideFence(state: EditorState, lineNumber: number): boolean {
  let open = false
  for (let n = 1; n < lineNumber; n++) {
    if (/^ {0,3}(```|~~~)/.test(state.doc.line(n).text)) open = !open
  }
  return open
}

/**
 * Completing a ``` fence: typing the third backtick on an otherwise empty line
 * writes the closing fence too and leaves the cursor on the blank line between
 * them. Returns null when the input is anything else, so the caller falls
 * through to normal typing.
 *
 * Skipped inside an open fence — there the third backtick is the user closing
 * it by hand, and helpfully adding another pair would be maddening.
 */
export function completeFence(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): TransactionSpec | null {
  if (text !== '`' || from !== to) return null
  const line = state.doc.lineAt(from)
  const before = line.text.slice(0, from - line.from)
  const after = line.text.slice(from - line.from)
  if (!/^ {0,3}``$/.test(before) || after !== '') return null
  if (insideFence(state, line.number)) return null
  return {
    changes: { from, to, insert: '`\n\n```' },
    selection: { anchor: from + 2 },
    scrollIntoView: true,
  }
}
