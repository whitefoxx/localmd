/**
 * Extract a PDF into citeable blocks using pdf.js: drive the document, hand
 * each page's text items to `./layout` to be read as lines, columns and
 * paragraphs, then label headings by size relative to the body median. Every
 * block carries normalized top-left-origin rects so the viewer can highlight
 * it. (trace-app used the EmbedPDF engine for this; the output shape is
 * identical.)
 *
 * The layout rules live next door on purpose — this module cannot be imported
 * outside a browser, and rules that decide what every citation points at should
 * be testable without one.
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { installJsShims, jsShimSource, jsShimsNeeded } from '@/lib/polyfills'
import type { NormRect, OutlineNode, PdfBlock } from './types'
import {
  layoutPage,
  groupBlocks,
  joinLines,
  type Line,
  type RawItem,
  type TextBounds,
} from './layout'

installJsShims()
pdfjs.GlobalWorkerOptions.workerSrc = shimmedWorkerUrl()

/**
 * pdf.js runs in its own worker global, so the shims installed above don't
 * reach it — and the very first thing it does with a document (fingerprinting
 * via `Uint8Array.prototype.toHex()`) is what breaks on pre-Chrome-140
 * browsers. On those, point workerSrc at a tiny module blob that installs the
 * shims and then imports the real worker; modern browsers keep the plain URL.
 */
function shimmedWorkerUrl(): string {
  try {
    const absolute = new URL(workerUrl, location.href).href
    if (!jsShimsNeeded()) return absolute
    const src = `${jsShimSource()}\nawait import(${JSON.stringify(absolute)});\n`
    return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
  } catch {
    return workerUrl
  }
}

export interface PdfExtractResult {
  title: string
  pageCount: number
  pageSizes: { w: number; h: number }[]
  blocks: PdfBlock[]
  outline: { tree: OutlineNode[]; flat: { title: string; level: number; page: number }[] }
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
    const pageBounds: TextBounds[] = []

    let lastYield = performance.now()
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
      const laid = layoutPage(items, vp.height)
      pageLines.push(laid.lines)
      pageBounds.push(laid.bounds)
      page.cleanup()
      // Yield between pages: extraction shares the main thread with whatever
      // the user is doing (often the viewer painting this very document), and
      // an unbroken thousand-page loop starves it for the whole build.
      if (performance.now() - lastYield > 12) {
        await new Promise((r) => setTimeout(r, 0))
        lastYield = performance.now()
      }
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
      for (const group of groupBlocks(pageLines[p], pageBounds[p])) {
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
