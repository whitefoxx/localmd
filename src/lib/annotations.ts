/**
 * Highlight annotations, stored in trace-app-compatible sidecar files
 * (`<source>.annotations.json`) so both apps read each other's highlights.
 *
 * PDF entries use EmbedPDF's annotation object shape (top-left-origin PDF
 * points, 0-based pageIndex, type 9 = highlight). We keep each raw entry
 * verbatim and only derive the fields we render, so fields we don't model
 * survive a round-trip. EPUB entries are simple {cfi, color, text, createdAt}.
 */
import { ref } from 'vue'
import * as fs from '@/lib/fs'
import { fileKind } from '@/lib/filetypes'

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
    /** `text` = the highlighted excerpt (EmbedPDF fills it); `note` = the
     *  user's own comment, edited on the annotations page. */
    custom?: { text?: string; note?: string }
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
      author: 'browser-md',
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

/* ───────── agent-facing digest ───────── */

function colorName(hex: string): string {
  const known = HIGHLIGHT_COLORS.find((c) => c.value.toLowerCase() === hex.toLowerCase())
  return known?.name ?? hex
}

function digestEntry(color: string, style: string, date: string, text: string, note: string): string {
  const when = date ? ` · ${date.slice(0, 10)}` : ''
  const excerpt = text.replace(/\s+/g, ' ').trim()
  let line = `- [${colorName(color)} ${style}${when}] "${excerpt || '(no text captured)'}"`
  if (note.trim()) line += `\n  Note: ${note.trim()}`
  return line
}

/**
 * Render a sidecar's JSON as compact markdown for the agent (and @-mentions):
 * the raw JSON is rect/CFI-heavy noise for Q&A. Returns null when the JSON
 * doesn't parse — callers fall back to the raw content.
 */
export function renderAnnotationsDigest(sidecar: string, json: string): string | null {
  const source = annotationSource(sidecar)
  const kind = fileKind(source)
  let parsed: { annotations?: unknown[] }
  try {
    parsed = JSON.parse(json) as { annotations?: unknown[] }
  } catch {
    return null
  }
  if (!Array.isArray(parsed.annotations)) return null
  const name = source.slice(source.lastIndexOf('/') + 1)
  const head =
    `# Annotations — ${name} (${parsed.annotations.length})\n\n` +
    `Source book: ${source} · sidecar: ${sidecar} (JSON, rendered here for readability)\n`
  if (kind === 'pdf') {
    const highlights = (parsed.annotations as RawPdfAnnotation[])
      .map((raw) => ({ h: toPdfHighlight(raw), note: raw.annotation?.custom?.note ?? '', created: raw.annotation?.created ?? '' }))
      .filter((x): x is { h: PdfHighlight; note: string; created: string } => x.h !== null)
      .sort((a, b) => a.h.pageIndex - b.h.pageIndex || (a.h.rects[0]?.y ?? 0) - (b.h.rects[0]?.y ?? 0))
    const byPage = new Map<number, string[]>()
    for (const { h, note, created } of highlights) {
      const lines = byPage.get(h.pageIndex) ?? []
      lines.push(digestEntry(h.color, 'highlight', created, h.text, note))
      byPage.set(h.pageIndex, lines)
    }
    const body = [...byPage.entries()]
      .map(([page, lines]) => `\n## Page ${page + 1}\n${lines.join('\n')}`)
      .join('\n')
    return head + body
  }
  const items = (parsed.annotations as EpubAnnotation[])
    .filter((a) => typeof a?.cfi === 'string')
    .sort((a, b) => compareCfi(a.cfi, b.cfi))
    .map((a) =>
      digestEntry(a.color ?? '', a.style ?? 'highlight', a.createdAt ?? '', a.text ?? '', a.note ?? ''),
    )
  return `${head}\n${items.join('\n')}`
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
