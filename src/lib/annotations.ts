/**
 * Highlight annotations, stored in trace-app-compatible sidecar files
 * (`<source>.annotations.json`) so both apps read each other's highlights.
 *
 * PDF entries use EmbedPDF's annotation object shape (top-left-origin PDF
 * points, 0-based pageIndex, type 9 = highlight). We keep each raw entry
 * verbatim and only derive the fields we render, so fields we don't model
 * survive a round-trip. EPUB entries are simple {cfi, color, text, createdAt}.
 */
import * as fs from '@/lib/fs'

export const HIGHLIGHT_COLORS: Array<{ name: string; value: string }> = [
  { name: 'yellow', value: '#FFFF98' },
  { name: 'green', value: '#B6F2C4' },
  { name: 'blue', value: '#9CD7FF' },
  { name: 'pink', value: '#FFCBE6' },
  { name: 'red', value: '#FFA9AE' },
]

export function sidecarPath(source: string): string {
  return `${source}.annotations.json`
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
    custom?: { text?: string }
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
