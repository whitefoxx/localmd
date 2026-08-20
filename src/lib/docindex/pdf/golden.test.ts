/**
 * The golden fixture: six pages of real, public-domain prose (Federal Reserve
 * 2023 annual report, pp. 21–26) captured at the pdf.js RawItem level, run
 * through the real layout → blocks pipeline, and compared against the
 * committed expected output.
 *
 * WHEN THIS TEST FAILS you have changed what the pipeline publishes — block
 * boundaries, ids, kinds, or text. That is allowed, but it is a CONTRACT
 * event, not a fixup:
 *   1. bump BUILDER in ./types.ts (existing indexes become "outdated" —
 *      usable, rebuild offered, never forced);
 *   2. satisfy yourself that inheritIds carries every published id of the
 *      OLD golden onto the new output — the inheritance part of this file
 *      checks exactly that, against the previous golden;
 *   3. regenerate: UPDATE_GOLDEN=1 npx vitest run src/lib/docindex/pdf/golden.test.ts
 * Never regenerate to make a red test green without steps 1 and 2.
 */
import { describe, it, expect } from 'vitest'
// The app tsconfig is browser-only on purpose (see sourceBytes.test.ts);
// this test runs in vitest's node runtime, typed by hand.
// @ts-expect-error node types are intentionally not installed
import { readFileSync, writeFileSync } from 'node:fs'
// @ts-expect-error node types are intentionally not installed
import { fileURLToPath } from 'node:url'

const env: Record<string, string | undefined> =
  (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process
    ?.env ?? {}
import { assembleBlocks, layoutPage, type Line, type RawItem, type TextBounds } from './layout'
import { inheritIds, overlap, type PriorEntry } from './inherit'
import type { PdfBlock } from './types'

const dir = fileURLToPath(new URL('./__fixtures__/', import.meta.url))

interface FixturePage {
  w: number
  h: number
  items: RawItem[]
}

function pipeline(): { blocks: PdfBlock[]; pageSizes: { w: number; h: number }[] } {
  const pages = JSON.parse(
    readFileSync(`${dir}fed-report-p21-26.rawitems.json`, 'utf8'),
  ) as FixturePage[]
  const pageLines: Line[][] = []
  const pageBounds: TextBounds[] = []
  for (const p of pages) {
    const laid = layoutPage(p.items, p.h)
    pageLines.push(laid.lines)
    pageBounds.push(laid.bounds)
  }
  const pageSizes = pages.map((p) => ({ w: p.w, h: p.h }))
  return { blocks: assembleBlocks(pageLines, pageBounds, pageSizes), pageSizes }
}

/** What the pipeline publishes, in comparable form (rects rounded — float
 *  noise is not a contract change). */
function published(blocks: PdfBlock[]) {
  const r4 = (n: number) => Math.round(n * 10000) / 10000
  return blocks.map((b) => ({
    id: b.id,
    page: b.page,
    kind: b.kind,
    level: b.level,
    text: b.text,
    rects: b.rects.map((r) => ({ x: r4(r.x), y: r4(r.y), w: r4(r.w), h: r4(r.h) })),
  }))
}

const GOLDEN = `${dir}fed-report-p21-26.blocks.json`

describe('golden: the published pipeline output is a contract', () => {
  it('matches the committed golden blocks (see file header before touching this)', () => {
    const got = published(pipeline().blocks)
    if (env.UPDATE_GOLDEN) {
      writeFileSync(GOLDEN, JSON.stringify(got, null, 1))
    }
    const want = JSON.parse(readFileSync(GOLDEN, 'utf8'))
    expect(got).toEqual(want)
  })

  it('sanity: the fixture is real prose, not a degenerate page set', () => {
    const { blocks } = pipeline()
    expect(blocks.length).toBeGreaterThan(50)
    expect(blocks.filter((b) => b.kind === 'heading').length).toBeGreaterThan(3)
    expect(blocks.some((b) => b.text.length > 300)).toBe(true)
  })
})

describe('golden: inheritance holds across a simulated algorithm change', () => {
  // A plausible future builder: drops short all-caps furniture and merges
  // each heading into… no — the simulation must not mirror one specific
  // planned change; it perturbs in the three ways any regrouping can:
  // drop blocks, split blocks, merge blocks.
  function perturb(blocks: PdfBlock[]): PdfBlock[] {
    const out: PdfBlock[] = []
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      if (b.text.length < 20 && b.kind === 'text') continue // "boilerplate filter"
      if (b.rects.length >= 4) {
        // split in half
        const cut = Math.floor(b.rects.length / 2)
        out.push({ ...b, rects: b.rects.slice(0, cut), text: b.text.slice(0, 50) })
        out.push({ ...b, rects: b.rects.slice(cut), text: b.text.slice(50) })
        continue
      }
      const next = blocks[i + 1]
      if (next && next.page === b.page && b.kind === 'text' && next.kind === 'text' && i % 5 === 0) {
        // merge with the next block
        out.push({ ...b, rects: [...b.rects, ...next.rects], text: `${b.text} ${next.text}` })
        i++
        continue
      }
      out.push(b)
    }
    // Renumber positionally, page by page — what a naive rebuild would do.
    const counter = new Map<number, number>()
    return out.map((b) => {
      const n = (counter.get(b.page) ?? 0) + 1
      counter.set(b.page, n)
      return { ...b, id: `b${b.page}-${n}` }
    })
  }

  it('every published id still resolves, to geometry overlapping where it pointed', () => {
    const { blocks } = pipeline()
    const prior: Record<string, PriorEntry> = {}
    for (const b of blocks) prior[b.id] = { page: b.page, rects: b.rects }

    const next = perturb(blocks)
    const r = inheritIds(next, prior)

    for (const [id, was] of Object.entries(prior)) {
      const now = r.locations[id]
      expect(now, `published id ${id} vanished`).toBeDefined()
      expect(now.page, `published id ${id} changed page`).toBe(was.page)
      expect(
        overlap(now.rects, was.rects),
        `published id ${id} moved off its passage`,
      ).toBeGreaterThan(0)
    }
    const ids = r.blocks.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('an unchanged algorithm inherits every id onto itself', () => {
    const { blocks } = pipeline()
    const prior: Record<string, PriorEntry> = {}
    for (const b of blocks) prior[b.id] = { page: b.page, rects: b.rects }
    const r = inheritIds(blocks, prior)
    expect(r.blocks.map((b) => b.id)).toEqual(blocks.map((b) => b.id))
  })
})
