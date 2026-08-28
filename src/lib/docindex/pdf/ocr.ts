/**
 * Reading a scanned PDF: render each page, recognise the words, and hand back
 * the same `Line[]` the text-layer path produces — so blocks, headings, rects,
 * citations and id inheritance all work exactly as they do for a normal PDF.
 *
 * Why this seam. `assembleBlocks` turns lines-with-geometry into blocks, and
 * `inherit.ts` keeps a published block id pointing at the same passage by
 * matching RECTANGLES between builds. So OCR has to produce coordinates, not
 * just text — which is the reason this is tesseract.js and not a vision model.
 * A model returns prose with no reliable geometry: the citation chips would
 * have nothing to highlight and a re-run could not inherit a single id.
 *
 * Everything here is behind a dynamic import and only ever runs when the user
 * asks: the engine and its language data are megabytes, and recognising a page
 * costs seconds of CPU.
 */
import { isCjk, type Line } from './layout'

/** Recognition runs at this multiple of the PDF's own size. Tesseract wants
 *  roughly 300 DPI; a PDF point is 1/72", so 3× ≈ 216 DPI and 4× ≈ 288. Above
 *  that, accuracy stops improving and memory does not. */
const RENDER_SCALE = 3.5

/** Below this mean confidence a line is dropped: a scan's margins produce
 *  confident-looking noise, and a wrong quotation is worse than a missing one
 *  when the whole promise is that a citation lands on the real passage. */
const MIN_CONFIDENCE = 55

export interface OcrPage {
  lines: Line[]
}

/**
 * What the language picker offers. Tesseract has a hundred of these; this is
 * the short list, and `+` combines them — a Chinese book with English terms in
 * it reads better as `chi_sim+eng` than as either alone.
 *
 * The data for a language is fetched from tesseract.js's CDN the first time it
 * is used (a few MB, then cached by the browser). Worth saying out loud in a
 * product whose claim is that the document never leaves the machine: the
 * document still doesn't — the alphabet comes to it.
 */
export const OCR_LANGS = [
  'eng',
  'chi_sim',
  'chi_sim+eng',
  'chi_tra',
  'jpn',
  'kor',
  'fra',
  'deu',
  'spa',
  'rus',
] as const

export interface OcrOptions {
  /** Tesseract language codes, e.g. `eng`, `chi_sim`, or `chi_sim+eng`. */
  lang: string
  /** 1-based page → how far along, for the UI. */
  onProgress?: (page: number, total: number) => void
  /**
   * Cancels the run. Aborting THROWS rather than returning what was read so
   * far: a half-recognised book assembles into a perfectly valid index that
   * covers a third of the pages and says so nowhere, and the next reader —
   * human or agent — would have no way to tell it from a complete one.
   */
  signal?: AbortSignal
}

/** A tesseract result, in the shape we actually use. Lines are nested two
 *  deep — `data.lines` was flattened out of the result in tesseract.js 7, and
 *  reading it instead yields `undefined` rather than an error, so a page of
 *  perfectly recognised text arrives here as zero lines. */
export interface TessResult {
  blocks?: TessBlock[] | null
}
interface TessBlock {
  paragraphs?: { lines?: TessLine[] }[]
}
interface TessLine {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * Recognise every page of an already-open pdf.js document.
 *
 * @param doc a pdf.js PDFDocumentProxy — passed in rather than re-opened, so
 *   the caller keeps ownership of the file bytes and the cleanup.
 */
export async function ocrPdf(
  doc: {
    numPages: number
    getPage: (n: number) => Promise<{
      getViewport: (o: { scale: number }) => { width: number; height: number }
      render: (o: { canvas: HTMLCanvasElement; viewport: unknown }) => {
        promise: Promise<void>
      }
      cleanup: () => void
    }>
  },
  { lang, onProgress, signal }: OcrOptions,
): Promise<OcrPage[]> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(lang)
  const pages: OcrPage[] = []
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      if (signal?.aborted) throw abort()
      onProgress?.(p, doc.numPages)

      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('OCR needs a 2D canvas')
      // White ground: a PDF page is paper, and a transparent canvas recognises
      // as black-on-black.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      // pdf.js 6 takes the canvas itself; passing only `canvasContext` (the
      // pre-6 signature) renders nothing at all, silently — a blank page that
      // OCRs to zero lines and looks like a bad scan.
      await page.render({ canvas, viewport }).promise
      page.cleanup()

      const { data } = await worker.recognize(canvas, {}, { blocks: true })
      if (signal?.aborted) throw abort()
      pages.push({ lines: linesFrom(data as unknown as TessResult) })

      // Free the bitmap before the next page: a 300-DPI A4 canvas is ~25MB,
      // and a few hundred of them held at once is the whole tab.
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    await worker.terminate()
  }
  return pages
}

function abort(): Error {
  return new DOMException('OCR cancelled', 'AbortError')
}

/**
 * Recognise one already-rendered page. Exported because it is the piece worth
 * exercising on a real scan without dragging a whole document through: give
 * it a canvas, get back the lines the rest of the pipeline consumes.
 */
export async function ocrCanvas(
  canvas: HTMLCanvasElement,
  lang: string,
): Promise<Line[]> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(lang)
  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true })
    return linesFrom(data as unknown as TessResult)
  } finally {
    await worker.terminate()
  }
}

/**
 * Tesseract lines → the layout module's `Line`, in PDF points.
 *
 * Exported for its test: everything else here needs a canvas, and this is the
 * part with rules in it.
 *
 * Coordinates come back in rendered pixels with a top-left origin, which is
 * the origin `Line` already uses — so this only has to undo RENDER_SCALE.
 * `fontH` is the line's own height, which is what the heading heuristic reads:
 * a scanned heading really is taller than its body text, so the same rule
 * carries over unchanged.
 */
export function linesFrom(data: TessResult): Line[] {
  const out: Line[] = []
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs ?? [])
      for (const l of para.lines ?? []) {
        const text = tidy(l.text)
        if (!text || l.confidence < MIN_CONFIDENCE) continue
        out.push({
          x0: l.bbox.x0 / RENDER_SCALE,
          x1: l.bbox.x1 / RENDER_SCALE,
          yTop: l.bbox.y0 / RENDER_SCALE,
          fontH: Math.max(1, (l.bbox.y1 - l.bbox.y0) / RENDER_SCALE),
          text,
        })
      }
  return out
}

/**
 * Collapse whitespace, and close the gaps tesseract puts between CJK
 * characters — it segments Chinese per glyph and joins with spaces, so a
 * recognised sentence arrives as "起 始 情 境". Left alone those spaces reach
 * the note, the search index and every quotation drawn from the page.
 */
function tidy(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' && isCjk(text[i - 1]) && isCjk(text[i + 1])) continue
    out += text[i]
  }
  return out
}
