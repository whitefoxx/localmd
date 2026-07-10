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
