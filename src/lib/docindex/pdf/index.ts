/**
 * Parse a PDF into a location-aware index under `.trace/pdf-index/`, skipping
 * the work when a fresh index (same format version + content hash) exists.
 */
import * as fs from '@/lib/fs'
import { indexDirFor, readFreshManifest, sha256Hex } from '../util'
import { buildIndex } from './build'
import { extractPdf } from './extract'
import { INDEX_VERSION, type PdfIndexManifest, type PdfLocations } from './types'

export interface PdfParseResult {
  indexDir: string
  manifest: PdfIndexManifest
  cached: boolean
}

export async function parsePdf(
  source: string,
  onProgress: (page: number, total: number) => void = () => {},
): Promise<PdfParseResult> {
  const indexDir = indexDirFor('pdf', source)
  const bytes = await fs.readBinary(source)
  const contentHash = await sha256Hex(bytes)

  const fresh = await readFreshManifest<PdfIndexManifest>(indexDir, INDEX_VERSION, contentHash)
  if (fresh) return { indexDir, manifest: fresh, cached: true }

  const base = source.split('/').pop()?.replace(/\.pdf$/i, '') ?? source
  const extracted = await extractPdf(bytes, base, onProgress)
  const manifest = await buildIndex({
    indexDir,
    source,
    title: extracted.title,
    contentHash,
    pageCount: extracted.pageCount,
    pageSizes: extracted.pageSizes,
    blocks: extracted.blocks,
    outline: extracted.outline,
  })
  return { indexDir, manifest, cached: false }
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
 * Speech segments of a PDF from `fromPage` to the end, in reading order — text
 * pulled from the section markdown files, page numbers from the block→page map
 * so read-aloud can follow along page by page. Consecutive blocks on the same
 * page merge into one segment. [] when unindexed.
 */
export async function loadPdfSpeechSegments(
  source: string,
  fromPage: number,
): Promise<{ text: string; page?: number }[]> {
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
  const segments: { text: string; page?: number }[] = []
  const push = (text: string, page: number | undefined): void => {
    const last = segments[segments.length - 1]
    if (last && last.page === page) last.text += `\n${text}`
    else segments.push({ text, page })
  }
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
      push(text, page)
    }
  }
  return segments
}
