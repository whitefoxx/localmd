/**
 * Reading a page's geometry: glyph runs → lines → paragraph blocks.
 *
 * Deliberately free of pdf.js. It takes the handful of fields pdf.js gives per
 * text item and nothing else, which is what makes these rules testable —
 * importing the extractor pulls in a PDF engine that wants a browser, so for as
 * long as they lived next to it, the code deciding what every citation in the
 * app points at had no tests at all.
 *
 * There is deliberately no column detection here. An earlier attempt added it,
 * on the theory that two columns at the same height get merged into one line
 * and joined into interleaved nonsense. Measured against two real two-column
 * papers, that failure does not happen: pdf.js gives the columns different
 * baselines, so they land in different lines to begin with (an ACL paper's
 * body pages report ~70 lines, i.e. one per column-line, not ~35 merged ones).
 * What *does* interleave is a figure sharing a band with body text — a chart
 * legend beside a paragraph. That is a horizontal-gap problem, not a column
 * one, and it is still open.
 */

/** The slice of pdf.js's TextItem the layout needs. */
export interface RawItem {
  str: string
  transform: number[]
  width: number
  height: number
}

/** A glyph run placed on the page, bottom-left origin as PDF gives it. */
export interface Placed {
  x: number
  y: number
  w: number
  h: number
  str: string
}

/** A visual line, before its text is joined. */
export interface RawLine {
  items: Placed[]
  yLow: number
  yHigh: number
  h: number
}

export interface Line {
  x0: number
  x1: number
  /** Top edge in top-left-origin page coords. */
  yTop: number
  fontH: number
  text: string
}

/** The typical text edges of a page's body, used to read paragraph boundaries
 *  out of line geometry. Medians, not extremes: an indented first line or a
 *  stray wide equation must not move the margin. */
export interface TextBounds {
  left: number
  right: number
  /** Most lines reach the right edge, so falling short of it means something. */
  justified: boolean
}

/** Turn one page's text items into lines, plus the geometry they sit in. */
export function layoutPage(
  items: RawItem[],
  pageH: number,
): { lines: Line[]; bounds: TextBounds } {
  const lines = bandLines(place(items)).map((l) => toLine(l, pageH))
  return { lines, bounds: boundsOf(lines) }
}

/** pdf.js text items in page space: x and the baseline y come out of the
 *  transform, and height can be absent on rotated text — derive it then. */
export function place(items: RawItem[]): Placed[] {
  return items.map((i) => ({
    x: i.transform[4],
    y: i.transform[5], // baseline, bottom-left origin
    w: i.width,
    h: i.height || Math.hypot(i.transform[1], i.transform[3]) || 10,
    str: i.str,
  }))
}

/**
 * Group items into visual lines by vertical band overlap rather than baseline
 * proximity: superscript footnote markers sit on a raised baseline but overlap
 * their body line's band, so they stay inline instead of becoming standalone
 * one-glyph lines.
 */
export function bandLines(placed: Placed[]): RawLine[] {
  // Top of page first (larger y in PDF coords), then left to right.
  const sorted = [...placed].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: RawLine[] = []
  for (const it of sorted) {
    const last = lines[lines.length - 1]
    const itLow = it.y
    const itHigh = it.y + it.h
    if (last) {
      const overlap = Math.min(last.yHigh, itHigh) - Math.max(last.yLow, itLow)
      if (overlap > 0.5 * Math.min(it.h, last.h)) {
        last.items.push(it)
        last.h = Math.max(last.h, it.h)
        last.yLow = Math.min(last.yLow, itLow)
        last.yHigh = Math.max(last.yHigh, itHigh)
        continue
      }
    }
    lines.push({ items: [it], yLow: itLow, yHigh: itHigh, h: it.h })
  }
  return lines
}

/** Join a raw line's glyph runs into text and fix its page-space geometry. */
function toLine(l: RawLine, pageH: number): Line {
  const items = [...l.items].sort((a, b) => a.x - b.x)
  let text = ''
  let prevEnd = -Infinity
  for (const it of items) {
    // Insert a space only across a visible gap — and never between CJK
    // glyphs, whose typography has gaps but no word spaces.
    if (
      text &&
      it.x - prevEnd > l.h * 0.2 &&
      !(isCjk(text[text.length - 1]) && isCjk(it.str.trimStart()[0]))
    ) {
      text += ' '
    }
    text += it.str
    prevEnd = it.x + it.w
  }
  return {
    x0: items[0].x,
    x1: Math.max(...items.map((i) => i.x + i.w)),
    yTop: pageH - l.yHigh,
    fontH: l.h,
    text: text.trim(),
  }
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Typical text edges of a set of lines, and whether they are justified. */
export function boundsOf(lines: Line[]): TextBounds {
  if (!lines.length) return { left: 0, right: 0, justified: false }
  const left = median(lines.map((l) => l.x0))
  const right = median(lines.map((l) => l.x1))
  const width = Math.max(1, right - left)
  // Ragged-right text ends short on every line, so "ends short" only means
  // "paragraph ended" when most lines do reach the margin.
  const atMargin = lines.filter((l) => l.x1 >= right - 0.02 * width).length
  return { left, right, justified: atMargin / lines.length > 0.6 }
}

/**
 * Group lines into paragraph blocks.
 *
 * Vertical gap and font-size change alone are not enough. Academic typesetting
 * sets paragraph leading equal to line leading and marks a new paragraph only
 * by indenting its first line — so gap-based splitting silently ran several
 * paragraphs into one block, which read badly and highlighted as one oversized
 * region on the page when a citation pointed at it. Two more signals fix that,
 * both read off the page's own text geometry: a first line pushed right of the
 * margin starts a paragraph, and in justified text a line that stops short of
 * the right margin ends one.
 */
export function groupBlocks(lines: Line[], bounds: TextBounds): Line[][] {
  const blocks: Line[][] = []
  let cur: Line[] = []
  const push = () => {
    if (cur.length) blocks.push(cur)
    cur = []
  }
  const width = Math.max(1, bounds.right - bounds.left)
  for (const line of lines) {
    const prev = cur[cur.length - 1]
    if (prev) {
      const gap = line.yTop - (prev.yTop + prev.fontH)
      const sizeJump =
        Math.max(line.fontH, prev.fontH) / Math.max(0.1, Math.min(line.fontH, prev.fontH)) > 1.2
      const indented = line.x0 - bounds.left > 0.5 * line.fontH
      const prevEndedShort = bounds.justified && prev.x1 < bounds.right - 0.06 * width

      if (gap > prev.fontH * 0.75 || sizeJump || indented || prevEndedShort) push()
    }
    cur.push(line)
  }
  push()
  return blocks
}

/** CJK codepoint (incl. fullwidth punctuation) — line joins need no space. */
export function isCjk(ch: string | undefined): boolean {
  return !!ch && /[　-〿一-鿿぀-ヿ豈-﫿＀-￯]/.test(ch)
}

/** Join a block's lines: fold hyphenated breaks, no space between CJK lines. */
export function joinLines(lines: Line[]): string {
  let out = ''
  for (const l of lines) {
    if (!out) {
      out = l.text
    } else if (out.endsWith('-')) {
      out = out.slice(0, -1) + l.text
    } else if (isCjk(out[out.length - 1]) && isCjk(l.text[0])) {
      out += l.text
    } else {
      out += ' ' + l.text
    }
  }
  return out.replace(/\s+/g, ' ').trim()
}
