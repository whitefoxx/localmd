/**
 * Unified entry to the document indexers. `indexDocument` dispatches by
 * extension and returns a uniform summary the UI and the agent tool share.
 */
import * as fs from '@/lib/fs'
import { indexDirFor, sha256Hex, type IndexProgress } from './util'
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
  /** PDFs only — what the OCR offer needs to price itself before it starts. */
  pageCount?: number
}

export type { IndexPhase, IndexProgress } from './util'

export interface IndexOpts {
  /** Rebuild even when a usable index exists — the user's explicit choice. */
  rebuild?: boolean
  /**
   * Take the block-id record of ANOTHER index directory before rebuilding, so
   * ids published against it resolve again. The repair for a renamed document:
   * `indexDirFor` keys on the source PATH, so renaming a file sends the next
   * build to a fresh directory with nothing to inherit from, and it numbers
   * the passages from scratch — every citation written before the rename then
   * points somewhere else. Both directories describe the same bytes, which is
   * the one condition pdf/inherit needs, so handing the old `locations.json`
   * to the new build is not a trick: it is the inheritance that would have
   * happened had the name not changed.
   *
   * Implies a rebuild, and is never taken on the app's own initiative.
   */
  adoptIdsFrom?: string
  /** Read a PDF's pages as pictures rather than looking for a text layer.
   *  Ignored by every other kind, and never set on the app's own behalf: it
   *  costs seconds of CPU per page and downloads a language pack. */
  ocr?: {
    lang: string
    onPage?: (page: number, total: number) => void
    signal?: AbortSignal
  }
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

/** The reader/algorithm revisions this build of the app speaks for `kind`. */
async function contractFor(
  kind: Exclude<ReturnType<typeof indexableKind>, null>,
): Promise<{ version: number; builder: number }> {
  const contract = CONTRACT[kind]
  if (contract) return contract
  const m = await import('./md')
  return { version: m.INDEX_VERSION, builder: m.BUILDER }
}

export async function indexState(path: string): Promise<DocIndexState> {
  const kind = indexableKind(path)
  if (!kind) return 'absent'
  const raw = await fs.tryReadFile(`${indexDirFor(kind, path)}/manifest.json`)
  if (!raw) return 'absent'
  const contract = await contractFor(kind)
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
  if (opts.adoptIdsFrom) await adoptIds(kind, path, opts.adoptIdsFrom)
  const force = { force: opts.rebuild || !!opts.adoptIdsFrom }

  if (kind === 'pdf') {
    const { parsePdf } = await import('./pdf')
    // OCR implies a rebuild: the index it replaces is a fresh, valid,
    // empty one, and `force` is the only thing that gets past that. So does
    // adopting a record — the point of it is the numbering the rebuild does.
    const r = await parsePdf(path, onProgress, {
      force: force.force || !!opts.ocr,
      ocr: opts.ocr,
    })
    return {
      kind,
      indexDir: r.indexDir,
      title: r.manifest.title,
      blockCount: r.manifest.blockCount,
      sectionCount: r.manifest.sections.length,
      cached: r.cached,
      pageCount: r.manifest.pageCount,
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

/**
 * Whether building an index for `path` right now could hand an already-published
 * block id to a different passage.
 *
 * A block id is a name, not a position: `[[1:b14-3]]` in someone's notes is a
 * promise that the ordinal keeps pointing at the paragraph it was written
 * against. PDFs keep that promise across rebuilds by inheriting ids from the
 * previous `locations.json` (pdf/inherit) — but inheritance needs that record
 * to be here, and to describe these very bytes. When it is not, the build
 * numbers from scratch, and it does so silently: every citation still resolves,
 * just possibly to the wrong paragraph.
 *
 * That is the whole reason this query exists. The dangerous case is not an
 * exotic one — it is a knowledge base opened on a second machine, where
 * `.localmd/` was never copied (it is gitignored, so a `git clone` does not
 * bring it) and the viewer would otherwise index the document on open without
 * anyone being asked.
 *
 * - `no-record`      nothing here to inherit from: never indexed on this
 *                    machine, an index from an unreadable format version, or
 *                    one whose `locations.json` is gone. What the ids were
 *                    built by is unknowable, so the risk is unknowable.
 * - `source-changed` the file's bytes are not the ones the ids were made
 *                    against, so the old coordinates describe pages that no
 *                    longer exist and inheritance correctly refuses them.
 * - `no-inheritance` EPUB/DOCX/markdown, whose ids come out of the document's
 *                    own structure and have no carry-forward mechanism, about
 *                    to be rebuilt by a NEWER algorithm than made them.
 * - `null`           the ids survive: a PDF that can inherit, or a rebuild by
 *                    the same algorithm that assigned them.
 *
 * Whether anything is actually AT stake — whether a note cites this document
 * at all — is a separate question, answered from the page cache by
 * `publishedCitations` (lib/citations). Both halves are needed before anyone
 * is worth interrupting; see lib/renumber.
 *
 * Costs a hash of the source, so call it when a build is imminent, never to
 * paint a badge.
 */
export type RenumberRisk = 'no-record' | 'source-changed' | 'no-inheritance' | null

export async function renumberRisk(path: string): Promise<RenumberRisk> {
  const kind = indexableKind(path)
  if (!kind) return null
  const dir = indexDirFor(kind, path)
  const raw = await fs.tryReadFile(`${dir}/manifest.json`)
  if (!raw) return 'no-record'
  let manifest: { version?: number; builder?: number; contentHash?: string }
  try {
    manifest = JSON.parse(raw) as typeof manifest
  } catch {
    return 'no-record'
  }
  const contract = await contractFor(kind)
  if (manifest.version !== contract.version) return 'no-record'
  // PDF ids are carried forward from locations.json; without it the manifest
  // alone proves nothing (a half-swept directory reads as "indexed" but has
  // no record to inherit).
  if (kind === 'pdf' && !(await fs.exists(`${dir}/locations.json`))) return 'no-record'
  if (manifest.contentHash !== (await sha256Hex(await fs.readBinary(path)))) {
    return 'source-changed'
  }
  if (kind === 'pdf') return null
  return (manifest.builder ?? 1) < contract.builder ? 'no-inheritance' : null
}

/**
 * Put another index directory's id record where this build will inherit it.
 *
 * Everything is verified before a byte is written, because the whole safety of
 * inheritance is that the prior rects describe THESE pages: the record must be
 * a format this reader speaks, and its contentHash must be the hash of the
 * source we are about to index. A mismatch is refused with the reason rather
 * than quietly doing nothing — a silent no-op here looks exactly like success
 * and leaves the citations broken.
 *
 * Copies `locations.json` only. The target's own manifest already vouches for
 * the same bytes (that is what was just checked), so it is the record, not the
 * manifest, that is missing. When the target has no manifest at all — its
 * directory was cleared — the prior one is planted with `source` corrected to
 * this file, so a build that dies before writing its own leaves a manifest
 * that is wrong about nothing.
 */
async function adoptIds(
  kind: Exclude<ReturnType<typeof indexableKind>, null>,
  path: string,
  from: string,
): Promise<void> {
  if (kind !== 'pdf') {
    throw new Error(
      `Adopting block ids is a PDF repair: ${kind.toUpperCase()} ids come from the document's own structure and have no inheritance step to feed (see docindex/${kind}/types.ts).`,
    )
  }
  const dir = from.replace(/\/+$/, '')
  const rawManifest = await fs.tryReadFile(`${dir}/manifest.json`)
  if (!rawManifest) throw new Error(`No index manifest at ${dir}/manifest.json`)
  let prior: { version?: number; contentHash?: string; source?: string }
  try {
    prior = JSON.parse(rawManifest) as typeof prior
  } catch {
    throw new Error(`${dir}/manifest.json is not readable JSON`)
  }
  const contract = await contractFor(kind)
  if (prior.version !== contract.version) {
    throw new Error(
      `${dir} is index version ${String(prior.version)}, which this reader does not speak (expects ${contract.version}) — its ids cannot be verified against this file.`,
    )
  }
  const hash = await sha256Hex(await fs.readBinary(path))
  if (prior.contentHash !== hash) {
    throw new Error(
      `${dir} was built from different bytes than ${path} (${String(prior.contentHash).slice(0, 12)} vs ${hash.slice(0, 12)}). Its coordinates describe pages this file does not have, so inheriting them would pin ids to the wrong passages. Refused.`,
    )
  }
  const locations = await fs.tryReadFile(`${dir}/locations.json`)
  if (!locations) throw new Error(`${dir} has no locations.json — nothing to adopt`)

  const target = indexDirFor(kind, path)
  await fs.writeFile(`${target}/locations.json`, locations)
  if (!(await fs.exists(`${target}/manifest.json`))) {
    await fs.writeFile(`${target}/manifest.json`, JSON.stringify({ ...prior, source: path }))
  }
}

export { indexDirFor }
