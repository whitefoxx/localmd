/**
 * Block-id inheritance across index rebuilds.
 *
 * The invariant this module exists to keep:
 *
 *     An id, once published, always resolves to the same passage.
 *
 * Ids look positional (`b14-3` = 3rd block on page 14) and historically were
 * exactly that: a rebuild renumbered whatever the grouper produced, so any
 * algorithm improvement would silently re-point every citation already
 * written into the user's notes — each one still resolving *successfully*,
 * just to the wrong paragraph, with no signal to anyone. The page prefix
 * stays meaningful; the ordinal, from here on, is a NAME, not a position —
 * once published it is never reassigned to different text.
 *
 * How, with no LLM and no format change:
 *
 * - Inheritance runs only when the source bytes are unchanged (the caller
 *   verifies contentHash). Then the prior locations.json rects are still
 *   valid coordinates in this very PDF, and geometry is ground truth — the
 *   same passage sits at the same place regardless of how either algorithm
 *   grouped it.
 * - Each new block takes over the prior id whose rects it overlaps best
 *   (same page, greedy best-match, above a floor). An unchanged algorithm
 *   re-matches every block to its own id — a forced rebuild is a no-op.
 * - Prior ids no new block claims are CARRIED FORWARD into locations.json
 *   verbatim: the passage they point at still exists at those coordinates,
 *   so existing citations keep resolving; the id simply no longer appears in
 *   the freshly rendered section files.
 * - Genuinely new blocks get ordinals that have never been used on their
 *   page. The high-water mark is derived from everything carried, and
 *   because carried ids are never dropped, an ordinal retired by one rebuild
 *   cannot be recycled for different text by a later one.
 *
 * The residual holes, stated honestly rather than papered over: deleting
 * `.trace/` discards the carried record itself, and editing the PDF changes
 * the geometry — in both cases the next build numbers from scratch, exactly
 * like a first build. kb_health's source-outran-the-page check is the
 * backstop for the latter.
 */
import type { NormRect, PdfBlock } from './types'

/** One prior locations.json entry — where an already-published id points. */
export interface PriorEntry {
  page: number
  rects: NormRect[]
}

/** A new block must cover this share of the smaller of the two rect areas to
 *  claim a prior id. Low enough that re-grouped paragraphs (split, merged,
 *  boilerplate re-classified) still find each other; high enough that two
 *  unrelated blocks sharing a page never do. */
const MIN_OVERLAP = 0.5

export interface InheritResult {
  /** The same blocks, re-keyed: inherited ids where a prior block matches,
   *  never-used ids where none does. */
  blocks: PdfBlock[]
  /** The full locations map to persist: every prior id (updated or carried
   *  verbatim) plus every new block. A superset of the prior map's keys. */
  locations: Record<string, PriorEntry>
}

/** Re-key freshly extracted blocks against the prior build's id record.
 *  With no prior record (first build, or source bytes changed) the blocks
 *  keep their positional ids unchanged. */
export function inheritIds(
  blocks: PdfBlock[],
  prior: Record<string, PriorEntry> | null,
): InheritResult {
  if (!prior || Object.keys(prior).length === 0) {
    const locations: Record<string, PriorEntry> = {}
    for (const b of blocks) locations[b.id] = { page: b.page, rects: b.rects }
    return { blocks, locations }
  }

  // Prior ids per page, with the ordinal parsed off the key. Ids that do not
  // parse (foreign/corrupt) are still carried forward below — they just
  // cannot take part in matching or the high-water mark.
  const priorByPage = new Map<number, { id: string; n: number; entry: PriorEntry }[]>()
  for (const [id, entry] of Object.entries(prior)) {
    const m = /^b(\d+)-(\d+)$/.exec(id)
    if (!m) continue
    const page = Number(m[1])
    if (!priorByPage.has(page)) priorByPage.set(page, [])
    priorByPage.get(page)!.push({ id, n: Number(m[2]), entry })
  }

  // Score every same-page (new block, prior id) pair, best first. Ties break
  // toward reading order on both sides so the result is deterministic and a
  // split block's id lands on the half where the passage begins.
  const candidates: { bi: number; id: string; n: number; score: number }[] = []
  for (let bi = 0; bi < blocks.length; bi++) {
    for (const p of priorByPage.get(blocks[bi].page) ?? []) {
      // The page prefix is part of the name: an id only ever matches blocks
      // on its own page, so inheritance can never contradict it.
      const score = overlap(blocks[bi].rects, p.entry.rects)
      if (score >= MIN_OVERLAP) candidates.push({ bi, id: p.id, n: p.n, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.n - b.n || a.bi - b.bi)

  const idForBlock = new Map<number, string>()
  const taken = new Set<string>()
  for (const c of candidates) {
    if (idForBlock.has(c.bi) || taken.has(c.id)) continue
    idForBlock.set(c.bi, c.id)
    taken.add(c.id)
  }

  // Never-used ordinals for the rest: above everything the page has ever
  // published. Carried ids keep their keys forever, so this cannot regress.
  const highWater = new Map<number, number>()
  for (const [page, entries] of priorByPage) {
    highWater.set(page, Math.max(...entries.map((e) => e.n)))
  }

  const out: PdfBlock[] = []
  const locations: Record<string, PriorEntry> = { ...prior }
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi]
    let id = idForBlock.get(bi)
    if (!id) {
      const next = (highWater.get(b.page) ?? 0) + 1
      highWater.set(b.page, next)
      id = `b${b.page}-${next}`
    }
    out.push(b.id === id ? b : { ...b, id })
    // Matched ids move to the new block's rects — same passage, current
    // grouping. Unmatched prior ids stay untouched in `locations`.
    locations[id] = { page: b.page, rects: b.rects }
  }
  return { blocks: out, locations }
}

/** How much two rect sets overlap: intersection area over the smaller total
 *  area, 0..1. The min-denominator makes containment count as full overlap,
 *  so a paragraph split off a bigger prior block still scores 1. */
export function overlap(a: NormRect[], b: NormRect[]): number {
  const area = (rs: NormRect[]) => rs.reduce((s, r) => s + r.w * r.h, 0)
  const min = Math.min(area(a), area(b))
  if (min <= 0) return 0
  let inter = 0
  for (const ra of a) {
    for (const rb of b) {
      const w = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x)
      const h = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y)
      if (w > 0 && h > 0) inter += w * h
    }
  }
  return Math.min(1, inter / min)
}
