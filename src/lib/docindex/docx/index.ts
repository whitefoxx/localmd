/**
 * Parse a .docx into an index under `.localmd/docx-index/`, skipping the work
 * when a fresh index already exists.
 */
import * as fs from '@/lib/fs'
import { indexDirFor, readFreshManifest, sha256Hex, type IndexProgress } from '../util'
import { buildIndex } from './build'
import { extractDocx } from './extract'
import { INDEX_VERSION, type DocxIndexManifest } from './types'

export interface DocxParseResult {
  indexDir: string
  manifest: DocxIndexManifest
  cached: boolean
}

export async function parseDocx(
  source: string,
  onProgress: IndexProgress = () => {},
  opts: { force?: boolean } = {},
): Promise<DocxParseResult> {
  const indexDir = indexDirFor('docx', source)
  const bytes = await fs.readBinary(source)
  const contentHash = await sha256Hex(bytes)

  // Older-builder indexes stay fresh — only an explicit `force` rebuilds.
  if (!opts.force) {
    const fresh = await readFreshManifest<DocxIndexManifest>(indexDir, INDEX_VERSION, contentHash)
    if (fresh) return { indexDir, manifest: fresh, cached: true }
  }

  const fallbackTitle = (source.split('/').pop() ?? source).replace(/\.docx?$/i, '')
  const extracted = await extractDocx(bytes, fallbackTitle, (c, t) => onProgress(c, t, 'extract'))
  // The turn is announced with no numbers of its own: what happens next —
  // inheriting ids, then rendering — has no unit worth counting until the
  // sections exist, and leaving the extractor's last page on screen through
  // it is exactly what looked hung.
  onProgress(0, 0, 'build')
  const manifest = await buildIndex({
    indexDir,
    source,
    title: extracted.title,
    contentHash,
    blocks: extracted.blocks,
    onProgress,
  })
  return { indexDir, manifest, cached: false }
}
