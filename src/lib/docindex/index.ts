/**
 * Unified entry to the document indexers. `indexDocument` dispatches by
 * extension and returns a uniform summary the UI and the agent tool share.
 */
import * as fs from '@/lib/fs'
import { indexDirFor, type IndexProgress } from './util'
import { BUILDER as PDF_BUILDER, INDEX_VERSION as PDF_VERSION } from './pdf/types'
import { BUILDER as EPUB_BUILDER, INDEX_VERSION as EPUB_VERSION } from './epub/types'
import { BUILDER as DOCX_BUILDER, INDEX_VERSION as DOCX_VERSION } from './docx/types'

export interface IndexSummary {
  kind: 'pdf' | 'epub' | 'md' | 'docx'
  indexDir: string
  title: string
  blockCount: number
  sectionCount: number
  cached: boolean
}

export type { IndexPhase, IndexProgress } from './util'

export interface IndexOpts {
  /** Rebuild even when a usable index exists — the user's explicit choice. */
  rebuild?: boolean
}

/**
 * How an on-disk index relates to the app's current reader and algorithm.
 *
 * - `absent`       no manifest (never indexed, or a build died before the
 *                  manifest — which is written last precisely so this state
 *                  catches it and a clean rebuild follows).
 * - `incompatible` a version this reader does not speak; unusable, so an
 *                  automatic rebuild is fair game.
 * - `outdated`     usable, but built by an older algorithm revision. The app
 *                  may point this out; it must never rebuild uninvited.
 * - `current`      built by the current algorithm.
 *
 * Deliberately cheap — reads only manifest.json. Whether the SOURCE bytes
 * changed under the index is the parse functions' business (they hash), not
 * this query's: a badge must not cost a full-file hash on every open.
 */
export type DocIndexState = 'absent' | 'incompatible' | 'outdated' | 'current'

// md's constants live in ./md (light, but pulled lazily like the others).
const CONTRACT: Record<Exclude<ReturnType<typeof indexableKind>, null>, { version: number; builder: number } | null> = {
  pdf: { version: PDF_VERSION, builder: PDF_BUILDER },
  epub: { version: EPUB_VERSION, builder: EPUB_BUILDER },
  docx: { version: DOCX_VERSION, builder: DOCX_BUILDER },
  md: null, // resolved on demand below
}

export async function indexState(path: string): Promise<DocIndexState> {
  const kind = indexableKind(path)
  if (!kind) return 'absent'
  const raw = await fs.tryReadFile(`${indexDirFor(kind, path)}/manifest.json`)
  if (!raw) return 'absent'
  let contract = CONTRACT[kind]
  if (!contract) {
    const m = await import('./md')
    contract = { version: m.INDEX_VERSION, builder: m.BUILDER }
  }
  try {
    const m = JSON.parse(raw) as { version?: number; builder?: number }
    if (m.version !== contract.version) return 'incompatible'
    return (m.builder ?? 1) < contract.builder ? 'outdated' : 'current'
  } catch {
    return 'absent'
  }
}

export function indexableKind(path: string): 'pdf' | 'epub' | 'md' | 'docx' | null {
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (/\.epub$/i.test(path)) return 'epub'
  if (/\.md$/i.test(path)) return 'md'
  // Legacy .doc is claimed here too, so the attempt fails with a message that
  // explains itself instead of "not an indexable document".
  if (/\.docx?$/i.test(path)) return 'docx'
  return null
}

export async function indexDocument(
  path: string,
  onProgress: IndexProgress = () => {},
  opts: IndexOpts = {},
): Promise<IndexSummary> {
  const kind = indexableKind(path)
  if (!kind) throw new Error(`Not an indexable document: ${path} (pdf/epub/md only)`)
  const force = { force: opts.rebuild }

  if (kind === 'pdf') {
    const { parsePdf } = await import('./pdf')
    const r = await parsePdf(path, onProgress, force)
    return {
      kind,
      indexDir: r.indexDir,
      title: r.manifest.title,
      blockCount: r.manifest.blockCount,
      sectionCount: r.manifest.sections.length,
      cached: r.cached,
    }
  }
  if (kind === 'docx') {
    const { parseDocx } = await import('./docx')
    const r = await parseDocx(path, onProgress, force)
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
    const r = await parseEpub(path, onProgress, force)
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
  const r = await indexMarkdown(path, force)
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
