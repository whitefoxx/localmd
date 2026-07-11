/** Minimal LCS-based line diff for the review panel. */

export interface DiffLine {
  type: 'same' | 'add' | 'del'
  text: string
}

export type HunkLine = DiffLine | { type: 'skip'; count: number }

/** Collapse long runs of unchanged lines to `skip` markers, keeping `context`
 *  lines around each change — so the changed lines are findable in big files.
 *  A diff with no changes at all is returned untouched. */
export function collapseContext(lines: DiffLine[], context = 3): HunkLine[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  let hasChanges = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === 'same') continue
    hasChanges = true
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
      keep[j] = true
    }
  }
  if (!hasChanges) return lines
  const out: HunkLine[] = []
  let skipped = 0
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) {
      if (skipped > 0) {
        out.push({ type: 'skip', count: skipped })
        skipped = 0
      }
      out.push(lines[i])
    } else {
      skipped++
    }
  }
  if (skipped > 0) out.push({ type: 'skip', count: skipped })
  return out
}

const MAX_CELLS = 4_000_000

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')

  // Guard against O(n*m) blowup on huge files: degenerate to full replace.
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text) => ({ type: 'del' as const, text })),
      ...b.map((text) => ({ type: 'add' as const, text })),
    ]
  }

  // LCS table (single-dimension rows to keep memory flat-ish).
  const n = a.length
  const m = b.length
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}
