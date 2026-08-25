/**
 * Parse an EPUB into a location-aware index under `.trace/epub-index/`,
 * skipping the work when a fresh index exists.
 */
import ePub from 'epubjs'
import * as fs from '@/lib/fs'
import { indexDirFor, readFreshManifest, sha256Hex, type IndexProgress } from '../util'
import { buildIndex } from './build'
import { extractEpub } from './extract'
import { INDEX_VERSION, type EpubIndexManifest, type EpubLocations } from './types'

export interface EpubParseResult {
  indexDir: string
  manifest: EpubIndexManifest
  cached: boolean
}

export async function parseEpub(
  source: string,
  onProgress: IndexProgress = () => {},
  opts: { force?: boolean } = {},
): Promise<EpubParseResult> {
  const indexDir = indexDirFor('epub', source)
  const bytes = await fs.readBinary(source)
  const contentHash = await sha256Hex(bytes)

  // Older-builder indexes stay fresh — only an explicit `force` rebuilds.
  if (!opts.force) {
    const fresh = await readFreshManifest<EpubIndexManifest>(indexDir, INDEX_VERSION, contentHash)
    if (fresh) return { indexDir, manifest: fresh, cached: true }
  }

  const book = ePub(bytes)
  try {
    await book.ready
    const extracted = await extractEpub(book, (c, t) => onProgress(c, t, 'extract'))
    // The turn is announced with no numbers of its own: what happens next —
    // inheriting ids, then rendering — has no unit worth counting until the
    // sections exist, and leaving the extractor's last page on screen through
    // it is exactly what looked hung.
    onProgress(0, 0, 'build')
    const manifest = await buildIndex({
      indexDir,
      source,
      title: extracted.title,
      author: extracted.author,
      contentHash,
      blocks: extracted.blocks,
      spineItems: extracted.spineItems,
      toc: extracted.toc,
      onProgress,
    })
    return { indexDir, manifest, cached: false }
  } finally {
    book.destroy()
  }
}

/** Load an EPUB's block→CFI map, or null when it has no index. */
export async function loadEpubLocations(source: string): Promise<EpubLocations | null> {
  const raw = await fs.tryReadFile(`${indexDirFor('epub', source)}/locations.json`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as EpubLocations
  } catch {
    return null
  }
}
