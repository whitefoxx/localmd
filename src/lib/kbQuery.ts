/**
 * Ask the page index a question.
 *
 * Everything an answer needs is already cached — page content, resolved
 * outgoing links, unresolved targets, mtimes — and `computeLint` proves it by
 * deriving a dozen structural signals from exactly that with no file reads.
 * What was missing was a way to ask anything *else*. The agent could grep
 * (`search_files` reads every text file and answers in hundreds of
 * `path:line:` lines) or run the one fixed report (`kb_health`), with nothing
 * in between — so "which `type: paper` pages have gone three months without a
 * touch" cost a full-text scan and a page-by-page read.
 *
 * A result is a VIEW. Nothing here writes, and nothing rendering it may
 * persist what it rendered: a materialized query is a record, and a record
 * nobody maintains starts to lie the moment someone edits around it
 * (AGENTS.md, "Recall is a view or a note, never a record").
 *
 * The grammar grew out of the search palette's two filters rather than being a
 * second language beside them — same `key:value` tokens, same quoting, same
 * case-insensitive substring default — and the palette now speaks this one, so
 * ⌘K, the agent tool and the `localmd-query` block read a single syntax. What
 * they do NOT share is execution: finding a file and answering a structural
 * question are different jobs, and the palette keeps its fuzzy ranking and its
 * cached maps (see `sourceMatches` for the part of the grammar a document,
 * which is not a page, can still answer).
 *
 * Pure over a snapshot so it tests in node like `marks.ts` and `lint.ts`, and
 * `now` is a parameter, never `Date.now()`: `age:<30d` has to be assertable.
 */
import { splitFrontmatter, extractTitle, extractType, extractRole, extractTags, extractField } from '@/lib/wiki'
import { isEntryPage, isLogPage } from '@/lib/lint'

/** A page as the engine sees it. Type, role, tags and title are derived from
 *  `content` rather than passed in — one input that cannot disagree with
 *  itself, the same trade `lint.ts` makes. */
export interface QueryPage {
  path: string
  content: string
  /** Resolved KB paths this page links to. */
  outgoing: readonly string[]
  /** Link targets that resolve to no file. */
  broken: readonly string[]
  /** When the file was last written. Absent is supported: pages without one
   *  are simply not candidates for the filters and sorts that need it. */
  mtime?: number
  /** Source documents this page declares, resolved. Supplied by the caller
   *  (kbIndex's `pageSources`, which needs the file list to resolve renames);
   *  `cites:` matches nothing where it was not supplied. */
  sources?: readonly string[]
}

export type Cmp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'exists'

export interface FieldTest {
  field: string
  op: Cmp
  /** Absent for `exists`. */
  value?: string
}

export type SortKey = 'path' | 'title' | 'modified' | 'inbound' | { field: string }

export interface KbQuery {
  /** Substring of the KB path — the folder filter. */
  path?: string
  /** Frontmatter `type:`, substring. */
  type?: string
  /** Every one must match some tag of the page (substring). */
  tags?: readonly string[]
  role?: 'index' | 'log'
  /** All must hold. */
  fields?: readonly FieldTest[]
  linksTo?: string
  linkedBy?: string
  cites?: string
  /** Tri-state: undefined means the query does not care. */
  orphan?: boolean
  broken?: boolean
  /** Substring of the body (frontmatter stripped). */
  text?: string
  modifiedAfter?: number
  modifiedBefore?: number
  sort?: { key: SortKey; order: 'asc' | 'desc' }
  limit?: number
  columns?: readonly string[]
}

export interface QueryRow {
  path: string
  title: string
  type: string | null
  tags: readonly string[]
  mtime?: number
  inbound: number
  /** Values for the requested `columns`, in that order. */
  cells: Record<string, string>
}

export interface QueryResult {
  rows: QueryRow[]
  /** Matches before `limit`, so a view can say "20 of 143". */
  total: number
  /** Filter terms nothing in the KB could have matched — an unknown tag, a
   *  frontmatter field no page declares. Not an error (the KB is a soft
   *  constraint), but without it a typo and a genuinely empty result are the
   *  same empty table, and only one of them is telling the truth. */
  unmatchedTerms: string[]
}

// ── derived facts ───────────────────────────────────────────────────────────

/**
 * A page's derived facts, each computed at most once and only if something
 * asks. Laziness is not a micro-optimisation here: the palette runs this on
 * every keystroke, and deriving title, type, role, tags AND body for every
 * page — five passes over the content to answer a query that looks at two of
 * them — cost 12ms per keystroke on a 2000-page corpus. A page rejected by
 * `path:` should never have its frontmatter parsed at all.
 */
interface Facts {
  title: () => string
  type: () => string | null
  role: () => 'index' | 'log' | null
  tags: () => readonly string[]
  body: () => string
  inbound: () => number
  field: (name: string) => string[] | null
}

function once<T>(compute: () => T): () => T {
  let called = false
  let value: T
  return () => {
    if (!called) {
      value = compute()
      called = true
    }
    return value
  }
}

/**
 * A page's structural role, resolved the way `computeLint` resolves it:
 * explicit `kb-role:` wins, and the filename stays the zero-config default.
 * Reading only the marker would answer `role:index` with nothing on a KB
 * whose index is a perfectly ordinary `index.md` — one fact told two ways,
 * and the query would be the one telling it wrong.
 */
function roleOf(path: string, content: string): 'index' | 'log' | null {
  const declared = extractRole(content)
  if (declared) return declared
  if (isLogPage(path)) return 'log'
  if (isEntryPage(path)) return 'index'
  return null
}

function factsFor(pages: readonly QueryPage[]): Map<string, Facts> {
  // Built on first use and shared, for the same reason the rest is lazy: only
  // `orphan:`, `sort:inbound` and the inbound column ever ask, and walking
  // every page's links to answer a question nobody asked is a cost paid on
  // every keystroke for a benefit taken on almost none.
  const inbound = once(() => {
    const counts = new Map<string, number>()
    for (const page of pages) {
      for (const target of new Set(page.outgoing)) {
        if (target !== page.path) counts.set(target, (counts.get(target) ?? 0) + 1)
      }
    }
    return counts
  })
  const out = new Map<string, Facts>()
  for (const page of pages) {
    const memo = new Map<string, string[] | null>()
    out.set(page.path, {
      title: once(() => extractTitle(page.content) ?? page.path),
      type: once(() => extractType(page.content)),
      role: once(() => roleOf(page.path, page.content)),
      tags: once(() => extractTags(page.content)),
      body: once(() => splitFrontmatter(page.content).body),
      inbound: () => inbound().get(page.path) ?? 0,
      field: (name) => {
        if (!memo.has(name)) memo.set(name, extractField(page.content, name))
        return memo.get(name) ?? null
      },
    })
  }
  return out
}

// ── comparison ──────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A frontmatter value against a query value. Numbers compare as numbers and
 *  ISO dates as dates — `fm:rating>=10` must not lose to string order, where
 *  "10" sorts under "9" — and anything else compares as lowercased text. */
function cmpValues(a: string, op: Exclude<Cmp, 'exists'>, b: string): boolean {
  const na = Number(a.trim())
  const nb = Number(b.trim())
  const numeric = a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)
  const dated = DATE_RE.test(a.trim()) && DATE_RE.test(b.trim())
  if (numeric || dated) {
    const x = numeric ? na : Date.parse(a.trim())
    const y = numeric ? nb : Date.parse(b.trim())
    switch (op) {
      case '=': return x === y
      case '!=': return x !== y
      case '>': return x > y
      case '>=': return x >= y
      case '<': return x < y
      case '<=': return x <= y
    }
  }
  const x = a.trim().toLowerCase()
  const y = b.trim().toLowerCase()
  switch (op) {
    case '=': return x === y
    case '!=': return x !== y
    case '>': return x > y
    case '>=': return x >= y
    case '<': return x < y
    case '<=': return x <= y
  }
}

/**
 * `=` on a frontmatter field is EXACT, while `type:` and `tag:` are substring.
 * The asymmetry is deliberate and worth stating: a tag is free vocabulary you
 * narrow into (`tag:llm` should find `llm-agents`), a field value is a value
 * you assert (`status=draft` must not also mean `drafting`).
 *
 * A list-valued field passes when ANY element does — except `!=`, which needs
 * ALL of them, or `authors!=alice` would hold for a paper alice co-wrote.
 */
function matchesField(values: string[] | null, test: FieldTest): boolean {
  if (test.op === 'exists') return values !== null
  if (values === null || test.value === undefined) return false
  if (test.op === '!=') return values.every((v) => cmpValues(v, '!=', test.value!))
  return values.some((v) => cmpValues(v, test.op as Exclude<Cmp, 'exists'>, test.value!))
}

// ── running ─────────────────────────────────────────────────────────────────

const BUILTIN_COLUMNS = new Set(['path', 'title', 'type', 'tags', 'modified', 'inbound'])

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function cellValue(name: string, page: QueryPage, f: Facts): string {
  switch (name) {
    case 'path': return page.path
    case 'title': return f.title()
    case 'type': return f.type() ?? ''
    case 'tags': return f.tags().join(', ')
    case 'modified': return page.mtime === undefined ? '' : isoDay(page.mtime)
    case 'inbound': return String(f.inbound())
    default: return (f.field(name) ?? []).join(', ')
  }
}

/** Sort key plus whether the page HAS one. Missing values sort last in both
 *  directions — a page with no `rating` is not the lowest-rated page, and
 *  flipping the order should not promote it to the top of the list. */
function sortKeyOf(key: SortKey, page: QueryPage, f: Facts): { v: number | string; missing: boolean } {
  if (typeof key === 'object') {
    const raw = f.field(key.field)?.[0]
    if (raw === undefined) return { v: '', missing: true }
    const n = Number(raw.trim())
    if (raw.trim() !== '' && Number.isFinite(n)) return { v: n, missing: false }
    if (DATE_RE.test(raw.trim())) return { v: Date.parse(raw.trim()), missing: false }
    return { v: raw.trim().toLowerCase(), missing: false }
  }
  switch (key) {
    case 'path': return { v: page.path.toLowerCase(), missing: false }
    case 'title': return { v: f.title().toLowerCase(), missing: false }
    case 'inbound': return { v: f.inbound(), missing: false }
    case 'modified':
      return page.mtime === undefined ? { v: 0, missing: true } : { v: page.mtime, missing: false }
  }
}

/** The filter step, shared so `matchingPaths` and `runQuery` cannot disagree
 *  about what a query means. */
function filterPages(
  pages: readonly QueryPage[],
  q: KbQuery,
): { matched: QueryPage[]; facts: Map<string, Facts> } {
  const facts = factsFor(pages)
  const lower = (s: string): string => s.toLowerCase()

  // `linked-by:X` reads the graph backwards: collect what the pages matching X
  // point at, then keep the pages in that set.
  let linkedFrom: Set<string> | null = null
  if (q.linkedBy !== undefined) {
    const needle = lower(q.linkedBy)
    linkedFrom = new Set<string>()
    for (const page of pages) {
      if (lower(page.path).includes(needle)) for (const t of page.outgoing) linkedFrom.add(t)
    }
  }

  const matched = pages.filter((page) => {
    const f = facts.get(page.path)!
    if (q.path !== undefined && !lower(page.path).includes(lower(q.path))) return false
    if (q.type !== undefined && !lower(f.type() ?? '').includes(lower(q.type))) return false
    if (q.role !== undefined && f.role() !== q.role) return false
    if (q.tags?.length) {
      for (const want of q.tags) {
        if (!f.tags().some((t) => lower(t).includes(lower(want)))) return false
      }
    }
    if (q.fields?.length) {
      for (const test of q.fields) if (!matchesField(f.field(test.field), test)) return false
    }
    if (q.linksTo !== undefined && !page.outgoing.some((o) => lower(o).includes(lower(q.linksTo!))))
      return false
    if (linkedFrom && !linkedFrom.has(page.path)) return false
    if (q.cites !== undefined && !(page.sources ?? []).some((s) => lower(s).includes(lower(q.cites!))))
      return false
    if (q.orphan !== undefined && f.inbound() === 0 !== q.orphan) return false
    if (q.broken !== undefined && page.broken.length > 0 !== q.broken) return false
    if (q.text !== undefined && !lower(f.body()).includes(lower(q.text))) return false
    if (q.modifiedAfter !== undefined && !(page.mtime !== undefined && page.mtime >= q.modifiedAfter))
      return false
    if (q.modifiedBefore !== undefined && !(page.mtime !== undefined && page.mtime <= q.modifiedBefore))
      return false
    return true
  })

  return { matched, facts }
}

/**
 * Just the paths a query matches.
 *
 * The search palette wants exactly this and nothing else: it re-ranks and
 * re-renders the result its own way, so building a row per match — which
 * derives a title per match — is work thrown away on every keystroke.
 */
export function matchingPaths(pages: readonly QueryPage[], q: KbQuery): Set<string> {
  return new Set(filterPages(pages, q).matched.map((p) => p.path))
}

export function runQuery(pages: readonly QueryPage[], q: KbQuery): QueryResult {
  const { matched, facts } = filterPages(pages, q)
  const ordered = [...matched]
  if (q.sort) {
    const { key, order } = q.sort
    const dir = order === 'desc' ? -1 : 1
    ordered.sort((a, b) => {
      const ka = sortKeyOf(key, a, facts.get(a.path)!)
      const kb = sortKeyOf(key, b, facts.get(b.path)!)
      if (ka.missing !== kb.missing) return ka.missing ? 1 : -1
      if (ka.missing) return a.path.localeCompare(b.path)
      if (ka.v < kb.v) return -1 * dir
      if (ka.v > kb.v) return 1 * dir
      return a.path.localeCompare(b.path) // stable, and reproducible across runs
    })
  }

  const limited = q.limit !== undefined ? ordered.slice(0, q.limit) : ordered
  const columns = q.columns ?? []
  const rows: QueryRow[] = limited.map((page) => {
    const f = facts.get(page.path)!
    const cells: Record<string, string> = {}
    for (const c of columns) cells[c] = cellValue(c, page, f)
    return {
      path: page.path,
      title: f.title(),
      type: f.type(),
      tags: f.tags(),
      mtime: page.mtime,
      inbound: f.inbound(),
      cells,
    }
  })

  return { rows, total: matched.length, unmatchedTerms: unmatched(pages, facts, q) }
}

/**
 * Terms no page in the KB could satisfy, checked against the whole corpus
 * rather than the filtered set — the question is "does this vocabulary
 * exist?", not "did this query return anything?".
 *
 * Worth knowing before rendering one: every term checked here is also a hard
 * filter, so a term nothing satisfies cannot leave a row standing. A non-empty
 * result here therefore implies an empty `rows`, and a caller that prints
 * "nothing matches" and then names the term is printing one sentence twice.
 * The test named "an unknown term always means an empty result" holds this.
 */
function unmatched(
  pages: readonly QueryPage[],
  facts: Map<string, Facts>,
  q: KbQuery,
): string[] {
  const out: string[] = []
  const all = [...facts.values()]
  const lower = (s: string): string => s.toLowerCase()
  if (q.type !== undefined && !all.some((f) => lower(f.type() ?? '').includes(lower(q.type!))))
    out.push(`type:${q.type}`)
  for (const want of q.tags ?? []) {
    if (!all.some((f) => f.tags().some((t) => lower(t).includes(lower(want)))))
      out.push(`tag:${want}`)
  }
  for (const test of q.fields ?? []) {
    if (!all.some((f) => f.field(test.field) !== null)) out.push(`fm:${test.field}`)
  }
  if (q.path !== undefined && !pages.some((p) => lower(p.path).includes(lower(q.path!))))
    out.push(`path:${q.path}`)
  return out
}

// ── the grammar ─────────────────────────────────────────────────────────────

/** Runs of non-space, with quoted stretches kept whole: `fm:title="a b"`. */
const TOKEN_RE = /(?:[^\s"]|"[^"]*")+/g
const FILTER_RE = /^([a-zA-Z][a-zA-Z-]*):([\s\S]*)$/
/**
 * Every filter key, with what can follow it. One list, so a key cannot be
 * parseable without also being discoverable: adding a filter here makes the
 * grammar accept it AND makes it show up where people find out what exists.
 *
 * `fromKb` marks the keys whose values are the user's own vocabulary. Those
 * are the ones documentation can never answer — no manual knows which
 * frontmatter fields someone writes — so the knowledge base has to answer for
 * itself. `values` is for the ones the grammar decides. The rest can only
 * offer the SHAPE of what goes there, which is still more than nothing.
 */
export interface FilterHelp {
  key: string
  /** What can follow the colon, shown when there is no list to offer. */
  example: string
  /** Fixed values, where the grammar and not the knowledge base decides. */
  values?: readonly string[]
  /** Whether the knowledge base supplies the values. */
  fromKb?: boolean
}

export const FILTER_HELP: readonly FilterHelp[] = [
  { key: 'tag', example: 'llm', fromKb: true },
  { key: 'type', example: 'concept', fromKb: true },
  { key: 'path', example: 'wiki/', fromKb: true },
  { key: 'fm', example: 'status=draft', fromKb: true },
  { key: 'role', example: 'index', values: ['index', 'log'] },
  { key: 'orphan', example: 'true', values: ['true', 'false'] },
  { key: 'broken', example: 'true', values: ['true', 'false'] },
  { key: 'age', example: '>6m' },
  { key: 'modified', example: '<2026-01-01' },
  { key: 'links-to', example: 'index' },
  { key: 'linked-by', example: 'index' },
  { key: 'cites', example: 'paper.pdf' },
  { key: 'sort', example: '-modified' },
  { key: 'limit', example: '20' },
  { key: 'columns', example: 'rating,status' },
]

const KEYS = new Set(FILTER_HELP.map((f) => f.key))
const BUILTIN_SORTS = new Set(['path', 'title', 'modified', 'inbound'])
const DAY = 86_400_000
const UNITS: Record<string, number> = { d: DAY, w: 7 * DAY, m: 30 * DAY, y: 365 * DAY }

function unquote(s: string): string {
  return s.replace(/"([^"]*)"/g, '$1').trim()
}

/**
 * Text to query. Unknown `key:` words are not errors — they fall through to
 * the free-text search, so a note about `http://…` or a colon in prose still
 * searches for what it says instead of failing.
 *
 * Two time filters rather than one, because a single `modified:` cannot mean
 * both: `<30d` reads as "recent" (an age) while `<2026-10-01` reads as "older
 * than" (a date), and the same operator pointing opposite ways is a trap. So
 * `age:` compares age and `modified:` compares dates, each self-consistent.
 */
export function parseKbQuery(text: string, now: number): { query: KbQuery; errors: string[] } {
  const query: KbQuery = {}
  const errors: string[] = []
  const tags: string[] = []
  const fields: FieldTest[] = []
  const free: string[] = []

  const after = (ms: number): void => {
    query.modifiedAfter = Math.max(query.modifiedAfter ?? -Infinity, ms)
  }
  const before = (ms: number): void => {
    query.modifiedBefore = Math.min(query.modifiedBefore ?? Infinity, ms)
  }

  for (const token of text.match(TOKEN_RE) ?? []) {
    const m = token.match(FILTER_RE)
    const key = m ? m[1].toLowerCase() : ''
    if (!m || !KEYS.has(key)) {
      free.push(unquote(token))
      continue
    }
    const value = unquote(m[2])
    switch (key) {
      case 'type': query.type = value; break
      case 'tag': if (value) tags.push(value); break
      case 'path': query.path = value; break
      case 'links-to': query.linksTo = value; break
      case 'linked-by': query.linkedBy = value; break
      case 'cites': query.cites = value; break
      case 'role': {
        if (value === 'index' || value === 'log') query.role = value
        else errors.push(`role: expects index or log, got "${value}"`)
        break
      }
      case 'orphan':
      case 'broken': {
        if (value === 'true' || value === 'false') {
          const on = value === 'true'
          if (key === 'orphan') query.orphan = on
          else query.broken = on
        } else errors.push(`${key}: expects true or false, got "${value}"`)
        break
      }
      case 'age': {
        const a = value.match(/^([<>])(\d+)([dwmy])$/i)
        if (!a) {
          errors.push(`age: expects <30d or >6m (d/w/m/y), got "${value}"`)
          break
        }
        const span = Number(a[2]) * UNITS[a[3].toLowerCase()]
        if (a[1] === '<') after(now - span)
        else before(now - span)
        break
      }
      case 'modified': {
        const d = value.match(/^([<>])(\d{4}-\d{2}-\d{2})$/)
        if (!d) {
          errors.push(`modified: expects <YYYY-MM-DD or >YYYY-MM-DD, got "${value}"`)
          break
        }
        if (d[1] === '<') before(Date.parse(d[2]))
        else after(Date.parse(d[2]))
        break
      }
      case 'limit': {
        const n = Number(value)
        if (Number.isInteger(n) && n > 0) query.limit = n
        else errors.push(`limit: expects a positive whole number, got "${value}"`)
        break
      }
      case 'columns': {
        const cols = value.split(',').map((c) => c.trim()).filter(Boolean)
        if (cols.length) query.columns = cols
        break
      }
      case 'sort': {
        const desc = value.startsWith('-')
        const name = (desc ? value.slice(1) : value).trim()
        if (!name) {
          errors.push('sort: expects a field, e.g. sort:-modified')
          break
        }
        // Built-in names win; `fm.` forces the frontmatter reading of a name
        // that would otherwise be one of them.
        const k: SortKey = name.startsWith('fm.')
          ? { field: name.slice(3) }
          : BUILTIN_SORTS.has(name)
            ? (name as SortKey)
            : { field: name }
        query.sort = { key: k, order: desc ? 'desc' : 'asc' }
        break
      }
      case 'fm': {
        const f = value.match(/^([A-Za-z0-9_.-]+)\s*(>=|<=|!=|=|>|<)?\s*([\s\S]*)$/)
        if (!f) {
          errors.push(`fm: expects a field, e.g. fm:status=draft, got "${value}"`)
          break
        }
        const [, field, op, rest] = f
        if (!op) fields.push({ field, op: 'exists' })
        else if (rest.trim() === '') errors.push(`fm:${field}${op} is missing a value`)
        else fields.push({ field, op: op as Cmp, value: rest.trim() })
        break
      }
    }
  }

  if (tags.length) query.tags = tags
  if (fields.length) query.fields = fields
  const textTerm = free.join(' ').trim()
  if (textTerm) query.text = textTerm
  return { query, errors }
}

// ── files that are not pages ────────────────────────────────────────────────

/**
 * Every key that NARROWS a result — all of KbQuery except the free text and
 * the shaping (sort, limit, columns). One list because two questions are
 * asked of it, "was anything narrowed?" and "was only this narrowed?", and a
 * second enumeration would answer them differently the first time a filter is
 * added to one and not the other.
 */
const FILTER_KEYS = [
  'path', 'type', 'tags', 'role', 'fields', 'linksTo', 'linkedBy', 'cites',
  'orphan', 'broken', 'modifiedAfter', 'modifiedBefore',
] as const

/** The filter keys this query actually uses. */
function narrowedBy(q: KbQuery): string[] {
  return FILTER_KEYS.filter((k) => {
    const v = q[k]
    return Array.isArray(v) ? v.length > 0 : v !== undefined
  })
}

/** Whether anything beyond free text was asked. */
export function hasFilters(q: KbQuery): boolean {
  return narrowedBy(q).length > 0
}

/**
 * Whether a query asks only things a file with no content of its own could
 * answer, and whether this one does.
 *
 * The search palette lists documents beside pages, and a PDF has tags: the
 * ones the pages citing it declared (`kbIndex.tagsFor`). So `tag:llm` there
 * has always found the paper as well as the notes on it, and a merge that
 * quietly dropped that would be a regression nobody would report — the
 * document would simply stop turning up.
 *
 * The rule is not "sources are exempt", it is that each thing answers the
 * questions that apply to it. A document has inherited tags and a path; it
 * has no frontmatter, no outgoing links and no body of ours, so `fm:`,
 * `role:`, the link filters and `orphan:` are not questions it can answer —
 * and a query asking one of them is not asking about documents at all.
 */
export function sourceMatches(q: KbQuery, path: string, tags: readonly string[]): boolean {
  const asked = narrowedBy(q)
  // Something must actually have been asked, and only things a document can
  // answer. An empty query is the palette's "no filters" case and never
  // routes through here.
  if (!asked.length || !asked.every((k) => k === 'tags' || k === 'path')) return false
  const lower = (v: string): string => v.toLowerCase()
  if (q.path !== undefined && !lower(path).includes(lower(q.path))) return false
  for (const want of q.tags ?? []) {
    if (!tags.some((t) => lower(t).includes(lower(want)))) return false
  }
  return true
}

/**
 * The filter a query trails off in, if it trails off in one — `tag:` with
 * nothing after it, and now every other key too.
 *
 * Typing a filter is how you find out it exists; typing it and stopping is how
 * you find out what can go in it. That rule already existed for tags and was
 * the only way anyone learnt a tag's name; there was never a reason it should
 * be the only key that answers.
 */
export function bareFilterKey(term: string): FilterHelp | null {
  const m = term.trimEnd().match(/(?:^|\s)([a-zA-Z][a-zA-Z-]*):$/)
  if (!m) return null
  const key = m[1].toLowerCase()
  return FILTER_HELP.find((f) => f.key === key) ?? null
}

// ── rendering ───────────────────────────────────────────────────────────────

const MAX_LISTED = 50

/** Compact text for the agent, in the shape `formatLintReport` established. */
export function formatQueryResult(r: QueryResult, columns: readonly string[] = []): string {
  const terms = r.unmatchedTerms.join(', ')
  const head =
    r.total === 0
      ? r.unmatchedTerms.length
        ? `No pages match. This KB has no ${terms} — check the spelling.`
        : 'No pages match.'
      : r.rows.length < r.total
        ? `${r.rows.length} of ${r.total} matches:`
        : `${r.total} match${r.total === 1 ? '' : 'es'}:`
  const lines = r.rows.slice(0, MAX_LISTED).map((row) => {
    const bits = [row.path]
    if (row.type) bits.push(`[${row.type}]`)
    if (row.mtime !== undefined) bits.push(isoDay(row.mtime))
    bits.push(`${row.inbound}←`)
    for (const c of columns) {
      if (!BUILTIN_COLUMNS.has(c) && row.cells[c]) bits.push(`${c}=${row.cells[c]}`)
    }
    return '  ' + bits.join('  ')
  })
  if (r.rows.length > MAX_LISTED) lines.push(`  … +${r.rows.length - MAX_LISTED} more`)
  // Only when rows survived: an empty result already said it above, and
  // saying it twice is the same sentence twice.
  const warn =
    r.total > 0 && r.unmatchedTerms.length
      ? `\n\nNothing in this KB matches: ${terms} — check the spelling.`
      : ''
  return head + (lines.length ? '\n' + lines.join('\n') : '') + warn
}
