/**
 * Unified entry to the document indexers. `indexDocument` dispatches by
 * extension and returns a uniform summary the UI and the agent tool share.
 */
import * as fs from '@/lib/fs'
import { indexDirFor } from './util'

export interface IndexSummary {
  kind: 'pdf' | 'epub' | 'md'
  indexDir: string
  title: string
  blockCount: number
  sectionCount: number
  cached: boolean
}

export type IndexProgress = (current: number, total: number) => void

export function indexableKind(path: string): 'pdf' | 'epub' | 'md' | null {
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (/\.epub$/i.test(path)) return 'epub'
  if (/\.md$/i.test(path)) return 'md'
  return null
}

export async function indexDocument(
  path: string,
  onProgress: IndexProgress = () => {},
): Promise<IndexSummary> {
  const kind = indexableKind(path)
  if (!kind) throw new Error(`Not an indexable document: ${path} (pdf/epub/md only)`)

  if (kind === 'pdf') {
    const { parsePdf } = await import('./pdf')
    const r = await parsePdf(path, onProgress)
    return {
      kind,
      indexDir: r.indexDir,
      title: r.manifest.title,
      blockCount: r.manifest.blockCount,
      sectionCount: r.manifest.sections.length,
      cached: r.cached,
    }
  }
  if (kind === 'epub') {
    const { parseEpub } = await import('./epub')
    const r = await parseEpub(path, onProgress)
    return {
      kind,
      indexDir: r.indexDir,
      title: r.manifest.title,
      blockCount: r.manifest.blockCount,
      sectionCount: r.manifest.sections.length,
      cached: r.cached,
    }
  }
  const { indexMarkdown } = await import('./md')
  const r = await indexMarkdown(path)
  return {
    kind,
    indexDir: r.indexDir,
    title: r.manifest.title,
    blockCount: r.manifest.blockCount,
    sectionCount: r.manifest.sections.length,
    cached: r.cached,
  }
}

/** Whether any index directory exists for this source (fresh or stale). */
export async function hasIndex(path: string): Promise<boolean> {
  const kind = indexableKind(path)
  if (!kind) return false
  return fs.exists(`${indexDirFor(kind, path)}/manifest.json`)
}

export { indexDirFor }
