/**
 * Subsequence ("fuzzy") matching for the command palette.
 *
 * Every character of the needle must appear in the haystack in order, but not
 * adjacently — `wkchn` finds `wiki/chain-of-thought.md`. Among the many ways a
 * needle can be laid over a haystack, the score prefers the reading a person
 * means: characters that run together, and characters that start a word.
 *
 * The search is exact, not greedy. A greedy left-to-right scan takes the first
 * available character and cannot reconsider, so `md` in `markdown/todo.md`
 * would match m(0)+d(3) — buried in "markdown" — instead of the extension the
 * user was typing. A small dynamic program over (needle × haystack) finds the
 * best-scoring layout for a few hundred characters in microseconds.
 *
 * Returns the matched positions as well as the score, because a fuzzy match
 * nobody can see the reasoning for reads as a bug: the palette underlines them.
 */

const SCORE_MATCH = 16
/** Directly after the previous matched character — the strongest signal. */
const BONUS_CONSECUTIVE = 8
/** First character of a path segment, word, or camelCase hump. */
const BONUS_BOUNDARY = 12
/** Per character skipped between two matches. */
const PENALTY_GAP = 1
/** Per character skipped before the first match, capped: a match at the end of
 *  a long path is worth less than the same match at its start, but position is
 *  only a tiebreaker — it must not outweigh how well the characters sit. */
const PENALTY_LEADING = 1
const MAX_LEADING_PENALTY = 10
/** Longer than this and no ranking is worth the DP; such rows fall back to a
 *  plain substring test. Real KB paths are far shorter. */
const MAX_HAYSTACK = 400

export interface FuzzyMatch {
  score: number
  /** Indices into the haystack that the needle matched, ascending. */
  positions: number[]
}

const BOUNDARY_BEFORE = new Set([' ', '/', '\\', '-', '_', '.', ',', '(', '[', ':'])

function isBoundary(haystack: string, i: number): boolean {
  if (i === 0) return true
  const prev = haystack[i - 1]
  if (BOUNDARY_BEFORE.has(prev)) return true
  // camelCase / PascalCase hump: a capital after a lowercase letter.
  return prev >= 'a' && prev <= 'z' && haystack[i] >= 'A' && haystack[i] <= 'Z'
}

/**
 * Best-scoring layout of `needle` over `haystack`, or null when the needle is
 * not a subsequence of it. An empty needle matches everything with score 0.
 */
export function fuzzyMatch(needle: string, haystack: string): FuzzyMatch | null {
  if (!needle) return { score: 0, positions: [] }
  if (!haystack || haystack.length > MAX_HAYSTACK) return null
  if (needle.length > haystack.length) return null

  const n = needle.toLowerCase()
  const h = haystack.toLowerCase()

  // best[j]: score of matching needle[0..i] with needle[i] landing on j.
  // carry[j]: the word-start bonus that layout's current run began with — a
  // run inherits it, so `cot.md` (one run from a boundary) beats the scattered
  // c-o-t of `chain-of-thought`, which contiguity alone would lose to.
  // from[i][j]: which haystack index needle[i-1] took in that best layout.
  let best = new Float64Array(h.length).fill(-Infinity)
  let carry = new Float64Array(h.length)
  let prev = new Float64Array(h.length).fill(-Infinity)
  let prevCarry = new Float64Array(h.length)
  const from: Int32Array[] = []

  for (let i = 0; i < n.length; i++) {
    const parents = new Int32Array(h.length).fill(-1)
    best = new Float64Array(h.length).fill(-Infinity)
    carry = new Float64Array(h.length)
    // Running best of (prev[k] + gap credit) so the gap penalty stays linear:
    // penalty (j-k-1)*P rewritten as (prev[k] + (k+1)*P) - j*P.
    let runBest = -Infinity
    let runFrom = -1

    for (let j = 0; j < h.length; j++) {
      if (i > 0 && Number.isFinite(prev[j - 1] ?? -Infinity)) {
        const credit = prev[j - 1] + j * PENALTY_GAP
        if (credit > runBest) {
          runBest = credit
          runFrom = j - 1
        }
      }
      if (h[j] !== n[i]) continue

      const bonus = isBoundary(haystack, j) ? BONUS_BOUNDARY : 0
      if (i === 0) {
        best[j] = SCORE_MATCH + bonus - Math.min(j * PENALTY_LEADING, MAX_LEADING_PENALTY)
        carry[j] = bonus
        continue
      }
      // Either follow directly on from the previous character (consecutive),
      // inheriting that run's word-start bonus…
      let score = -Infinity
      let parent = -1
      let runBonus = bonus
      if (Number.isFinite(prev[j - 1] ?? -Infinity)) {
        const inherited = Math.max(bonus, prevCarry[j - 1])
        score = prev[j - 1] + SCORE_MATCH + BONUS_CONSECUTIVE + inherited
        parent = j - 1
        runBonus = inherited
      }
      // …or jump a gap from the best earlier position, starting a new run.
      if (Number.isFinite(runBest)) {
        const jumped = runBest - j * PENALTY_GAP + SCORE_MATCH + bonus
        if (jumped > score) {
          score = jumped
          parent = runFrom
          runBonus = bonus
        }
      }
      if (parent >= 0) {
        best[j] = score
        carry[j] = runBonus
        parents[j] = parent
      }
    }
    from.push(parents)
    prev = best
    prevCarry = carry
  }

  let endAt = -1
  let endScore = -Infinity
  for (let j = 0; j < h.length; j++) {
    if (best[j] > endScore) {
      endScore = best[j]
      endAt = j
    }
  }
  if (endAt < 0 || !Number.isFinite(endScore)) return null

  const positions: number[] = new Array(n.length)
  let at = endAt
  for (let i = n.length - 1; i >= 0; i--) {
    positions[i] = at
    at = from[i][at]
  }
  return { score: endScore, positions }
}

export interface Ranked<T> {
  item: T
  score: number
  positions: number[]
}

/**
 * Score every candidate and drop the ones that don't match. Ties break toward
 * the shorter text, then alphabetically — with equal scores, the more specific
 * name is nearly always the one meant, and stable order beats a shuffling list.
 */
export function fuzzyRank<T>(needle: string, items: T[], text: (item: T) => string): Ranked<T>[] {
  const out: Ranked<T>[] = []
  for (const item of items) {
    const str = text(item)
    const m = fuzzyMatch(needle, str)
    if (m) out.push({ item, score: m.score, positions: m.positions })
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const at = text(a.item)
    const bt = text(b.item)
    return at.length - bt.length || at.localeCompare(bt)
  })
  return out
}
