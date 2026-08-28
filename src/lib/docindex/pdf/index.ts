/**
 * Parse a PDF into a location-aware index under `.localmd/pdf-index/`, skipping
 * the work when a fresh index (same format version + content hash) exists.
 */
import * as fs from '@/lib/fs'
import { indexDirFor, readFreshManifest, sha256Hex, type IndexProgress } from '../util'
import { buildIndex } from './build'
import { extractPdf, extractPdfViaOcr } from './extract'
import { inheritIds, type PriorEntry } from './inherit'
import { INDEX_VERSION, type PdfIndexManifest, type PdfLocations } from './types'

export interface PdfParseResult {
  indexDir: string
  manifest: PdfIndexManifest
  cached: boolean
}

export interface PdfParseOptions {
  /** Rebuild a usable index — the user's explicit choice, never ours. */
  force?: boolean
  /** Read the pages as pictures instead of looking for a text layer. Only set
   *  when the user has asked: see extractPdfViaOcr. */
  ocr?: {
    lang: string
    onPage?: (page: number, total: number) => void
    signal?: AbortSignal
  }
}

export async function parsePdf(
  source: string,
  onProgress: IndexProgress = () => {},
  opts: PdfParseOptions = {},
): Promise<PdfParseResult> {
  const indexDir = indexDirFor('pdf', source)
  const bytes = await fs.readBinary(source)
  const contentHash = await sha256Hex(bytes)

  // An index built by an older algorithm (manifest.builder < BUILDER) is
  // still fresh here on purpose: rebuilding is offered, never imposed —
  // only `force` (the user's explicit choice) rebuilds a usable index.
  if (!opts.force) {
    const fresh = await readFreshManifest<PdfIndexManifest>(indexDir, INDEX_VERSION, contentHash)
    if (fresh) return { indexDir, manifest: fresh, cached: true }
  }

  const base = source.split('/').pop()?.replace(/\.pdf$/i, '') ?? source
  // Reading the pictures is never automatic: it costs seconds of CPU per page
  // and megabytes of engine, so the caller has to have been told yes.
  const extracted = opts.ocr
    ? await extractPdfViaOcr(bytes, base, {
        lang: opts.ocr.lang,
        onProgress: (c, t) => opts.ocr?.onPage?.(c, t),
        signal: opts.ocr.signal,
      })
    : await extractPdf(bytes, base, (c, t) => onProgress(c, t, 'extract'))
  // The turn is announced with no numbers of its own: what happens next —
  // inheriting ids, then rendering — has no unit worth counting until the
  // sections exist, and leaving the extractor's last page on screen through
  // it is exactly what looked hung.
  onProgress(0, 0, 'build')
  // Ids already published by a prior build of these SAME bytes are inherited,
  // not renumbered — the invariant that keeps existing citations pointing at
  // the passage they cited (see ./inherit).
  const prior = await loadPriorIds(indexDir, contentHash)
  const { blocks, locations } = inheritIds(extracted.blocks, prior)
  const manifest = await buildIndex({
    indexDir,
    source,
    title: extracted.title,
    contentHash,
    pageCount: extracted.pageCount,
    pageSizes: extracted.pageSizes,
    blocks,
    locations,
    outline: extracted.outline,
    textSource: opts.ocr ? 'ocr' : 'layer',
    ocrLang: opts.ocr?.lang,
    onProgress,
  })
  return { indexDir, manifest, cached: false }
}

/**
 * The prior build's id record, when it can be trusted: the manifest must be
 * this format and hash to the SAME source bytes — after an edit to the PDF
 * the old rects describe pages that no longer exist, so inheriting against
 * them would pin ids to the wrong passages. No manifest (first build, or a
 * build that died before its manifest — writeAll orders writes so the old
 * manifest survives until the new index is complete) → nothing to inherit.
 */
async function loadPriorIds(
  indexDir: string,
  contentHash: string,
): Promise<Record<string, PriorEntry> | null> {
  const rawManifest = await fs.tryReadFile(`${indexDir}/manifest.json`)
  if (!rawManifest) return null
  try {
    const m = JSON.parse(rawManifest) as PdfIndexManifest
    if (m.version !== INDEX_VERSION || m.contentHash !== contentHash) return null
    const rawLoc = await fs.tryReadFile(`${indexDir}/locations.json`)
    if (!rawLoc) return null
    const loc = JSON.parse(rawLoc) as PdfLocations
    return loc.blocks ?? null
  } catch {
    return null
  }
}

/**
 * Where this PDF's indexed text came from: read out of the file, or recognised
 * off pictures of the pages.
 *
 * Worth asking about, and worth saying out loud, because the two are not the
 * same kind of fact. A text layer is what the document says; OCR is a machine's
 * best reading of what it looks like, and it gets characters wrong. The promise
 * the app makes about a citation — that it lands on the passage — still holds
 * either way, but "and the transcription is exact" only holds for one of them.
 *
 * `'layer'` for indexes written before the field existed: OCR is the newcomer,
 * so an absent field means the old, non-recognised path.
 */
export async function pdfTextSource(source: string): Promise<'layer' | 'ocr' | null> {
  const raw = await fs.tryReadFile(`${indexDirFor('pdf', source)}/manifest.json`)
  if (!raw) return null
  try {
    return (JSON.parse(raw) as PdfIndexManifest).textSource ?? 'layer'
  } catch {
    return null
  }
}

/** Load a PDF's block→coordinates map, or null when it has no index. */
export async function loadPdfLocations(source: string): Promise<PdfLocations | null> {
  const raw = await fs.tryReadFile(`${indexDirFor('pdf', source)}/locations.json`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PdfLocations
  } catch {
    return null
  }
}

/**
 * Speech segments of a PDF from `fromPage` to the end, one per indexed block in
 * reading order — text pulled from the section markdown files, page + block id
 * from the block→page map so read-aloud can highlight each block and follow
 * along. [] when unindexed.
 */
export async function loadPdfSpeechSegments(
  source: string,
  fromPage: number,
): Promise<{ text: string; page?: number; block?: string }[]> {
  const indexDir = indexDirFor('pdf', source)
  const raw = await fs.tryReadFile(`${indexDir}/manifest.json`)
  if (!raw) return []
  let manifest: PdfIndexManifest
  try {
    manifest = JSON.parse(raw) as PdfIndexManifest
  } catch {
    return []
  }
  const blocks = (await loadPdfLocations(source))?.blocks
  const segments: { text: string; page?: number; block?: string }[] = []
  for (const sec of manifest.sections) {
    if (sec.endPage < fromPage) continue // whole section is behind us
    const md = await fs.tryReadFile(`${indexDir}/${sec.file}`)
    if (!md) continue
    for (const line of md.split('\n')) {
      // Section lines are "[[id]] text" (optionally "## [[id]] heading").
      const m = /^(?:#{1,3}\s+)?\[\[([^\]]+)\]\]\s*(.*)$/.exec(line)
      if (!m) continue
      const text = m[2].trim()
      if (!text) continue
      const page = blocks?.[m[1]]?.page
      if (page !== undefined && page < fromPage) continue // block before current page
      segments.push({ text, page, block: m[1] })
    }
  }
  return segments
}
