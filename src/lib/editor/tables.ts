/**
 * Markdown table editing: parse the table under the cursor, move between
 * cells, add and remove rows and columns, and line the pipes up.
 *
 * The editor this capability comes from renders tables visually, so it never
 * needed to touch the text. Ours shows the markdown itself, which makes
 * *textual* alignment the thing that decides whether a table is readable —
 * and alignment has to count CJK characters as two columns wide, or every
 * table a Chinese-writing user makes comes out ragged.
 *
 * Pure over EditorState (see marks.ts for why).
 */
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'

export type Align = 'left' | 'right' | 'center' | null

export interface TableInfo {
  /** Doc line numbers of the first and last line of the table block. */
  firstLine: number
  lastLine: number
  /** Line number of the `|---|` delimiter row. */
  separatorLine: number
  /** Trimmed cell text, header first; the delimiter row is not a row. */
  rows: string[][]
  /** Doc line number for each entry of `rows`. */
  lineNumbers: number[]
  aligns: Align[]
}

/** Display width, counting full-width (CJK, kana, full-width punctuation) as 2. */
export function displayWidth(text: string): number {
  let w = 0
  for (const ch of text) {
    w += /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(
        ch,
      )
        ? 2
        : 1
  }
  return w
}

function padTo(text: string, width: number, align: Align): string {
  const gap = Math.max(0, width - displayWidth(text))
  if (align === 'right') return ' '.repeat(gap) + text
  if (align === 'center') {
    const left = Math.floor(gap / 2)
    return ' '.repeat(left) + text + ' '.repeat(gap - left)
  }
  return text + ' '.repeat(gap)
}

/** Split a row into trimmed cells, honouring `\|` escapes and outer pipes. */
export function splitRow(text: string): string[] {
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      cur += '\\|'
      i++
      continue
    }
    if (text[i] === '|') {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += text[i]
  }
  cells.push(cur)
  // The outer pipes produce an empty string at each end — an empty *cell*
  // between two pipes is not empty, it is whitespace, so this cannot eat one.
  if (cells.length > 1 && cells[0] === '') cells.shift()
  if (cells.length > 1 && cells[cells.length - 1] === '') cells.pop()
  return cells.map((c) => c.trim())
}

const DELIM = /^:?-+:?$/

function parseAligns(text: string): Align[] | null {
  const cells = splitRow(text)
  if (!cells.length || !cells.every((c) => DELIM.test(c))) return null
  return cells.map((c) => {
    const left = c.startsWith(':')
    const right = c.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

function isRowLine(text: string): boolean {
  return text.includes('|') && text.trim() !== ''
}

/** The table containing `pos`, or null. A table needs a delimiter second row. */
export function tableAt(state: EditorState, pos: number): TableInfo | null {
  const line = state.doc.lineAt(pos)
  if (!isRowLine(line.text)) return null

  let firstLine = line.number
  while (firstLine > 1 && isRowLine(state.doc.line(firstLine - 1).text)) firstLine--
  let lastLine = line.number
  while (lastLine < state.doc.lines && isRowLine(state.doc.line(lastLine + 1).text)) lastLine++
  if (lastLine - firstLine < 1) return null

  const separatorLine = firstLine + 1
  const aligns = parseAligns(state.doc.line(separatorLine).text)
  if (!aligns) return null

  const rows: string[][] = []
  const lineNumbers: number[] = []
  for (let n = firstLine; n <= lastLine; n++) {
    if (n === separatorLine) continue
    rows.push(splitRow(state.doc.line(n).text))
    lineNumbers.push(n)
  }
  return { firstLine, lastLine, separatorLine, rows, lineNumbers, aligns }
}

/** Render a table back to text: one line per row, pipes aligned. */
export function renderTable(rows: string[][], aligns: Align[]): string[] {
  const cols = Math.max(aligns.length, ...rows.map((r) => r.length))
  const widths: number[] = []
  for (let c = 0; c < cols; c++) {
    widths[c] = Math.max(3, ...rows.map((r) => displayWidth(r[c] ?? '')))
  }
  const out = rows.map(
    (row) =>
      `| ${widths.map((w, c) => padTo(row[c] ?? '', w, aligns[c] ?? null)).join(' | ')} |`,
  )
  const delim = widths.map((w, c) => {
    const a = aligns[c] ?? null
    if (a === 'center') return `:${'-'.repeat(Math.max(1, w - 2))}:`
    if (a === 'right') return `${'-'.repeat(Math.max(1, w - 1))}:`
    if (a === 'left') return `:${'-'.repeat(Math.max(1, w - 1))}`
    return '-'.repeat(w)
  })
  out.splice(1, 0, `| ${delim.join(' | ')} |`)
  return out
}

/** Which column of `text` does character offset `ch` fall in? */
export function columnAt(text: string, ch: number): number {
  let pipes = 0
  for (let i = 0; i < ch && i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      i++
      continue
    }
    if (text[i] === '|') pipes++
  }
  const leading = /^\s*\|/.test(text)
  return Math.max(0, pipes - (leading ? 1 : 0))
}

/** Replace the whole table block with `lines`, keeping the cursor in `cell`. */
function replaceTable(
  state: EditorState,
  info: TableInfo,
  rows: string[][],
  aligns: Align[],
  cell: { row: number; col: number } | null,
): TransactionSpec {
  const lines = renderTable(rows, aligns)
  const from = state.doc.line(info.firstLine).from
  const to = state.doc.line(info.lastLine).to
  const text = lines.join('\n')

  let selection
  if (cell) {
    // Row index in the rendered block: the delimiter is spliced in at 1.
    const rendered = cell.row === 0 ? 0 : cell.row + 1
    let at = from
    for (let i = 0; i < rendered; i++) at += lines[i].length + 1
    const lineText = lines[rendered] ?? ''
    let seen = 0
    let cellStart = lineText.length
    for (let i = 0; i < lineText.length; i++) {
      if (lineText[i] === '\\' && lineText[i + 1] === '|') {
        i++
        continue
      }
      if (lineText[i] === '|') {
        if (seen === cell.col) {
          cellStart = i + 2 // past the pipe and its padding space
          break
        }
        seen++
      }
    }
    const content = rows[cell.row]?.[cell.col] ?? ''
    selection = content
      ? EditorSelection.range(at + cellStart, at + cellStart + content.length)
      : EditorSelection.cursor(at + cellStart)
  }
  return { changes: { from, to, insert: text }, selection, scrollIntoView: true }
}

/** Insert an empty 2×2 table, on this line if it is blank or the next if not. */
export function insertTable(state: EditorState): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.head)
  const table = renderTable(
    [
      ['', ''],
      ['', ''],
    ],
    [null, null],
  ).join('\n')
  const blank = line.text.trim() === ''
  const from = blank ? line.from : line.to
  const insert = blank ? table : `\n${table}`
  // First cell: past "| ".
  const anchor = (blank ? line.from : line.to + 1) + 2
  return { changes: { from, to: blank ? line.to : line.to, insert }, selection: { anchor }, scrollIntoView: true }
}

/**
 * Move to the next (dir 1) or previous (dir -1) cell, selecting its contents.
 * Tabbing past the last cell appends a row; there is nowhere to go before the
 * first cell, so that returns null and Tab falls through to indentation.
 */
export function moveCell(state: EditorState, dir: 1 | -1): TransactionSpec | null {
  const pos = state.selection.main.head
  const info = tableAt(state, pos)
  if (!info) return null
  const line = state.doc.lineAt(pos)
  const row = info.lineNumbers.indexOf(line.number)
  if (row < 0) return null // cursor sits on the delimiter row

  const cols = Math.max(info.aligns.length, ...info.rows.map((r) => r.length))
  let col = columnAt(line.text, pos - line.from) + dir
  let target = row
  if (col >= cols) {
    col = 0
    target = row + 1
  } else if (col < 0) {
    col = cols - 1
    target = row - 1
  }
  if (target < 0) return null

  const rows = info.rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ''))
  if (target >= rows.length) rows.push(Array.from({ length: cols }, () => ''))
  return replaceTable(state, info, rows, info.aligns, { row: target, col })
}

/**
 * Move to the same column one row down. Returns null on the last row so the
 * default Enter applies — that plain newline is the only way out of a table,
 * and silently appending a row instead would trap the cursor in it forever.
 */
export function nextRow(state: EditorState): TransactionSpec | null {
  const pos = state.selection.main.head
  const info = tableAt(state, pos)
  if (!info) return null
  const line = state.doc.lineAt(pos)
  const row = info.lineNumbers.indexOf(line.number)
  if (row < 0 || row + 1 >= info.rows.length) return null

  const cols = Math.max(info.aligns.length, ...info.rows.map((r) => r.length))
  const col = Math.min(columnAt(line.text, pos - line.from), cols - 1)
  const rows = info.rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ''))
  return replaceTable(state, info, rows, info.aligns, { row: row + 1, col })
}

/** Re-pad every cell so the pipes line up. No-op outside a table. */
export function formatTable(state: EditorState): TransactionSpec | null {
  const pos = state.selection.main.head
  const info = tableAt(state, pos)
  if (!info) return null
  const line = state.doc.lineAt(pos)
  const row = info.lineNumbers.indexOf(line.number)
  const cell = row < 0 ? null : { row, col: columnAt(line.text, pos - line.from) }
  const cols = Math.max(info.aligns.length, ...info.rows.map((r) => r.length))
  const rows = info.rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ''))
  return replaceTable(state, info, rows, info.aligns, cell)
}

export type TableStructureOp = 'row-after' | 'row-delete' | 'col-after' | 'col-delete'

/** Add or remove the row/column the cursor is in. */
export function editTableStructure(
  state: EditorState,
  op: TableStructureOp,
): TransactionSpec | null {
  const pos = state.selection.main.head
  const info = tableAt(state, pos)
  if (!info) return null
  const line = state.doc.lineAt(pos)
  const row = info.lineNumbers.indexOf(line.number)
  if (row < 0) return null
  const cols = Math.max(info.aligns.length, ...info.rows.map((r) => r.length))
  const col = Math.min(columnAt(line.text, pos - line.from), cols - 1)
  const rows = info.rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ''))
  const aligns = Array.from({ length: cols }, (_, c) => info.aligns[c] ?? null)

  if (op === 'row-after') {
    rows.splice(row + 1, 0, Array.from({ length: cols }, () => ''))
    return replaceTable(state, info, rows, aligns, { row: row + 1, col })
  }
  if (op === 'row-delete') {
    // The header is the table's shape — deleting it would leave a delimiter
    // row with nothing above it, which is no longer a table.
    if (row === 0 || rows.length <= 2) return null
    rows.splice(row, 1)
    return replaceTable(state, info, rows, aligns, { row: Math.min(row, rows.length - 1), col })
  }
  if (op === 'col-after') {
    for (const r of rows) r.splice(col + 1, 0, '')
    aligns.splice(col + 1, 0, null)
    return replaceTable(state, info, rows, aligns, { row, col: col + 1 })
  }
  if (cols <= 1) return null
  for (const r of rows) r.splice(col, 1)
  aligns.splice(col, 1)
  return replaceTable(state, info, rows, aligns, { row, col: Math.min(col, cols - 2) })
}
