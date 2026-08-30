import { describe, it, expect, vi, beforeEach } from 'vitest'
import { INDEX_VERSION, BUILDER } from './pdf/types'

// indexState reads exactly one file: the manifest. Everything else about the
// index — even whether the source bytes changed — is deliberately not its job.
// `exists`/`readBinary` are here for renumberRisk, which asks the further
// questions indexState refuses to.
const manifests = new Map<string, string>()
const files = new Map<string, Uint8Array>()
const written = new Map<string, string>()
vi.mock('@/lib/fs', () => ({
  tryReadFile: (path: string) =>
    Promise.resolve(manifests.get(path) ?? written.get(path) ?? null),
  exists: (path: string) =>
    Promise.resolve(manifests.has(path) || files.has(path) || written.has(path)),
  readBinary: (path: string) =>
    Promise.resolve((files.get(path) ?? new Uint8Array()).buffer as ArrayBuffer),
  writeFile: (path: string, content: string) => {
    written.set(path, content)
    return Promise.resolve()
  },
}))

// The heavy half of a real build. Adoption is about what is on disk when it
// starts, so the parser is stubbed and only its inputs are asserted.
const parsePdf = vi.fn()
vi.mock('./pdf', () => ({
  parsePdf: (...args: unknown[]) => parsePdf(...args),
}))

import { indexState, indexableKind, renumberRisk, indexDocument } from './index'

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

/**
 * Adopting a renamed document's id record.
 *
 * `indexDirFor` keys on the source PATH, so renaming a file sends the next
 * build to a fresh directory with nothing to inherit from — and it numbers the
 * passages from scratch, which re-points every citation written before the
 * rename. Both directories describe the same bytes, which is the one condition
 * pdf/inherit needs, so the old record can simply be put where the build will
 * look for it.
 */
describe('indexDocument({ adoptIdsFrom })', () => {
  const BYTES = new TextEncoder().encode('the source bytes')
  const OLD = '.localmd/pdf-index/old-name-abc'

  beforeEach(() => {
    manifests.clear()
    files.clear()
    written.clear()
    parsePdf.mockReset()
    parsePdf.mockResolvedValue({
      indexDir: '.localmd/pdf-index/new-name-def',
      manifest: { title: 'T', blockCount: 3, sections: [1], pageCount: 9 },
      cached: false,
    })
    files.set('raw/books/new-name.pdf', BYTES)
  })

  async function hash(): Promise<string> {
    const { sha256Hex } = await import('./util')
    return sha256Hex(BYTES.buffer as ArrayBuffer)
  }

  function plantPrior(m: Record<string, unknown>): void {
    manifests.set(`${OLD}/manifest.json`, JSON.stringify(m))
    manifests.set(`${OLD}/locations.json`, '{"version":1,"pageSizes":[],"blocks":{"b1-1":{}}}')
  }

  it('copies the record to where the build inherits from, and forces the rebuild', async () => {
    plantPrior({ version: INDEX_VERSION, contentHash: await hash(), source: 'raw/books/old.pdf' })
    const { indexDirFor } = await import('./util')
    const target = indexDirFor('pdf', 'raw/books/new-name.pdf')

    await indexDocument('raw/books/new-name.pdf', undefined, { adoptIdsFrom: OLD })

    expect(written.get(`${target}/locations.json`)).toContain('b1-1')
    // Adoption without a rebuild would be a no-op, so it implies one.
    expect(parsePdf.mock.calls[0][2]).toMatchObject({ force: true })
  })

  // A manifest is only planted where the directory has none: the target's own
  // already vouches for these bytes. And `source` is corrected, so a build that
  // dies before writing its own leaves a manifest that is wrong about nothing.
  it('plants a corrected manifest only when the target has none', async () => {
    plantPrior({ version: INDEX_VERSION, contentHash: await hash(), source: 'raw/books/old.pdf' })
    const { indexDirFor } = await import('./util')
    const target = indexDirFor('pdf', 'raw/books/new-name.pdf')

    await indexDocument('raw/books/new-name.pdf', undefined, { adoptIdsFrom: OLD })
    expect(JSON.parse(written.get(`${target}/manifest.json`)!)).toMatchObject({
      source: 'raw/books/new-name.pdf',
    })

    written.clear()
    manifests.set(`${target}/manifest.json`, JSON.stringify({ version: INDEX_VERSION }))
    await indexDocument('raw/books/new-name.pdf', undefined, { adoptIdsFrom: OLD })
    expect(written.has(`${target}/manifest.json`)).toBe(false)
  })

  // The entire safety of inheritance is that the stored rects describe THESE
  // pages. Refusing loudly matters because a silent no-op looks like success
  // and leaves the citations broken.
  it('refuses a record built from different bytes', async () => {
    plantPrior({ version: INDEX_VERSION, contentHash: 'not-the-same', source: 'x.pdf' })
    await expect(
      indexDocument('raw/books/new-name.pdf', undefined, { adoptIdsFrom: OLD }),
    ).rejects.toThrow(/different bytes/)
    expect(parsePdf).not.toHaveBeenCalled()
  })

  it('refuses a format version it cannot verify', async () => {
    plantPrior({ version: INDEX_VERSION - 1, contentHash: await hash(), source: 'x.pdf' })
    await expect(
      indexDocument('raw/books/new-name.pdf', undefined, { adoptIdsFrom: OLD }),
    ).rejects.toThrow(/does not speak/)
  })

  it('refuses when there is no record there at all', async () => {
    await expect(
      indexDocument('raw/books/new-name.pdf', undefined, { adoptIdsFrom: OLD }),
    ).rejects.toThrow(/No index manifest/)

    manifests.set(
      `${OLD}/manifest.json`,
      JSON.stringify({ version: INDEX_VERSION, contentHash: await hash() }),
    )
    await expect(
      indexDocument('raw/books/new-name.pdf', undefined, { adoptIdsFrom: OLD }),
    ).rejects.toThrow(/no locations\.json/)
  })

  // EPUB/DOCX/md ids come out of the document's own structure and have no
  // inheritance step; a record handed to them would be silently ignored.
  it('refuses for a format with no inheritance to feed', async () => {
    files.set('raw/books/b.epub', BYTES)
    await expect(
      indexDocument('raw/books/b.epub', undefined, { adoptIdsFrom: OLD }),
    ).rejects.toThrow(/PDF repair/)
  })
})
