/**
 * Inline markdown marks (bold, italic, code, strikethrough) as toggles.
 *
 * Pure over EditorState so it is testable without a DOM — vitest runs in the
 * node environment, which cannot construct an EditorView.
 *
 * The subtlety worth knowing: `*` is both italic and half of bold, so the
 * naive "does it start and end with the mark?" test mangles nested emphasis
 * (it turns `**bold**` into `*bold*` when you ask for italic). We instead
 * count the run of mark characters on each side and read it the way
 * CommonMark does — `*x*` italic, `**x**` bold, `***x***` both — so toggling
 * one never eats the other.
 */
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'

export type MarkKind = 'bold' | 'italic' | 'code' | 'strike'

const URLISH = /^(https?:\/\/|mailto:|\/|\.{1,2}\/)\S*$/

/**
 * Wrap the selection in a link. A selection that looks like a URL becomes the
 * target with the cursor in the empty label; anything else becomes the label
 * with the cursor in the empty target, ready to paste.
 */
export function insertLink(state: EditorState): TransactionSpec {
  return state.changeByRange((range) => {
    const text = state.doc.sliceString(range.from, range.to)
    if (!text) {
      return {
        changes: { from: range.from, to: range.to, insert: '[]()' },
        range: EditorSelection.cursor(range.from + 1),
      }
    }
    const isUrl = URLISH.test(text)
    const insert = isUrl ? `[](${text})` : `[${text}]()`
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + (isUrl ? 1 : text.length + 3)),
    }
  })
}

/** Delimiter character and how many of them the mark uses. */
const MARKS: Record<MarkKind, { char: string; n: number }> = {
  bold: { char: '*', n: 2 },
  italic: { char: '*', n: 1 },
  code: { char: '`', n: 1 },
  strike: { char: '~', n: 2 },
}

/** Length of the run of `ch` ending at `pos` (looking backwards). */
function runBefore(text: string, pos: number, ch: string): number {
  let n = 0
  while (pos - n - 1 >= 0 && text[pos - n - 1] === ch) n++
  return n
}

/** Length of the run of `ch` starting at `pos` (looking forwards). */
function runAfter(text: string, pos: number, ch: string): number {
  let n = 0
  while (pos + n < text.length && text[pos + n] === ch) n++
  return n
}

/**
 * Is a delimiter run of `min` characters already applying this mark?
 *
 * For a two-character mark (bold, strike) any run of two or more is enough.
 * For `*` as italic only an odd run counts: `**x**` is bold and not italic,
 * `***x***` is both.
 */
function isActive(min: number, n: number, char: string): boolean {
  if (min < n) return false
  if (n === 1 && char === '*') return min % 2 === 1
  return true
}

/**
 * Toggle `kind` over every selection range.
 *
 * An empty selection expands to the word under the cursor, so ⌘B in the
 * middle of a bolded word unbolds it rather than inserting an empty pair.
 * With no word there (blank line, whitespace) it inserts the delimiters and
 * leaves the cursor between them, ready to type.
 *
 * Leading and trailing whitespace inside a selection is left outside the
 * marks — `**bold **` renders with a stray space and is easy to produce by
 * double-clicking a word plus the space after it.
 */
export function toggleMark(state: EditorState, kind: MarkKind): TransactionSpec {
  const { char, n } = MARKS[kind]
  const doc = state.doc.toString()
  const pair = char.repeat(n).repeat(2)

  return state.changeByRange((range) => {
    let from = range.from
    let to = range.to

    if (range.empty) {
      const word = state.wordAt(range.head)
      if (!word) {
        // Nothing to wrap — open an empty pair and sit inside it.
        return {
          changes: { from, to, insert: pair },
          range: EditorSelection.cursor(from + n),
        }
      }
      from = word.from
      to = word.to
    } else {
      // Pull the selection in off surrounding whitespace.
      const text = doc.slice(from, to)
      from += text.length - text.replace(/^\s+/, '').length
      to -= text.length - text.replace(/\s+$/, '').length
      if (from >= to) {
        return {
          changes: { from: range.from, to: range.to, insert: pair },
          range: EditorSelection.cursor(range.from + n),
        }
      }
    }

    // Separate the delimiters the selection already contains from the ones
    // sitting just outside it — double-clicking a word inside `**bold**`
    // selects only the word, but the marks are still there.
    const sel = doc.slice(from, to)
    const inLead = runAfter(sel, 0, char)
    const inTrail = inLead < sel.length ? runBefore(sel, sel.length, char) : 0
    const contentStart = from + inLead
    const contentEnd = to - inTrail
    if (contentStart >= contentEnd) {
      // Selection is nothing but delimiters — leave it alone.
      return { range }
    }

    const lead = inLead + runBefore(doc, from, char)
    const trail = inTrail + runAfter(doc, to, char)

    if (isActive(Math.min(lead, trail), n, char)) {
      return {
        changes: [
          { from: contentStart - n, to: contentStart },
          { from: contentEnd, to: contentEnd + n },
        ],
        range: EditorSelection.range(contentStart - n, contentEnd - n),
      }
    }
    const insert = char.repeat(n)
    return {
      changes: [
        { from: contentStart, insert },
        { from: contentEnd, insert },
      ],
      range: EditorSelection.range(contentStart + n, contentEnd + n),
    }
  })
}
