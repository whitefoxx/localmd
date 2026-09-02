/**
 * The links a page should have and does not.
 *
 * Every link check in `lint.ts` asks whether the links that exist are sound:
 * broken, self-pointing, dangling, still a template's placeholder. None of
 * them asks the opposite question — a page names another page, in so many
 * words, and does not link to it. That gap is where a folder stops short of
 * being a wiki, and it is the one thing a reader notices and a validator
 * never does.
 *
 * Deterministic and text-only: no LLM, no embeddings, no notion of meaning. A
 * suggestion here claims exactly one thing — *these characters are the name of
 * that page* — and nothing more. Everything below exists to keep that claim
 * honest: the masks, so a match cannot come from a code sample or a link that
 * already exists; the ambiguity rule, so a name two pages answer to is used
 * for neither; the length floors, so short words do not carry it.
 *
 * Nothing here writes, and nothing here is a finding. `computeLint` reports
 * problems; this proposes work, and the two are different enough to live
 * apart — a page with fifty suggestions is not fifty times unhealthier than
 * one with none, it is just better connected to a KB that has more in it.
 *
 * The output is grouped by the page pointed AT, because that is the unit a
 * person can decide about. "Everything that mentions X should link to X" is
 * one judgement; the same judgement taken thirty times, once per file, is the
 * review tax this is meant to remove rather than reinvent.
 */
import { splitFrontmatter, extractTitle, fileStem } from '@/lib/wiki'
import { isEntryPage, type LintPage } from '@/lib/lint'
import { isDailyPath } from '@/lib/daily'

export interface LinkSuggestion {
  /** The page whose text names the other one. */
  from: string
  /** The page it names and does not link to. */
  to: string
  /** The characters that matched, as they are written in `from` — not the
   *  normalized form, so what a reviewer reads is what is in their file. */
  term: string
  /** 1-based line in `from`, to open at. */
  line: number
  /** That line, so the reviewer sees the sentence and not just the word. */
  excerpt: string
}

/** Suggestions for one target, which is the unit a person decides about. */
export interface LinkSuggestionGroup {
  to: string
  /** The name that found them — the target's own title or file stem. */
  name: string
  mentions: LinkSuggestion[]
}

/**
 * Shortest name that may be matched, in code points.
 *
 * Three lets `RAG`, `MoE` and `KV cache` through, which are names people
 * genuinely give pages; two would let in `to` and `is`. CJK gets its own floor
 * because two characters there is a word rather than a fragment — 记忆, 注意力
 * — and holding it to three would silently drop most of a Chinese KB.
 */
const MIN_LATIN = 3
const MIN_CJK = 2

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/

/** Longest excerpt kept, in characters. A whole line of a long paragraph is
 *  not a sentence, and a reviewer scanning thirty of these needs each to fit
 *  on one row. */
const EXCERPT = 160

/** Masked characters. A NUL, not a space: masking with spaces would let
 *  ``machine `x` learning`` collapse into something the two-word name
 *  `machine learning` matches straight across — a false positive invented
 *  by the mask itself. Nothing in `[-_\s]+` matches a NUL. Written as an
 *  escape so the file stays text: a literal NUL makes git call it binary. */
const MASK = '\u0000'

/**
 * One spelling for the several a name is written in: case folded, with every
 * run of space, hyphen or underscore reduced to a single space.
 *
 * `Machine Learning`, `machine-learning` and the stem of `machine_learning.md`
 * are one name — which is the equivalence a wikilink target already has, so
 * this is not a new convention, it is the existing one applied to prose.
 */
function nameKey(term: string): string {
  return term.toLowerCase().replace(/[-_\s]+/g, ' ').trim()
}

function longEnough(term: string): boolean {
  // A name has to be a name: `###` is three characters and a heading marker,
  // and a pattern built from it would match every heading in the KB.
  if (!/[\p{L}\p{N}]/u.test(term)) return false
  const n = [...term].length
  return CJK_RE.test(term) ? n >= MIN_CJK : n >= MIN_LATIN
}

/**
 * A copy of `content` with everything a match may not come from replaced by
 * NULs, one per character — so an index into the result still points at the
 * same character of the original.
 *
 * Order matters: fences before anything else (a backtick inside a fenced block
 * does not open an inline span), and code before links (a link in a code
 * sample is already gone by then).
 *
 * What is masked, and why:
 *
 * - **frontmatter** — `tags: [attention]` is metadata; it is not prose naming
 *   a page, and turning it into a link would corrupt the YAML.
 * - **fenced and inline code** — a variable named `attention` is not a mention
 *   of the note about attention. This is the mask that matters most: a KB with
 *   code samples in it produces nothing but false suggestions without it.
 * - **`[[wikilinks]]` and `[text](url)`** — already a link. A second link
 *   inside the first is not an improvement, and the page's own title inside
 *   its own H1 is not a mention of itself.
 * - **bare URLs and HTML tags** — a path segment is not a sentence.
 */
function maskable(content: string): string {
  const fmLen = content.length - splitFrontmatter(content).body.length
  const lines = content.split('\n')
  const out: string[] = []
  let fence: string | null = null
  let at = 0
  for (const line of lines) {
    if (at < fmLen) out.push(MASK.repeat(line.length))
    else {
      const opener = line.match(/^\s*(```|~~~)/)
      if (fence !== null) {
        out.push(MASK.repeat(line.length))
        if (opener && line.trim().startsWith(fence)) fence = null
      } else if (opener) {
        fence = opener[1]
        out.push(MASK.repeat(line.length))
      } else out.push(maskInline(line))
    }
    at += line.length + 1
  }
  return out.join('\n')
}

const INLINE = [
  /`[^`\n]*`/g, // inline code, first: it swallows links written inside it
  /\[\[[^\]\n]*\]\]/g, // wikilinks
  /\[[^\]\n]*\]\([^)\n]*\)/g, // markdown links, text and target together
  /https?:\/\/\S+/g, // bare URLs
  /<[^>\n]+>/g, // HTML tags and autolinks
]

function maskInline(line: string): string {
  let out = line
  for (const re of INLINE) out = out.replace(re, (m) => MASK.repeat(m.length))
  return out
}

/**
 * Name → the one page it belongs to, or null once two pages claim it.
 *
 * A name two pages answer to names neither: a link would have to guess, and a
 * suggestion that guesses is worse than no suggestion — it is the first thing
 * a reviewer catches, and after catching it they stop trusting the rest.
 *
 * Index, log and capture pages are not targets. Nobody means the index page
 * when they write the word "index", a day of jottings is material rather than
 * a subject, and both would otherwise match on nearly every page in the KB.
 */
interface Names {
  /** Every name, to the one page it belongs to. Ambiguous ones are dropped by
   *  the time this is built, not carried as nulls. */
  byKey: Map<string, string>
  /** Names with no CJK in them, found by joining words. */
  words: Map<string, string>
  /** First word of a word-name — one Set lookup rejects most tokens before
   *  any joining happens. */
  wordHeads: Set<string>
  /** How many words the longest word-name has: how far ahead to look. */
  maxWords: number
  /** Names containing CJK, which no tokenizer can cut. */
  cjk: Map<string, string>
  /** First character of a CJK name, for the same pruning reason. */
  cjkHeads: Set<string>
  maxCjk: number
}

/**
 * Name → the one page it belongs to.
 *
 * A name two pages answer to is dropped, not resolved. It names neither: a
 * link would have to guess, and a suggestion that guesses is worse than no
 * suggestion — it is the first thing a reviewer catches, and after catching it
 * they stop trusting the rest.
 *
 * Index, log and capture pages are not targets. Nobody means the index page
 * when they write the word "index", a day of jottings is material rather than
 * a subject, and both would otherwise match on nearly every page in the KB.
 */
function nameIndex(pages: ReadonlyMap<string, LintPage>): Names {
  const owner = new Map<string, string | null>()
  for (const [path, page] of pages) {
    if (isEntryPage(path) || isDailyPath(path)) continue
    for (const raw of [extractTitle(page.content), fileStem(path)]) {
      if (raw === null || !longEnough(raw)) continue
      const key = nameKey(raw)
      if (!key) continue
      if (owner.has(key) && owner.get(key) !== path) owner.set(key, null)
      else owner.set(key, path)
    }
  }

  const names: Names = {
    byKey: new Map(),
    words: new Map(),
    wordHeads: new Set(),
    maxWords: 0,
    cjk: new Map(),
    cjkHeads: new Set(),
    maxCjk: 0,
  }
  for (const [key, path] of owner) {
    if (path === null) continue
    names.byKey.set(key, path)
    if (CJK_RE.test(key)) {
      names.cjk.set(key, path)
      names.cjkHeads.add(key[0])
      names.maxCjk = Math.max(names.maxCjk, key.length)
    } else {
      const parts = key.split(' ')
      names.words.set(key, path)
      names.wordHeads.add(parts[0])
      names.maxWords = Math.max(names.maxWords, parts.length)
    }
  }
  return names
}

const WORD_RE = /[\p{L}\p{N}_]+/gu
/** What may sit between the words of one name and still be one name. */
const GAP_RE = /^[-_\s]+$/

interface Found {
  key: string
  at: number
  len: number
}

/**
 * Every name that appears in `masked`, as offsets into it.
 *
 * The obvious implementation — one alternation of every name, run over every
 * page — is quadratic, and measurably so. On a synthetic corpus where every
 * page names others it took 0.2s at 200 pages, 5s at 1000 and 25s at 2000: the
 * engine retries every alternative at every position, and both the number of
 * names and the amount of text grow together. The scan below is 0.07s / 0.2s /
 * 0.43s on the same corpora (0.08 / 0.33 / 0.74 for the Chinese one), which is
 * linear and 57x faster where it hurt.
 *
 * So the text is cut once and the names are looked up, instead of the names
 * being searched for. A word is a maximal run of letters and digits, which IS
 * the word boundary the alternation was buying with lookarounds — `RAG` cannot
 * match inside `storage` because `storage` is one word. Runs of up to
 * `maxWords` words are joined and asked about, longest first, and the gap
 * between two words has to be separator-only, so a NUL left by the mask stops
 * a name from spanning what was masked out.
 *
 * CJK cannot be cut that way, so those names are found by trying each length
 * at each CJK character — bounded by the longest CJK name rather than by how
 * many there are. Both scans start with a Set lookup that rejects almost every
 * position outright, and both are linear in the page.
 */
function* namesIn(masked: string, names: Names): Generator<Found> {
  if (names.words.size) {
    const at: number[] = []
    const end: number[] = []
    const word: string[] = []
    for (const m of masked.matchAll(WORD_RE)) {
      at.push(m.index)
      end.push(m.index + m[0].length)
      word.push(m[0].toLowerCase())
    }
    for (let i = 0; i < word.length; i++) {
      if (!names.wordHeads.has(word[i])) continue
      for (let k = Math.min(names.maxWords, word.length - i); k >= 1; k--) {
        let key = word[i]
        let joined = true
        for (let j = 1; j < k && joined; j++) {
          if (GAP_RE.test(masked.slice(end[i + j - 1], at[i + j]))) key += ` ${word[i + j]}`
          else joined = false
        }
        if (!joined || !names.words.has(key)) continue
        yield { key, at: at[i], len: end[i + k - 1] - at[i] }
        i += k - 1
        break
      }
    }
  }

  if (names.cjk.size) {
    for (let i = 0; i < masked.length; i++) {
      if (!names.cjkHeads.has(masked[i])) continue
      for (let len = Math.min(names.maxCjk, masked.length - i); len >= MIN_CJK; len--) {
        const key = nameKey(masked.slice(i, i + len))
        if (!names.cjk.has(key)) continue
        yield { key, at: i, len }
        i += len - 1
        break
      }
    }
  }
}

/** The line an offset falls on, and that line, cropped around the match. */
function locate(content: string, at: number, len: number): { line: number; excerpt: string } {
  const before = content.lastIndexOf('\n', at - 1) + 1
  const nl = content.indexOf('\n', at)
  const after = nl === -1 ? content.length : nl
  const line = content.slice(0, before).split('\n').length
  const raw = content.slice(before, after)
  const lead = raw.length - raw.trimStart().length
  const text = raw.trim()
  if (text.length <= EXCERPT) return { line, excerpt: text }
  // Keep the match in view rather than the start of a long paragraph.
  const rel = at - before - lead
  const start = Math.round(Math.max(0, Math.min(rel + len / 2 - EXCERPT / 2, text.length - EXCERPT)))
  const head = start > 0 ? '…' : ''
  const tail = start + EXCERPT < text.length ? '…' : ''
  return { line, excerpt: `${head}${text.slice(start, start + EXCERPT)}${tail}` }
}

/**
 * Every place a page names another page without linking to it.
 *
 * One suggestion per pair, at the first mention: a page that says "attention"
 * nine times needs one link, not nine, and nine rows would bury the eight
 * other pages that also need one.
 *
 * Capture pages are not sources either. A day's jottings are raw material — the
 * place links belong is whatever gets written out of them, which is the same
 * reason `undistilledCaptures` exists rather than an orphan warning per day.
 */
export function suggestLinks(pages: ReadonlyMap<string, LintPage>): LinkSuggestion[] {
  const names = nameIndex(pages)
  if (!names.byKey.size) return []

  const found: LinkSuggestion[] = []
  for (const [from, page] of pages) {
    if (isDailyPath(from)) continue
    const masked = maskable(page.content)
    const linked = new Set(page.outgoing)
    const seen = new Set<string>()
    for (const hit of namesIn(masked, names)) {
      const to = names.byKey.get(hit.key)
      if (!to || to === from || linked.has(to) || seen.has(to)) continue
      seen.add(to)
      found.push({
        from,
        to,
        term: page.content.slice(hit.at, hit.at + hit.len),
        ...locate(page.content, hit.at, hit.len),
      })
    }
  }

  found.sort((a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from) || a.line - b.line)
  return found
}

/** The same suggestions, gathered under the page they point at — one group is
 *  one decision. Ordered by how many pages are waiting to point at it, because
 *  that is the order in which approving one is worth the most. */
export function groupSuggestions(
  suggestions: readonly LinkSuggestion[],
  pages: ReadonlyMap<string, LintPage>,
): LinkSuggestionGroup[] {
  const groups = new Map<string, LinkSuggestion[]>()
  for (const s of suggestions) {
    const list = groups.get(s.to)
    if (list) list.push(s)
    else groups.set(s.to, [s])
  }
  return [...groups.entries()]
    .map(([to, mentions]) => ({
      to,
      name: extractTitle(pages.get(to)?.content ?? '') ?? fileStem(to),
      mentions,
    }))
    .sort((a, b) => b.mentions.length - a.mentions.length || a.to.localeCompare(b.to))
}
