/**
 * Parse a PDF into a location-aware index under `.localmd/pdf-index/`, skipping
 * the work when a fresh index (same format version + content hash) exists.
 */
import * as fs from '@/lib/fs'
import { indexDirFor, readFreshManifest, sha256Hex, type IndexProgress } from '../util'
import { buildIndex } from './build'
import { extractPdf } from './extract'
import { inheritIds, type PriorEntry } from './inherit'
import { INDEX_VERSION, type PdfIndexManifest, type PdfLocations } from './types'

export interface PdfParseResult {
  indexDir: string
  manifest: PdfIndexManifest
  cached: boolean
}

export async function parsePdf(
  source: string,
  onProgress: IndexProgress = () => {},
  opts: { force?: boolean } = {},
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
  const extracted = await extractPdf(bytes, base, (c, t) => onProgress(c, t, 'extract'))
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
