/**
 * Cross-page recurrence: mark running headers, footers and page numbers as
 * `boilerplate` so they stop wasting section-file tokens and stop posing as
 * headings — without ever deleting them. A marked block keeps its id and its
 * place in locations.json (an old citation to a header still resolves); it
 * just stops being rendered or classified.
 *
 * The signal is recurrence in the header/footer bands, with two guards
 * measured on real failures (see docs/docindex-compat.md):
 *
 * - A template must live almost ONLY in its band. A degenerate document
 *   whose body fragments into single-word blocks puts "the" at the bottom of
 *   16 pages — but "the" also occurs mid-page hundreds of times, and a real
 *   running header never does. Out-of-band occurrences ≤ 20% of in-band
 *   pages keeps furniture and kills body text.
 * - Page numbers recur as a TEMPLATE, not a text: digit runs collapse to
 *   `#` ("Page 12 of 43" → "page # of #"), and a text that is nothing but a
 *   roman numeral collapses to `#` too, so front-matter folios join in.
 */
import type { PdfBlock } from './types'

/** Vertical bands (page-normalized): above/below is header/footer country. */
const TOP_BAND = 0.15
const BOTTOM_BAND = 0.85

/** A template must recur on at least this many distinct pages of its band. */
const MIN_PAGES = 3

/** ...and occur outside the band on at most this share of that. */
const MAX_OUTSIDE_RATIO = 0.2

/** Strict roman-numeral grammar — "civil" is five roman letters but no
 *  number. The exclusions are valid numerals that are likelier to be words
 *  or symbols ("mix", "xi") than folios. */
const ROMAN = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/
const ROMAN_EXCLUDED = new Set(['di', 'div', 'li', 'liv', 'mi', 'mix', 'xi'])

/** Normalized recurrence key: case, digits and runs of space carry no
 *  identity; a pure roman numeral is a folio and keys like a number. */
export function template(text: string): string {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (t.length > 0 && t.length <= 7 && ROMAN.test(t) && !ROMAN_EXCLUDED.has(t)) return '#'
  return t.replace(/\d+/g, '#').slice(0, 80)
}

function band(b: PdfBlock): 'top' | 'bottom' | null {
  const first = b.rects[0]
  const last = b.rects[b.rects.length - 1]
  if (!first || !last) return null
  if (first.y + first.h / 2 < TOP_BAND) return 'top'
  if (last.y + last.h / 2 > BOTTOM_BAND) return 'bottom'
  return null
}

/**
 * Re-kind recurring band furniture as 'boilerplate'. Pure; returns the same
 * array with marked blocks replaced. Documents too short to establish
 * recurrence (< MIN_PAGES pages) are left alone.
 */
export function markBoilerplate(blocks: PdfBlock[], pageCount: number): PdfBlock[] {
  if (pageCount < MIN_PAGES) return blocks

  // Pages each (band, template) occurs on, and out-of-band block counts.
  const inBand = new Map<string, Set<number>>()
  const outside = new Map<string, number>()
  for (const b of blocks) {
    const key = template(b.text)
    if (!key) continue
    const z = band(b)
    if (z) {
      const k = `${z}|${key}`
      if (!inBand.has(k)) inBand.set(k, new Set())
      inBand.get(k)!.add(b.page)
    } else {
      outside.set(key, (outside.get(key) ?? 0) + 1)
    }
  }

  const furniture = new Set<string>()
  for (const [k, pages] of inBand) {
    if (pages.size < MIN_PAGES) continue
    const key = k.slice(k.indexOf('|') + 1)
    if ((outside.get(key) ?? 0) > pages.size * MAX_OUTSIDE_RATIO) continue
    furniture.add(k)
  }
  if (furniture.size === 0) return blocks

  return blocks.map((b) => {
    const z = band(b)
    if (!z || !furniture.has(`${z}|${template(b.text)}`)) return b
    return { ...b, kind: 'boilerplate' as const, level: 0 }
  })
}
