/**
 * Extract a PDF into citeable blocks using pdf.js. Text items are grouped
 * into visual lines by baseline, lines into paragraph blocks by vertical gap
 * and font-size changes, and headings are detected by size relative to the
 * body median. Every block carries normalized top-left-origin rects so the
 * viewer can highlight it. (trace-app used the EmbedPDF engine for this;
 * the output shape is identical.)
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { NormRect, OutlineNode, PdfBlock } from './types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfExtractResult {
  title: string
  pageCount: number
  pageSizes: { w: number; h: number }[]
  blocks: PdfBlock[]
  outline: { tree: OutlineNode[]; flat: { title: string; level: number; page: number }[] }
}

interface Line {
  x0: number
  x1: number
  /** Top edge in top-left-origin page coords. */
  yTop: number
  fontH: number
  text: string
}

/** The slice of pdf.js's TextItem the extractor uses. */
interface RawItem {
  str: string
  transform: number[]
  width: number
  height: number
}

export async function extractPdf(
  data: ArrayBuffer,
  fallbackTitle: string,
  onProgress: (page: number, total: number) => void = () => {},
): Promise<PdfExtractResult> {
  const loadingTask = pdfjs.getDocument({ data })
  try {
    const doc = await loadingTask.promise
    const pageSizes: { w: number; h: number }[] = []
    const pageLines: Line[][] = []

    for (let p = 1; p <= doc.numPages; p++) {
      onProgress(p, doc.numPages)
      const page = await doc.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      pageSizes.push({ w: vp.width, h: vp.height })
      const tc = await page.getTextContent()
      const items = (tc.items as Array<Partial<RawItem>>).filter(
        (i): i is RawItem =>
          typeof i.str === 'string' && i.str.trim() !== '' && Array.isArray(i.transform),
      )
      pageLines.push(groupLines(items, vp.height))
      page.cleanup()
    }

    // Body font size = median line font height across the document.
    const allHeights = pageLines
      .flat()
      .map((l) => l.fontH)
      .sort((a, b) => a - b)
    const bodySize = allHeights[Math.floor(allHeights.length / 2)] || 10

    const blocks: PdfBlock[] = []
    for (let p = 0; p < pageLines.length; p++) {
      const size = pageSizes[p]
      let n = 0
      for (const group of groupBlocks(pageLines[p])) {
        n += 1
        const text = joinLines(group)
        const maxH = Math.max(...group.map((l) => l.fontH))
        const isHeading = maxH >= bodySize * 1.18 && text.length <= 120 && group.length <= 3
        blocks.push({
          id: `b${p + 1}-${n}`,
          page: p + 1,
          kind: isHeading ? 'heading' : 'text',
          level: isHeading ? (maxH >= bodySize * 1.45 ? 1 : 2) : 0,
          text,
          rects: group.map((l): NormRect => normRect(l, size)),
        })
      }
    }

    const outline = await readOutline(doc)
    let title = fallbackTitle
    try {
      const meta = await doc.getMetadata()
      const t = (meta.info as { Title?: string }).Title
      if (t && t.trim()) title = t.trim()
    } catch {
      /* metadata is optional */
    }

    return { title, pageCount: doc.numPages, pageSizes, blocks, outline }
  } finally {
    await loadingTask.destroy()
  }
}

/** Group text items into visual lines by baseline proximity. */
function groupLines(items: RawItem[], pageH: number): Line[] {
  interface Placed {
    x: number
    y: number
    w: number
    h: number
    str: string
  }
  const placed: Placed[] = items.map((i) => ({
    x: i.transform[4],
    y: i.transform[5], // baseline, bottom-left origin
    w: i.width,
    h: i.height || Math.hypot(i.transform[1], i.transform[3]) || 10,
    str: i.str,
  }))
  // Top of page first (larger y in PDF coords), then left to right.
  placed.sort((a, b) => b.y - a.y || a.x - b.x)

  // Group by vertical band overlap rather than baseline proximity: superscript
  // footnote markers sit on a raised baseline but overlap their body line's
  // band, so they stay inline instead of becoming standalone one-glyph lines.
  const lines: { items: Placed[]; yLow: number; yHigh: number; h: number }[] = []
  for (const it of placed) {
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

  return lines.map((l) => {
    l.items.sort((a, b) => a.x - b.x)
    let text = ''
    let prevEnd = -Infinity
    for (const it of l.items) {
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
    const x0 = l.items[0].x
    const x1 = Math.max(...l.items.map((i) => i.x + i.w))
    return { x0, x1, yTop: pageH - l.yHigh, fontH: l.h, text: text.trim() }
  })
}

/** Group lines into paragraph blocks by vertical gap and font-size change. */
function groupBlocks(lines: Line[]): Line[][] {
  const blocks: Line[][] = []
  let cur: Line[] = []
  for (const line of lines) {
    const prev = cur[cur.length - 1]
    if (prev) {
      const gap = line.yTop - (prev.yTop + prev.fontH)
      const sizeJump =
        Math.max(line.fontH, prev.fontH) / Math.max(0.1, Math.min(line.fontH, prev.fontH)) > 1.2
      if (gap > prev.fontH * 0.75 || sizeJump) {
        blocks.push(cur)
        cur = []
      }
    }
    cur.push(line)
  }
  if (cur.length) blocks.push(cur)
  return blocks
}

/** CJK codepoint (incl. fullwidth punctuation) — line joins need no space. */
function isCjk(ch: string | undefined): boolean {
  return !!ch && /[　-〿一-鿿぀-ヿ豈-﫿＀-￯]/.test(ch)
}

/** Join a block's lines: fold hyphenated breaks, no space between CJK lines. */
function joinLines(lines: Line[]): string {
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

function normRect(l: Line, size: { w: number; h: number }): NormRect {
  return {
    x: l.x0 / size.w,
    y: l.yTop / size.h,
    w: (l.x1 - l.x0) / size.w,
    h: l.fontH / size.h,
  }
}

/** Read the embedded outline and resolve each entry to a 1-based page.
 *  Also used by the PDF viewer's table-of-contents panel. */
export async function readOutline(doc: pdfjs.PDFDocumentProxy): Promise<PdfExtractResult['outline']> {
  const flat: { title: string; level: number; page: number }[] = []

  interface RawOutline {
    title: string
    dest: unknown
    items: RawOutline[]
  }

  async function resolvePage(dest: unknown): Promise<number> {
    try {
      const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      if (Array.isArray(d) && d[0]) {
        return (await doc.getPageIndex(d[0] as Parameters<typeof doc.getPageIndex>[0])) + 1
      }
    } catch {
      /* unresolvable destination */
    }
    return 0
  }

  async function walk(items: RawOutline[], level: number): Promise<OutlineNode[]> {
    const nodes: OutlineNode[] = []
    for (const it of items ?? []) {
      const page = await resolvePage(it.dest)
      const title = (it.title ?? '').trim()
      if (title) flat.push({ title, level, page })
      nodes.push({
        title,
        level,
        page,
        children: await walk(it.items ?? [], level + 1),
      })
    }
    return nodes
  }

  const raw = ((await doc.getOutline()) ?? []) as unknown as RawOutline[]
  const tree = await walk(raw, 1)
  return { tree, flat: flat.filter((f) => f.page > 0) }
}
