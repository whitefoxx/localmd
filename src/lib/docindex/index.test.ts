import { describe, it, expect, vi, beforeEach } from 'vitest'
import { INDEX_VERSION, BUILDER } from './pdf/types'

// indexState reads exactly one file: the manifest. Everything else about the
// index — even whether the source bytes changed — is deliberately not its job.
// `exists`/`readBinary` are here for renumberRisk, which asks the further
// questions indexState refuses to.
const manifests = new Map<string, string>()
const files = new Map<string, Uint8Array>()
vi.mock('@/lib/fs', () => ({
  tryReadFile: (path: string) => Promise.resolve(manifests.get(path) ?? null),
  exists: (path: string) => Promise.resolve(manifests.has(path) || files.has(path)),
  readBinary: (path: string) =>
    Promise.resolve((files.get(path) ?? new Uint8Array()).buffer as ArrayBuffer),
}))

import { indexState, indexableKind, renumberRisk } from './index'

describe('indexState', () => {
  beforeEach(() => manifests.clear())

  async function stateFor(manifest: unknown): Promise<string> {
    // Resolve the real index dir for the fixed path, then plant the manifest.
    const { indexDirFor } = await import('./util')
    const dir = indexDirFor('pdf', 'raw/x.pdf')
    manifests.set(
      `${dir}/manifest.json`,
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    )
    return indexState('raw/x.pdf')
  }

  it('is absent for a non-indexable path', async () => {
    expect(await indexState('wiki/note.txt')).toBe('absent')
  })

  it('is absent without a manifest', async () => {
    expect(await indexState('raw/x.pdf')).toBe('absent')
  })

  it('is absent on a corrupt manifest', async () => {
    expect(await stateFor('{not json')).toBe('absent')
  })

  it('is incompatible on a version this reader does not speak', async () => {
    expect(await stateFor({ version: INDEX_VERSION + 1 })).toBe('incompatible')
  })

  it('reads a manifest without builder as builder 1', async () => {
    // Pre-split indexes lack the field. While BUILDER was 1 they read as
    // current (the split itself changed no output); the first real algorithm
    // change made them genuinely outdated — usable, rebuild offered.
    expect(await stateFor({ version: INDEX_VERSION })).toBe(
      BUILDER > 1 ? 'outdated' : 'current',
    )
  })

  it('is outdated below the current builder, current at or above it', async () => {
    expect(await stateFor({ version: INDEX_VERSION, builder: BUILDER - 1 })).toBe('outdated')
    expect(await stateFor({ version: INDEX_VERSION, builder: BUILDER })).toBe('current')
    expect(await stateFor({ version: INDEX_VERSION, builder: BUILDER + 9 })).toBe('current')
  })
})

describe('indexableKind', () => {
  it('claims the four kinds and rejects the rest', () => {
    expect(indexableKind('a/b.PDF')).toBe('pdf')
    expect(indexableKind('a/b.epub')).toBe('epub')
    expect(indexableKind('a/b.md')).toBe('md')
    expect(indexableKind('a/b.docx')).toBe('docx')
    expect(indexableKind('a/b.txt')).toBeNull()
  })
})

/**
 * The question asked before a build that could hand a published block id to a
 * different passage. Both halves of the real check live apart on purpose (see
 * lib/renumber); this is the half that reads the files.
 */
describe('renumberRisk', () => {
  beforeEach(() => {
    manifests.clear()
    files.clear()
  })

  const BYTES = new TextEncoder().encode('the source bytes')
  /** sha256 of BYTES, computed the way util.sha256Hex does. */
  async function hashOfSource(): Promise<string> {
    const { sha256Hex } = await import('./util')
    return sha256Hex(BYTES.buffer as ArrayBuffer)
  }

  async function plant(
    path: string,
    manifest: Record<string, unknown> | null,
    opts: { locations?: boolean } = {},
  ): Promise<string> {
    const { indexDirFor } = await import('./util')
    const kind = indexableKind(path)!
    const dir = indexDirFor(kind, path)
    files.set(path, BYTES)
    if (manifest) manifests.set(`${dir}/manifest.json`, JSON.stringify(manifest))
    if (opts.locations !== false) files.set(`${dir}/locations.json`, new Uint8Array())
    return dir
  }

  it('is null for something that has no index at all', async () => {
    expect(await renumberRisk('wiki/note.txt')).toBeNull()
  })

  // The migration case this whole check exists for: `.localmd/` is gitignored,
  // so a `git clone` on a second machine brings the notes and not the ids.
  it('has no record when the index never came along', async () => {
    files.set('raw/x.pdf', BYTES)
    expect(await renumberRisk('raw/x.pdf')).toBe('no-record')
  })

  it('has no record when the manifest is a version this reader cannot speak', async () => {
    await plant('raw/x.pdf', { version: INDEX_VERSION - 1, builder: BUILDER, contentHash: 'x' })
    expect(await renumberRisk('raw/x.pdf')).toBe('no-record')
  })

  // A manifest alone is not the record: ids are carried forward out of
  // locations.json, and a half-swept directory reads as indexed without it.
  it('has no record when a PDF index lost its locations.json', async () => {
    await plant(
      'raw/x.pdf',
      { version: INDEX_VERSION, builder: BUILDER, contentHash: await hashOfSource() },
      { locations: false },
    )
    expect(await renumberRisk('raw/x.pdf')).toBe('no-record')
  })

  it('reports the source changing out from under the ids', async () => {
    await plant('raw/x.pdf', { version: INDEX_VERSION, builder: BUILDER, contentHash: 'stale' })
    expect(await renumberRisk('raw/x.pdf')).toBe('source-changed')
  })

  // What pdf/inherit is for: same bytes, older algorithm, ids carried forward.
  it('is null for a PDF that can inherit, however old its builder', async () => {
    await plant('raw/x.pdf', { version: INDEX_VERSION, contentHash: await hashOfSource() })
    expect(await renumberRisk('raw/x.pdf')).toBeNull()
  })

  it('is null when the same algorithm would number it again', async () => {
    const { INDEX_VERSION: EPUB_V, BUILDER: EPUB_B } = await import('./epub/types')
    await plant('raw/b.epub', { version: EPUB_V, builder: EPUB_B, contentHash: await hashOfSource() })
    expect(await renumberRisk('raw/b.epub')).toBeNull()
  })

  // EPUB numbers from the spine and has no carry-forward mechanism, so a
  // newer algorithm is exactly the case its own types.ts warns about. The
  // older revision is synthetic while EPUB's BUILDER is still 1; the point is
  // the comparison, which has to hold on the day that changes.
  it('flags a format with no inheritance about to be rebuilt by a newer one', async () => {
    const { INDEX_VERSION: EPUB_V, BUILDER: EPUB_B } = await import('./epub/types')
    await plant('raw/b.epub', {
      version: EPUB_V,
      builder: EPUB_B - 1,
      contentHash: await hashOfSource(),
    })
    expect(await renumberRisk('raw/b.epub')).toBe('no-inheritance')
  })
})
