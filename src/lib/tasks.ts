/**
 * Ticking a task list item off from the rendered page.
 *
 * The rendered checkbox and the source line have to agree about WHICH item was
 * clicked, and the only thing they can agree on cheaply is an ordinal: the
 * renderer numbers checkboxes in document order, this numbers task lines in
 * the same order. So the two counts must skip the same things — which in
 * practice means fenced code, where `- [ ] not a task` is a sample someone
 * wrote about task lists rather than a task.
 *
 * Kept pure and here rather than in the preview so both halves of that
 * agreement can be tested without a browser.
 */

/** A task list item: any bullet, a box, a space. Indented ones count — a
 *  sub-task is a task. */
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s)/
const FENCE_RE = /^\s*(```|~~~)/

/**
 * The source line index of every task item, in document order.
 *
 * Lines inside a fenced block are skipped, because the renderer does not draw
 * a checkbox for them either — count them here and every tick after the first
 * code sample would land on the wrong line.
 */
export function taskLines(content: string): number[] {
  const out: number[] = []
  let fence: string | null = null
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_RE.exec(lines[i])
    if (fence) {
      if (open && lines[i].trimStart().startsWith(fence)) fence = null
      continue
    }
    if (open) {
      fence = open[1]
      continue
    }
    if (TASK_RE.test(lines[i])) out.push(i)
  }
  return out
}

/**
 * Flip the nth task item, or return null when there is no such item.
 *
 * Null rather than a no-op edit on purpose: it means the render that was
 * clicked no longer describes the text (someone edited it underneath, or the
 * file was reloaded), and writing anything back on that basis would tick a
 * line nobody pointed at.
 */
export function toggleTask(content: string, nth: number): string | null {
  const at = taskLines(content)[nth]
  if (at === undefined) return null
  const lines = content.split('\n')
  lines[at] = lines[at].replace(TASK_RE, (_m, head: string, box: string, tail: string) =>
    `${head}${box === ' ' ? 'x' : ' '}${tail}`,
  )
  return lines.join('\n')
}
