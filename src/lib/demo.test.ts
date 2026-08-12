/**
 * Guards on the shipped demo KB (`public/demo/`).
 *
 * The demo carries a prebuilt document index. Its freshness check compares the
 * stored format version against `INDEX_VERSION` — so bumping the version
 * without regenerating the demo does not break loudly, it makes every citation
 * in the demo stop resolving while everything still looks fine. That is the
 * worst possible failure for the one thing a first-time visitor is shown, so
 * it gets a test rather than a line in a doc.
 *
 * Regenerate with: `npm run dev`, open `/?demo-build=1`, then
 * `node scripts/build-demo.mjs ~/Downloads/demo-index.json`.
 *
 * Read through Vite rather than node:fs, per `claimPage.test.ts`: `src/` is
 * browser code and carries no node types.
 */
import { describe, it, expect } from 'vitest'
import { INDEX_VERSION } from './docindex/pdf/types'
import type { DemoManifest } from './demo'

/** Text assets by their path relative to this file. */
const TEXT = import.meta.glob('../../public/demo/**/*.{md,json}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Every asset, text or binary — url only, so the PDF is not read into memory. */
const PRESENT = import.meta.glob('../../public/demo/**/*', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

const key = (asset: string) => `../../public/demo/${asset}`
const text = (asset: string): string => {
  const found = TEXT[key(asset)]
  if (found === undefined) throw new Error(`demo asset missing or not text: ${asset}`)
  return found
}

const manifest = JSON.parse(text('manifest.json')) as DemoManifest
const seeded = manifest.files.map((f) => f.path)
const assetOf = (f: { path: string; asset?: string }) => f.asset ?? f.path

describe('demo knowledge base', () => {
  it('seeds the note it opens on', () => {
    expect(manifest.open).toBeTruthy()
    expect(seeded).toContain(manifest.open)
  })

  it('ships a PDF index at the current format version', () => {
    const indexes = manifest.files.filter((f) =>
      /^\.trace\/pdf-index\/[^/]+\/manifest\.json$/.test(f.path),
    )
    expect(indexes).toHaveLength(1)
    const parsed = JSON.parse(text(assetOf(indexes[0]))) as {
      version: number
      source: string
      blockCount: number
    }
    expect(parsed.version).toBe(INDEX_VERSION)
    expect(parsed.blockCount).toBeGreaterThan(0)
    // The indexed source must be seeded too, or the citations resolve to a
    // document that is not in the KB.
    expect(seeded).toContain(parsed.source)
  })

  it('cites only blocks the index actually contains', () => {
    const note = text(manifest.open!)
    const cited = [...note.matchAll(/\[\[(?:\d+:)?(b\d+-\d+)\]\]/g)].map((m) => m[1])
    expect(cited.length).toBeGreaterThan(0)

    const locations = manifest.files.find((f) => f.path.endsWith('/locations.json'))!
    const blocks = (JSON.parse(text(assetOf(locations))) as { blocks: Record<string, unknown> })
      .blocks
    for (const id of cited) expect(Object.keys(blocks)).toContain(id)
  })

  /**
   * Existence is not enough. Block ids are positional — regenerating the index
   * after an extractor change renumbers them, so a citation can keep resolving
   * while silently pointing at a different paragraph. That happened once: a
   * note's claim about worked examples ended up aimed at a fragment of a chart
   * legend, and every automatic check still passed. Pin the claims to their
   * evidence by content.
   */
  it('cites blocks that still say what the note claims they say', () => {
    const expected: Record<string, string> = {
      'b2-19': 'decompose the problem into intermediate steps',
      'b16-3': 'emerges only at certain model scales',
      'b25-1': 'without any finetuning',
      'b1-1': 'Chain-of-Thought Prompting',
    }
    const sections = Object.entries(TEXT)
      .filter(([path]) => path.includes('/sections/'))
      .map(([, body]) => body)
      .join('\n')

    for (const [id, phrase] of Object.entries(expected)) {
      const block = sections
        .split('\n')
        .find((l) => l.includes(`[[${id}]]`))
      expect(block, `block ${id} is missing from the index`).toBeTruthy()
      expect(block, `block ${id} no longer contains "${phrase}"`).toContain(phrase)
    }

    // And every id pinned above must actually be cited by the note, so this
    // table cannot rot into checking blocks nothing points at.
    const note = text(manifest.open!)
    for (const id of Object.keys(expected)) expect(note).toContain(id)
  })

  it('serves every seeded file from an undotted asset path that exists', () => {
    for (const file of manifest.files) {
      const asset = assetOf(file)
      // A leading-dot directory under `public/` is not reliably published, so
      // `.trace/…` is stored as `trace/…` and remapped when seeding.
      expect(asset.startsWith('.')).toBe(false)
      expect(PRESENT[key(asset)]).toBeTruthy()
    }
  })
})
