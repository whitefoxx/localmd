/**
 * Extract a PDF into citeable blocks using pdf.js: drive the document, hand
 * each page's text items to `./layout` to be read as lines, columns and
 * paragraphs, then label headings by size relative to the body median. Every
 * block carries normalized top-left-origin rects so the viewer can highlight
 * it.
 *
 * The layout rules live next door on purpose — this module cannot be imported
 * outside a browser, and rules that decide what every citation points at should
 * be testable without one.
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { installJsShims, jsShimSource, jsShimsNeeded } from '@/lib/polyfills'
import type { OutlineNode, PdfBlock } from './types'
import { assembleBlocks, boundsOf, layoutPage, type Line, type RawItem, type TextBounds } from './layout'

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

/**
 * What every `getDocument` here is opened with.
 *
 * `wasmUrl` is where pdf.js finds its JBIG2 and JPEG 2000 decoders (vite.config
 * copies them there). Leaving it out costs nothing on a born-digital PDF and
 * everything on a scan: those are one large JBIG2 image per page, and pdf.js
 * responds to a missing decoder by warning to the console and rendering blank
 * paper. Nothing rejects, so the page that reaches OCR looks like an empty
 * sheet rather than a failure.
 */
const DOC_PARAMS = {
  wasmUrl: new URL(`${import.meta.env.BASE_URL}pdfjs-wasm/`, location.href).href,
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
  const loadingTask = pdfjs.getDocument({ data, ...DOC_PARAMS })
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

    const blocks: PdfBlock[] = assembleBlocks(pageLines, pageBounds, pageSizes)

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

/**
 * The same extraction, but reading the pictures instead of a text layer.
 *
 * Only the source of the lines differs: OCR hands back `Line[]` per page and
 * everything after that — block assembly, heading detection, rects, the
 * outline, the title — is the code above, unchanged. That is the whole reason
 * the OCR module returns geometry rather than prose.
 *
 * Never called automatically. The caller reaches here only when a text-layer
 * pass produced nothing AND the user asked for it: recognising a page costs
 * seconds of CPU, and a few hundred of them is a decision, not a default.
 */
export async function extractPdfViaOcr(
  data: ArrayBuffer,
  fallbackTitle: string,
  opts: { lang: string; onProgress?: (page: number, total: number) => void; signal?: AbortSignal },
): Promise<PdfExtractResult> {
  const { ocrPdf } = await import('./ocr')
  const loadingTask = pdfjs.getDocument({ data, ...DOC_PARAMS })
  try {
    const doc = await loadingTask.promise
    const pageSizes: { w: number; h: number }[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      pageSizes.push({ w: vp.width, h: vp.height })
      page.cleanup()
    }
    const recognised = await ocrPdf(doc as never, opts)
    const pageLines = recognised.map((r) => r.lines)
    const pageBounds = pageLines.map((lines) => boundsOf(lines))
    const blocks = assembleBlocks(pageLines, pageBounds, pageSizes.slice(0, pageLines.length))
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
