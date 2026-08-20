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

import type { NormRect, PdfBlock } from './types'
import { markBoilerplate } from './boilerplate'

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
  const { flow, floaters } = separateFloaters(bandLines(place(items)))
  const lines = [...flow, ...floaters].map((l) => toLine(l, pageH))
  // Floaters are excluded from the bounds: figure labels sit at arbitrary x,
  // and letting them vote would drag the margins off the prose.
  const bounds = boundsOf(lines.slice(0, flow.length))
  return { lines, bounds }
}

/** A band's glyph runs must be this far apart, in units of the band's own line
 *  height, before the band is read as two pieces of unrelated text. Measured on
 *  a real paper: justified prose almost never opens more than 0.3em inside a
 *  line (p90 across a clean page), while body text sharing a band with a chart
 *  sits 2.5em or more from the chart's labels. */
const FRAG_GAP_EM = 1.5

/** A fragment counts as anchored to the prose margin within this many ems. */
const NEAR_MARGIN_EM = 2

/**
 * Pull figure text out of the prose it sits beside.
 *
 * A page with a wrapped figure — a chart in the right half, body text flowing
 * around it — puts chart labels at the same heights as body lines. Band
 * grouping merges each such pair into one "line", and joining left-to-right
 * interleaves a sentence with axis ticks and legend entries, one fragment at a
 * time. That garbles the block text the agent reads, and stretches every
 * citation rect across the figure.
 *
 * The structure to recover is two streams. Bands are cut at gaps no line of
 * prose would contain (FRAG_GAP_EM); the fragment nearest the page's own left
 * margin continues the prose, and the rest are floaters, held back and emitted
 * after the flow so they form blocks of their own. While a float region is
 * open, a lone fragment inside its x-range that does not reach the margin is a
 * chart line with no prose beside it — the axis row of a tall figure — and
 * joins the floaters too. A margin-anchored line reaching back across the
 * region closes it: the prose has reclaimed the width.
 *
 * One honest limitation: "nearest the left margin" assumes the prose is the
 * left stream. A figure wrapped on the LEFT of its text would have the roles
 * reversed and come out mis-streamed — each stream still coherent, but in the
 * wrong order. Every wrapped figure in the documents this was verified against
 * sits on the right, so the simple rule is kept until a real counterexample
 * shows up.
 */
export function separateFloaters(bands: RawLine[]): { flow: RawLine[]; floaters: RawLine[] } {
  const lefts = bands.map((b) => Math.min(...b.items.map((i) => i.x))).sort((a, b) => a - b)
  const pageLeft = lefts.length ? lefts[Math.floor(lefts.length / 2)] : 0

  const flow: RawLine[] = []
  const floaters: RawLine[] = []
  let region: { x0: number; x1: number } | null = null

  const nearLeft = (f: RawLine) =>
    Math.min(...f.items.map((i) => i.x)) - pageLeft < NEAR_MARGIN_EM * f.h
  const span = (f: RawLine) => ({
    x0: Math.min(...f.items.map((i) => i.x)),
    x1: Math.max(...f.items.map((i) => i.x + i.w)),
  })

  for (const band of bands) {
    const frags = splitAtWideGaps(band)
    if (frags.length > 1) {
      // The margin-anchored fragment carries the prose; everything else floats.
      let body = 0
      for (let i = 1; i < frags.length; i++) {
        if (Math.abs(span(frags[i]).x0 - pageLeft) < Math.abs(span(frags[body]).x0 - pageLeft)) {
          body = i
        }
      }
      flow.push(frags[body])
      for (let i = 0; i < frags.length; i++) {
        if (i === body) continue
        const s = span(frags[i])
        region = region
          ? { x0: Math.min(region.x0, s.x0), x1: Math.max(region.x1, s.x1) }
          : s
        floaters.push(frags[i])
      }
      continue
    }

    const f = frags[0]
    if (region) {
      const s = span(f)
      const insideRegion = s.x0 < region.x1 && s.x1 > region.x0
      if (!nearLeft(f) && insideRegion) {
        floaters.push(f)
        continue
      }
      // Prose reaching back across the region means the figure has ended.
      if (nearLeft(f) && s.x1 > region.x0 + f.h) region = null
    }
    flow.push(f)
  }
  return { flow, floaters }
}

/** Cut one band wherever its glyph runs sit further apart than any line of
 *  prose would put them. Returns at least one piece. */
export function splitAtWideGaps(band: RawLine): RawLine[] {
  const items = [...band.items].sort((a, b) => a.x - b.x)
  const pieces: Placed[][] = [[items[0]]]
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]
    if (items[i].x - (prev.x + prev.w) > FRAG_GAP_EM * band.h) pieces.push([])
    pieces[pieces.length - 1].push(items[i])
  }
  if (pieces.length === 1) return [band]
  return pieces.map((its) => ({
    items: its,
    yLow: Math.min(...its.map((i) => i.y)),
    yHigh: Math.max(...its.map((i) => i.y + i.h)),
    h: Math.max(...its.map((i) => i.h)),
  }))
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
 * The median top-to-top distance between consecutive lines — the page's own
 * leading, learned rather than assumed. Null when the page has too few line
 * pairs to say. Only distances under 3× the font height contribute, so section
 * gaps and figure jumps do not drag the median off the body text.
 */
export function typicalPitch(lines: Line[]): number | null {
  const pitches: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i].yTop - lines[i - 1].yTop
    if (d > 0 && d <= 3 * lines[i - 1].fontH) pitches.push(d)
  }
  if (pitches.length < 4) return null
  return pitches.sort((a, b) => a - b)[Math.floor(pitches.length / 2)]
}

/**
 * Group lines into paragraph blocks.
 *
 * Vertical gap and font-size change alone are not enough, and neither is any
 * absolute gap threshold. The paper this was measured on marks paragraphs by
 * leading alone — 17pt between paragraphs against 11pt inside them, on a 10pt
 * font, with no indent — which sits just under a "gap > 0.75 × font" rule, so
 * whole paragraphs ran together and a citation highlighted two of them at
 * once. The pitch signal is therefore relative: the page's own leading is
 * learned (typicalPitch), and a line noticeably further than that from the one
 * above it starts a paragraph.
 *
 * The rest, in the order tested below: a large absolute gap still splits (for
 * pages too sparse to learn a leading from); a jump backwards in y is
 * out-of-flow content — floaters emitted after the prose — and never continues
 * a block; a font-size change is a heading boundary; a first line pushed right
 * of the margin is an indented paragraph opening; and in justified text a line
 * stopping short of the right margin ends a paragraph — unless the next line
 * stops equally short, which is not an ending but text wrapped around a
 * figure, every line of it ending at the same wrap margin.
 */
export function groupBlocks(lines: Line[], bounds: TextBounds): Line[][] {
  const blocks: Line[][] = []
  let cur: Line[] = []
  const push = () => {
    if (cur.length) blocks.push(cur)
    cur = []
  }
  const width = Math.max(1, bounds.right - bounds.left)
  const leading = typicalPitch(lines)
  for (const line of lines) {
    const prev = cur[cur.length - 1]
    if (prev) {
      const pitch = line.yTop - prev.yTop
      const gap = pitch - prev.fontH
      const bigGap = gap > prev.fontH * 0.75
      const paragraphPitch = leading !== null && pitch > leading + 0.35 * prev.fontH
      const backJump = pitch < -0.5 * prev.fontH
      const sizeJump =
        Math.max(line.fontH, prev.fontH) / Math.max(0.1, Math.min(line.fontH, prev.fontH)) > 1.2
      const indented = line.x0 - bounds.left > 0.5 * line.fontH
      const short = (l: Line) => l.x1 < bounds.right - 0.06 * width
      const wrapContinuation = short(line) && Math.abs(line.x1 - prev.x1) < 0.02 * width
      const prevEndedShort = bounds.justified && short(prev) && !wrapContinuation

      if (bigGap || paragraphPitch || backJump || sizeJump || indented || prevEndedShort) push()
    }
    cur.push(line)
  }
  push()
  return blocks
}

/** A heading candidate must reach this share of the body size. Measured: a
 *  paper whose section headings are 10pt over a 9pt body (1.11×) sat below
 *  the old 1.18 floor and the document degraded to one-file-per-page. */
const CANDIDATE_FLOOR = 1.08

/** When size-based candidates exceed this share of all blocks, the metrics
 *  are junk (a 1989 tech report reports line heights of 3.5 vs 1.5 and half
 *  the document outsizes the "body"); only explicit numbering is believed. */
const DEGENERATE_SHARE = 0.25

/**
 * Explicit hierarchy read off the text: "3.2.1 Title" → 3, "A.2 Title" → 2,
 * "IV. Title" / "A. Title" → 1. Null when the text does not open with a
 * numbering that is followed by an actual word — "3 q1" axis labels and
 * "1 +" formula fragments stay out.
 */
export function numberingDepth(text: string): number | null {
  if (/^\d{1,3}(\.\d{1,3})*[.)]?\s+\S*[A-Za-z]/.test(text)) {
    return /^\d{1,3}(\.\d{1,3})*/.exec(text)![0].split('.').length
  }
  if (/^[A-Z](\.\d{1,3})+[.)]?\s+\S*[A-Za-z]/.test(text)) {
    return /^[A-Z](\.\d{1,3})+/.exec(text)![0].split('.').length
  }
  if (/^[IVXLCDM]{1,6}[.)]\s+\S*[A-Za-z]/.test(text)) return 1
  if (/^[A-Z][.)]\s+\S*[A-Za-z]/.test(text)) return 1
  return null
}

/**
 * Turn every page's laid-out lines into the document's citeable blocks —
 * paragraph grouping, boilerplate marking, heading classification,
 * positional ids, normalized rects. Pure on purpose: this is the step that
 * decides what every published block id names, so it must be testable
 * without a PDF engine (the golden fixture test replays real extracted
 * pages through it).
 *
 * Heading levels are RELATIVE, not thresholds: candidates (big enough,
 * short enough) are bucketed by font size and the buckets ranked — the
 * largest recurring heading style is level 1 whatever its absolute ratio to
 * the body. Explicit numbering overrides the style rank ("3.2.1" is depth 3
 * no matter how it is set). When the size signal is degenerate
 * (DEGENERATE_SHARE), only numbered candidates survive.
 */
export function assembleBlocks(
  pageLines: Line[][],
  pageBounds: TextBounds[],
  pageSizes: { w: number; h: number }[],
): PdfBlock[] {
  // Body font size = median line font height across the document.
  const allHeights = pageLines
    .flat()
    .map((l) => l.fontH)
    .sort((a, b) => a - b)
  const bodySize = allHeights[Math.floor(allHeights.length / 2)] || 10

  // Pass 1: geometry and text, everything provisionally body text.
  const blocks: PdfBlock[] = []
  const maxHs: number[] = []
  for (let p = 0; p < pageLines.length; p++) {
    const size = pageSizes[p]
    let n = 0
    for (const group of groupBlocks(pageLines[p], pageBounds[p])) {
      n += 1
      blocks.push({
        id: `b${p + 1}-${n}`,
        page: p + 1,
        kind: 'text',
        level: 0,
        text: joinLines(group),
        rects: group.map((l): NormRect => normRect(l, size)),
      })
      maxHs.push(Math.max(...group.map((l) => l.fontH)))
    }
  }

  // Pass 2: page furniture out first, so a large-set running header can
  // neither become a heading nor vote in the style ranking.
  const marked = markBoilerplate(blocks, pageLines.length)

  // Pass 3: headings among what remains.
  const candidate = (b: PdfBlock, i: number): boolean =>
    marked[i].kind === 'text' &&
    maxHs[i] >= bodySize * CANDIDATE_FLOOR &&
    b.text.length <= 120 &&
    b.rects.length <= 3 &&
    !/[,;:]$/.test(b.text)
  const candidates = marked.map(candidate)
  const candidateCount = candidates.filter(Boolean).length

  const degenerate = candidateCount > DEGENERATE_SHARE * marked.length
  if (degenerate) {
    // Size means nothing here; believe only explicit numbering, strictly.
    return marked.map((b, i) => {
      if (marked[i].kind !== 'text') return b
      const depth = numberingDepth(b.text)
      const ok =
        depth !== null && b.text.length <= 80 && b.rects.length <= 2 && !/[.,;:]$/.test(b.text)
      return ok ? { ...b, kind: 'heading' as const, level: Math.min(depth!, 6) } : b
    })
  }

  // Style ranking: distinct candidate sizes (rounded to 0.5), largest first.
  const sizes = [
    ...new Set(marked.map((_, i) => (candidates[i] ? Math.round(maxHs[i] * 2) / 2 : null))),
  ]
    .filter((s): s is number => s !== null)
    .sort((a, b) => b - a)
  const styleLevel = new Map(sizes.map((s, i) => [s, Math.min(i + 1, 6)]))

  return marked.map((b, i) => {
    if (!candidates[i]) return b
    const level =
      numberingDepth(b.text) ?? styleLevel.get(Math.round(maxHs[i] * 2) / 2) ?? 6
    return { ...b, kind: 'heading' as const, level: Math.min(level, 6) }
  })
}

function normRect(l: Line, size: { w: number; h: number }): NormRect {
  return {
    x: l.x0 / size.w,
    y: l.yTop / size.h,
    w: (l.x1 - l.x0) / size.w,
    h: l.fontH / size.h,
  }
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
