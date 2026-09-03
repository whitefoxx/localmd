/**
 * Highlight annotations, stored in sidecar files beside the document
 * (`<source>.annotations.json`) — a published format existing knowledge bases
 * already hold, so the shape is not ours to change.
 *
 * PDF entries use EmbedPDF's annotation object shape (top-left-origin PDF
 * points, 0-based pageIndex, type 9 = highlight). We keep each raw entry
 * verbatim and only derive the fields we render, so fields we don't model
 * survive a round-trip. EPUB entries are simple {cfi, color, text, createdAt};
 * DOCX entries are the same with a block-offset `range` in place of the CFI.
 * WEB entries — highlights the user made in their browser, arriving with a
 * clipped page — carry a TextQuote `anchor` and the page `url` in place of a
 * position, since the "document" they point into is a live page and not a file.
 */
import { ref } from 'vue'
import * as fs from '@/lib/fs'
import { fileKind } from '@/lib/filetypes'
import { compareDocxRange } from '@/lib/docxMarks'

// macOS Books-style palette — deeper/more saturated than the old pastels.
// Highlights render at ~0.4 fill-opacity.
export const HIGHLIGHT_COLORS: Array<{ name: string; value: string }> = [
  { name: 'yellow', value: '#FFD633' },
  { name: 'green', value: '#7ED67E' },
  { name: 'blue', value: '#57B7F0' },
  { name: 'pink', value: '#FF8AAE' },
  { name: 'purple', value: '#BB8AEA' },
]

/** Underlines are always a single red — no color choice is offered for them. */
export const UNDERLINE_COLOR = '#FF3B30'

export function sidecarPath(source: string): string {
  return `${source}.annotations.json`
}

/** True for annotation sidecar files themselves. */
export function isAnnotationsPath(path: string): boolean {
  return /\.annotations\.json$/i.test(path)
}

/** The book a sidecar belongs to: `foo.pdf.annotations.json` → `foo.pdf`. */
export function annotationSource(sidecar: string): string {
  return sidecar.replace(/\.annotations\.json$/i, '')
}

/**
 * One-shot signal that a sidecar changed on disk outside its book viewer (the
 * annotations page or the raw JSON editor saved it). Live viewers watch this
 * and re-sync — needed for PDFs, which stay mounted across tab switches.
 */
export const sidecarRevision = ref<{ source: string; nonce: number } | null>(null)
let revNonce = 0
export function notifySidecarChanged(source: string): void {
  sidecarRevision.value = { source, nonce: ++revNonce }
}

/* ───────── PDF ───────── */

interface EmbedRect {
  origin: { x: number; y: number }
  size: { width: number; height: number }
}

/** The slice of an EmbedPDF annotation entry we read/write. */
export interface RawPdfAnnotation {
  annotation: {
    type: number
    strokeColor?: string
    color?: string
    opacity?: number
    blendMode?: number
    rect: EmbedRect
    segmentRects?: EmbedRect[]
    pageIndex: number
    created?: string
    id: string
    /** Standard PDF comment field — the user's note on any annotation. */
    contents?: string
    /** `text` = the marked passage, stashed by EmbedPDF for text markups.
     *  `bmNoteFor` tags our note-icon annotation (paired to a highlight). */
    custom?: { text?: string; bmNoteFor?: string }
    author?: string
    [k: string]: unknown
  }
  [k: string]: unknown
}

/** Derived view of a highlight for rendering: PDF points, top-left origin. */
export interface PdfHighlight {
  id: string
  /** 0-based. */
  pageIndex: number
  color: string
  text: string
  rects: { x: number; y: number; w: number; h: number }[]
}

export function toPdfHighlight(raw: RawPdfAnnotation): PdfHighlight | null {
  const a = raw.annotation
  if (!a || typeof a.pageIndex !== 'number' || !a.id) return null
  const segs = a.segmentRects?.length ? a.segmentRects : a.rect ? [a.rect] : []
  return {
    id: a.id,
    pageIndex: a.pageIndex,
    color: a.color ?? a.strokeColor ?? HIGHLIGHT_COLORS[0].value,
    text: a.custom?.text ?? '',
    rects: segs.map((r) => ({
      x: r.origin.x,
      y: r.origin.y,
      w: r.size.width,
      h: r.size.height,
    })),
  }
}

export function makeRawPdfAnnotation(
  pageIndex: number,
  rects: { x: number; y: number; w: number; h: number }[],
  color: string,
  text: string,
): RawPdfAnnotation {
  const segmentRects = rects.map((r) => ({
    origin: { x: r.x, y: r.y },
    size: { width: r.w, height: r.h },
  }))
  const bounds = rects.reduce(
    (a, r) => ({
      x0: Math.min(a.x0, r.x),
      y0: Math.min(a.y0, r.y),
      x1: Math.max(a.x1, r.x + r.w),
      y1: Math.max(a.y1, r.y + r.h),
    }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  )
  return {
    annotation: {
      type: 9, // EmbedPDF highlight
      strokeColor: color,
      color,
      opacity: 1,
      blendMode: 1,
      rect: {
        origin: { x: bounds.x0, y: bounds.y0 },
        size: { width: bounds.x1 - bounds.x0, height: bounds.y1 - bounds.y0 },
      },
      segmentRects,
      pageIndex,
      created: new Date().toISOString(),
      id: crypto.randomUUID(),
      custom: { text },
      author: 'localmd',
    },
  }
}

export async function loadPdfSidecar(source: string): Promise<RawPdfAnnotation[]> {
  const raw = await fs.tryReadFile(sidecarPath(source))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { annotations?: RawPdfAnnotation[] }
    return Array.isArray(parsed.annotations) ? parsed.annotations : []
  } catch {
    return []
  }
}

export async function savePdfSidecar(source: string, annotations: RawPdfAnnotation[]): Promise<void> {
  await fs.writeFile(sidecarPath(source), JSON.stringify({ version: 1, annotations }, null, 2))
}

/* ───────── EPUB ───────── */

export interface EpubAnnotation {
  cfi: string
  color: string
  text: string
  createdAt: string
  /** Mark style. Absent = highlight (back-compat with older sidecars). */
  style?: 'highlight' | 'underline'
  /** User's own comment, edited on the annotations page. */
  note?: string
}

/**
 * Order two `epubcfi(...)` strings by document position, without epub.js.
 * Compares the numeric steps (range CFIs use base+start); `[assertions]` are
 * ignored. Good enough to sort a book's own annotations into reading order.
 */
export function compareCfi(a: string, b: string): number {
  const steps = (cfi: string): number[] => {
    let body = /^epubcfi\((.*)\)$/.exec(cfi.trim())?.[1] ?? cfi
    const parts = body.split(',')
    if (parts.length === 3) body = parts[0] + parts[1] // range → base + start
    const out: number[] = []
    for (const token of body.split('/')) {
      if (!token) continue
      const t = token.replace(/\[[^\]]*\]/g, '').replace(/!/g, '')
      const [step, offset] = t.split(':')
      const n = parseInt(step, 10)
      if (!Number.isNaN(n)) out.push(n)
      const o = parseInt(offset ?? '', 10)
      if (!Number.isNaN(o)) out.push(o)
    }
    return out
  }
  const sa = steps(a)
  const sb = steps(b)
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const x = sa[i] ?? -1
    const y = sb[i] ?? -1
    if (x !== y) return x - y
  }
  return 0
}

/* ───────── DOCX ───────── */

/**
 * Same shape as an EPUB annotation, with a block-offset locator in place of the
 * CFI (see lib/docxMarks.ts for the `b1-3:10~b1-4:22` form).
 */
export interface DocxAnnotation {
  range: string
  color: string
  text: string
  createdAt: string
  style?: 'highlight' | 'underline'
  note?: string
}

export async function loadDocxSidecar(source: string): Promise<DocxAnnotation[]> {
  const raw = await fs.tryReadFile(sidecarPath(source))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { annotations?: DocxAnnotation[] }
    return Array.isArray(parsed.annotations) ? parsed.annotations : []
  } catch {
    return []
  }
}

export async function saveDocxSidecar(
  source: string,
  annotations: DocxAnnotation[],
): Promise<void> {
  await fs.writeFile(sidecarPath(source), JSON.stringify({ version: 1, annotations }, null, 2))
}

/* ───────── WEB (a clipped page's browser highlights) ───────── */

/**
 * A highlight the user made in their browser, written beside the clipped note
 * (localmd Connect hands them over with the clip — lib/clip.ts).
 *
 * The locator is a W3C TextQuote selector rather than a position, because the
 * thing it points into is a LIVE page: the extension finds the passage again
 * by its text and context, and so could anything else that reads this file.
 * Recognised by the presence of `anchor`, not by the source's file kind —
 * the shape says what it is.
 */
export interface WebAnnotation {
  anchor: { exact: string; prefix: string; suffix: string }
  url: string
  color: string
  text: string
  createdAt: string
  note?: string
  /** The extension's own id for the highlight, kept so a later sync can tell
   *  an entry it has seen from a new one. */
  id?: string
}

export function isWebAnnotation(entry: unknown): entry is WebAnnotation {
  const a = entry as WebAnnotation | null
  return !!a && typeof a === 'object' && !!a.anchor && typeof a.anchor.exact === 'string'
}

/** The extension names its colours; sidecars store hex. Same five names on
 *  both sides, on purpose, so a highlight looks the same here as on the page. */
export function colorHexFor(name: string | undefined): string {
  const hit = HIGHLIGHT_COLORS.find((c) => c.name === (name ?? '').toLowerCase())
  return hit?.value ?? HIGHLIGHT_COLORS[0].value
}

export async function loadWebSidecar(source: string): Promise<WebAnnotation[]> {
  const raw = await fs.tryReadFile(sidecarPath(source))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { annotations?: unknown[] }
    return Array.isArray(parsed.annotations) ? parsed.annotations.filter(isWebAnnotation) : []
  } catch {
    return []
  }
}

export async function saveWebSidecar(source: string, annotations: WebAnnotation[]): Promise<void> {
  await fs.writeFile(sidecarPath(source), JSON.stringify({ version: 1, annotations }, null, 2))
}

/* ───────── categories (shared by the viewer + the agent digest) ───────── */

/** PDF/EmbedPDF annotation subtype numbers → display names (from the engine's
 *  PdfAnnotationSubtype enum). Used to label 'other' marks. */
export const PDF_SUBTYPE_NAMES: Record<number, string> = {
  1: 'Text', 2: 'Link', 3: 'FreeText', 4: 'Line', 5: 'Square', 6: 'Circle',
  7: 'Polygon', 8: 'Polyline', 9: 'Highlight', 10: 'Underline', 11: 'Squiggly',
  12: 'Strikeout', 13: 'Stamp', 14: 'Caret', 15: 'Ink', 16: 'Popup',
  17: 'FileAttachment', 18: 'Sound', 19: 'Movie', 20: 'Widget', 21: 'Screen',
  22: 'PrinterMark', 23: 'TrapNet', 24: 'Watermark', 25: '3D', 26: 'RichMedia',
  27: 'XFAWidget', 28: 'Redact',
}

/** Highlight, underline and note/comment are first-class; every other subtype
 *  (strikeout, ink, shapes, …) collapses to 'other'. */
export type AnnotationCategory = 'highlight' | 'underline' | 'note' | 'other'

export function pdfCategory(type: number): AnnotationCategory {
  if (type === 9) return 'highlight'
  if (type === 10) return 'underline'
  if (type === 1 || type === 3) return 'note' // Text / FreeText = a standalone comment
  return 'other'
}

/** Normalized annotation, unified across PDF and EPUB sidecars. `origIndex` is
 *  the entry's position in the sidecar's `annotations` array — the edit handle. */
export interface AnnotationItem {
  id: string
  category: AnnotationCategory
  /** Subtype name, surfaced for 'other' marks (e.g. 'Ink', 'Strikeout'). */
  typeLabel: string
  color: string
  /** The marked passage (empty for standalone notes). */
  excerpt: string
  /** The user's own comment. */
  comment: string
  createdAt: string
  /** PDF: 1-based page + region (for the jump). */
  page?: number
  rects?: { x: number; y: number; w: number; h: number }[]
  /** EPUB: range CFI (for the jump). */
  cfi?: string
  /** DOCX: block-offset locator (for the jump). */
  range?: string
  /** WEB: the page the passage lives on (the jump opens it). */
  url?: string
  origIndex: number
}

function pdfRects(a: RawPdfAnnotation['annotation']): { x: number; y: number; w: number; h: number }[] {
  const segs = a.segmentRects?.length ? a.segmentRects : a.rect ? [a.rect] : []
  return segs.map((r) => ({ x: r.origin.x, y: r.origin.y, w: r.size.width, h: r.size.height }))
}

/** PDF text extraction breaks a marked passage at each *visual* line, so its
 *  stored text is riddled with newlines that fragment a single sentence (and even
 *  split words). Rejoin into a continuous excerpt: no space between CJK
 *  characters (they don't use spaces), a single space between Latin words. */
export function normalizeExcerpt(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length <= 1) return text.trim()
  const cjk = /[⺀-鿿豈-﫿＀-｠]/
  return lines.reduce((acc, line) => {
    const glue = cjk.test(acc.slice(-1)) || cjk.test(line[0] ?? '') ? '' : ' '
    return acc + glue + line
  })
}

/** Build the display/edit model for a sidecar, sorted into reading order. */
export function buildAnnotationItems(source: string, annotations: unknown[]): AnnotationItem[] {
  const kind = fileKind(source)
  const items: AnnotationItem[] = []
  annotations.forEach((entry, i) => {
    if (isWebAnnotation(entry)) {
      items.push({
        id: entry.id ?? `${entry.url}#${i}`,
        category: 'highlight',
        typeLabel: 'highlight',
        color: entry.color,
        excerpt: entry.text || entry.anchor.exact,
        comment: entry.note ?? '',
        createdAt: entry.createdAt ?? '',
        url: entry.url,
        origIndex: i,
      })
      return
    }
    if (kind === 'pdf') {
      const a = (entry as RawPdfAnnotation)?.annotation
      if (!a || typeof a.pageIndex !== 'number' || !a.id) return
      // Our 📝 note-icon markers are visual-only — the note lives on the
      // highlight they're paired to, so don't list them separately.
      if (a.custom?.bmNoteFor) return
      items.push({
        id: a.id,
        category: pdfCategory(a.type),
        typeLabel: PDF_SUBTYPE_NAMES[a.type] ?? `Type ${a.type}`,
        color: a.color ?? a.strokeColor ?? HIGHLIGHT_COLORS[0].value,
        excerpt: normalizeExcerpt(a.custom?.text ?? ''),
        comment: a.contents ?? '',
        createdAt: a.created ?? '',
        page: a.pageIndex + 1,
        rects: pdfRects(a),
        origIndex: i,
      })
    } else if (kind === 'docx') {
      const a = entry as DocxAnnotation
      if (typeof a?.range !== 'string') return
      const category: AnnotationCategory = a.style === 'underline' ? 'underline' : 'highlight'
      items.push({
        id: a.range,
        category,
        typeLabel: category,
        color: category === 'underline' ? UNDERLINE_COLOR : a.color,
        excerpt: a.text ?? '',
        comment: a.note ?? '',
        createdAt: a.createdAt ?? '',
        range: a.range,
        origIndex: i,
      })
    } else {
      const a = entry as EpubAnnotation
      if (typeof a?.cfi !== 'string') return
      const category: AnnotationCategory = a.style === 'underline' ? 'underline' : 'highlight'
      items.push({
        id: a.cfi,
        category,
        typeLabel: category,
        color: category === 'underline' ? UNDERLINE_COLOR : a.color,
        excerpt: a.text ?? '',
        comment: a.note ?? '',
        createdAt: a.createdAt ?? '',
        cfi: a.cfi,
        origIndex: i,
      })
    }
  })
  if (items.length && items.every((it) => it.url)) {
    // A page has no position we can compare from here; the order they were
    // made in is the honest one.
    items.sort((x, y) => x.createdAt.localeCompare(y.createdAt))
  } else if (kind === 'pdf') {
    items.sort((x, y) => x.page! - y.page! || (x.rects?.[0]?.y ?? 0) - (y.rects?.[0]?.y ?? 0))
  } else if (kind === 'docx') {
    items.sort((x, y) => compareDocxRange(x.range!, y.range!))
  } else {
    items.sort((x, y) => compareCfi(x.cfi!, y.cfi!))
  }
  return items
}

/* ───────── agent-facing digest ───────── */

function colorName(hex: string): string {
  const known = HIGHLIGHT_COLORS.find((c) => c.value.toLowerCase() === hex.toLowerCase())
  return known?.name ?? hex
}

function digestLine(it: AnnotationItem): string {
  const when = it.createdAt ? ` · ${it.createdAt.slice(0, 10)}` : ''
  const label =
    it.category === 'highlight'
      ? `${colorName(it.color)} highlight`
      : it.category === 'other'
        ? it.typeLabel.toLowerCase()
        : it.category
  if (it.excerpt.trim()) {
    let line = `- [${label}${when}] "${it.excerpt.replace(/\s+/g, ' ').trim()}"`
    if (it.comment.trim()) line += `\n  Note: ${it.comment.trim()}`
    return line
  }
  // Standalone note / mark with no captured passage.
  return `- [${label}${when}] ${it.comment.trim() || '(no text)'}`
}

/**
 * Render a sidecar's JSON as compact markdown for the agent (and @-mentions):
 * the raw JSON is rect/CFI-heavy noise for Q&A. Returns null when the JSON
 * doesn't parse — callers fall back to the raw content.
 */
export function renderAnnotationsDigest(sidecar: string, json: string): string | null {
  const source = annotationSource(sidecar)
  let parsed: { annotations?: unknown[] }
  try {
    parsed = JSON.parse(json) as { annotations?: unknown[] }
  } catch {
    return null
  }
  if (!Array.isArray(parsed.annotations)) return null
  const items = buildAnnotationItems(source, parsed.annotations)
  const name = source.slice(source.lastIndexOf('/') + 1)
  const pageUrl = items.find((it) => it.url)?.url
  const head =
    `# Annotations — ${name} (${items.length})\n\n` +
    (pageUrl
      ? `Highlights made in the browser on ${pageUrl}, clipped to ${source} · sidecar: ${sidecar} (JSON, rendered here for readability)\n`
      : `Source book: ${source} · sidecar: ${sidecar} (JSON, rendered here for readability)\n`)
  if (fileKind(source) === 'pdf') {
    const byPage = new Map<number, string[]>()
    for (const it of items) {
      const lines = byPage.get(it.page!) ?? []
      lines.push(digestLine(it))
      byPage.set(it.page!, lines)
    }
    const body = [...byPage.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([page, lines]) => `\n## Page ${page}\n${lines.join('\n')}`)
      .join('\n')
    return head + body
  }
  return `${head}\n${items.map(digestLine).join('\n')}`
}

export async function loadEpubSidecar(source: string): Promise<EpubAnnotation[]> {
  const raw = await fs.tryReadFile(sidecarPath(source))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { annotations?: EpubAnnotation[] }
    return Array.isArray(parsed.annotations) ? parsed.annotations : []
  } catch {
    return []
  }
}

export async function saveEpubSidecar(source: string, annotations: EpubAnnotation[]): Promise<void> {
  await fs.writeFile(sidecarPath(source), JSON.stringify({ version: 1, annotations }, null, 2))
}
