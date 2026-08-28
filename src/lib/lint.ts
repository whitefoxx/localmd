/**
 * Deterministic KB structural lint — computed purely from the cached page graph
 * (content + resolved outgoing links + unresolved targets) plus the KB's file
 * list, with NO file reads and NO LLM. This is the cheap counterpart to an
 * agent reading every page: it catches broken links, orphans, unreachable
 * pages, missing frontmatter, thin/self-linking/placeholder pages, sources
 * nothing has read, dangling source declarations, pages their own sources have
 * moved on from, and near-duplicate tags — so the agent only spends tokens on
 * the genuinely semantic checks (contradictions).
 *
 * Modification times are the one input this file cannot derive: the caller
 * hands them in already gathered (page mtimes are in its cache anyway, source
 * mtimes it stats for the handful of files pages actually cite). Passing none
 * is a supported state — every other check still runs.
 *
 * Everything here reports; nothing here fixes or blocks. The KB is a soft
 * constraint — a user is free to keep an unread PDF and two spellings of a tag,
 * and a check that cannot say why it fired does not belong.
 */
import { splitFrontmatter, extractRole, extractTags, parseWikilinks } from '@/lib/wiki'
import { parseCiteSources, resolveCitePath } from '@/lib/citations'
import { isAnnotationsPath } from '@/lib/annotations'

export interface LintPage {
  content: string
  /** Resolved KB paths this page links to (wikilinks + markdown links). */
  outgoing: string[]
  /** Link targets that resolve to no file. */
  broken: string[]
  /** When the page file was last written. Only the staleness check reads it,
   *  and only when the cited source's mtime is known too. */
  mtime?: number
}

export interface LintReport {
  pageCount: number
  brokenLinks: { path: string; targets: string[] }[]
  /** No inbound from content pages AND no outbound — fully isolated. */
  orphans: string[]
  /** No inbound from content pages (only index/log link to it). */
  weaklyLinked: string[]
  /** Not reachable by following links from the root index page. */
  unreachable: string[]
  noFrontmatter: string[]
  thin: { path: string; lines: number }[]
  selfLinks: string[]
  /** Pages containing placeholder wikilinks like `[[wiki/...]]`. */
  placeholders: string[]
  /** Non-markdown files no page mentions at all — material sitting unread. */
  unreferencedSources: string[]
  /** `[[pdfN:path]]` declarations pointing at a file that isn't in the KB. */
  danglingCitations: { path: string; targets: string[] }[]
  /** Pages written before a source they cite was last modified — the page may
   *  no longer say what the source says. */
  stalePages: { path: string; sources: string[] }[]
  /** Dated log entries whose subject pages have been edited since — whatever
   *  the entry recorded may already have been dealt with. */
  staleLogEntries: { path: string; entry: string; pages: string[] }[]
  /** Tags that differ only in case, separator, or a trailing `s`. */
  similarTags: { variants: { tag: string; count: number }[] }[]
}

const THIN_LINES = 10

/**
 * A file that can be *cited* rather than linked: source material a page could
 * have read. Excluded: notes (the orphan checks own those), anything under a
 * dot-directory (`.localmd/` indexes, `.agents/`, `.obsidian/` are plumbing, ours
 * or the user's), and annotation sidecars — a `foo.pdf.annotations.json` is
 * metadata *about* a source that the app wrote and the tree deliberately shows,
 * so calling it unread material would send the agent after our own bookkeeping.
 */
function isSourceCandidate(path: string): boolean {
  if (path.endsWith('.md')) return false // notes are covered by the orphan checks
  if (isAnnotationsPath(path)) return false
  return !path.split('/').some((seg) => seg.startsWith('.'))
}

/** Tags collapse to one key when they differ only in case, separators, or an
 *  ASCII plural — `Machine Learning`, `machine-learning`, `machine_learnings`.
 *  Deliberately shape-only: `ml` vs `machine-learning` is a judgement call, and
 *  a lint that guesses at meaning starts nagging about things that are fine. */
function tagKey(tag: string): string {
  const k = tag.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  return k.endsWith('s') ? k.slice(0, -1) : k
}

/**
 * The `[[pdfN:path]]` sources a page declares, each paired with the real file
 * it resolves to (null when nothing in the KB can be it). One implementation
 * for both citation checks: a declaration that resolves to nothing is dangling,
 * and one that resolves to a file newer than the page is stale.
 */
function citedSources(
  body: string,
  files: readonly string[],
): { declared: string; resolved: string | null }[] {
  return [...parseCiteSources(body).values()].map((s) => ({
    declared: s.path,
    resolved: resolveCitePath(s.path, files as string[]),
  }))
}

/**
 * How much newer than a page a source must be before the gap means anything.
 *
 * An mtime is not a content change: a git checkout, a folder copy, or a cloud
 * client re-downloading a file stamps everything with the moment it landed, and
 * within such a batch the order of a page and its source is arbitrary. A minute
 * is far longer than any of those take to write a file and far shorter than the
 * gap this check exists to find — a source revised days after the page that
 * summarises it.
 */
const CLOCK_SLACK_MS = 60_000

/**
 * A knowledge base's synthesis log — `log.md` at any depth.
 *
 * Karpathy's third page kind, after entity pages and concept overviews, and
 * the one the app had no word for: `isEntryPage` already kept it out of the
 * page-quality checks, but nothing wrote one, described one, or read one back.
 * It is where a finding that is not itself a page goes — "these two pages
 * disagree", "this claim needs a source" — so that a contradiction found
 * during a scan outlives the message it was mentioned in.
 *
 * Optional, like everything else here. A KB without one is not missing
 * anything; a KB whose log is freeform prose simply reports nothing below.
 */
export function isLogPage(path: string): boolean {
  const p = path.toLowerCase()
  return p === 'log.md' || p.endsWith('/log.md')
}

/** index.md / log.md at any depth are structural entry points, not content.
 *  Name-based DEFAULT only: inside computeLint a page's frontmatter
 *  `kb-role:` overrides its name (see the role map there) — these helpers
 *  answer for callers that have a path but no content. */
export function isEntryPage(path: string): boolean {
  const p = path.toLowerCase()
  return p === 'index.md' || p.endsWith('/index.md') || isLogPage(path)
}

/** A `##`/`###` heading that opens with an ISO date. Everything after the date
 *  is the entry's own words and is kept verbatim for the report. */
const LOG_HEADING_RE = /^#{2,3}[ \t]+(\d{4})-(\d{2})-(\d{2})(.*)$/

/**
 * The dated entries of a log page, each with the moment after which a change
 * to its subject pages means something, and the wikilink targets it names.
 *
 * The date is taken to the END of its day. A day-granular date cannot say more
 * than "that day", and the alternative — midnight — would make every entry
 * report itself, since writing an entry about two pages usually happens on a
 * day those pages were also touched.
 */
export function parseLogEntries(
  content: string,
): { title: string; after: number; targets: string[] }[] {
  const entries: { title: string; after: number; targets: string[] }[] = []
  let current: { title: string; after: number; lines: string[] } | null = null
  const flush = (): void => {
    if (!current) return
    entries.push({
      title: current.title,
      after: current.after,
      targets: parseWikilinks(current.lines.join('\n')).map((l) => l.target),
    })
  }
  for (const line of content.split('\n')) {
    const m = LOG_HEADING_RE.exec(line)
    if (m) {
      flush()
      const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      current = {
        title: line.replace(/^#+[ \t]+/, '').trim(),
        after: day + 24 * 60 * 60 * 1000,
        lines: [line],
      }
    } else if (current) {
      current.lines.push(line)
    }
  }
  flush()
  return entries
}

/** Pair a wikilink target as written with the resolved page path it produced.
 *  The log's `outgoing` was resolved from these very links, so matching on the
 *  stem recovers the mapping without re-implementing link resolution — and a
 *  target that resolves to nothing is `brokenLinks`' business, not ours. */
function matchLinkTarget(target: string, outgoing: readonly string[]): string | undefined {
  const want = target.toLowerCase().replace(/\.md$/, '')
  if (!want) return undefined
  return outgoing.find((p) => {
    const stem = p.toLowerCase().replace(/\.md$/, '')
    return stem === want || stem.endsWith(`/${want}`)
  })
}

/**
 * @param files Every path in the KB, notes included. Without it the three
 *   file-aware checks return empty rather than guessing: "no file list" and
 *   "no files" are different answers, and reporting every citation as dangling
 *   because the caller passed nothing would be a lie.
 */
export function computeLint(
  pages: ReadonlyMap<string, LintPage>,
  files: readonly string[] = [],
  sourceMtimes: ReadonlyMap<string, number> = new Map(),
): LintReport {
  // A page's structural role: its own `kb-role:` frontmatter wins over its
  // name — the role travels with the file — and the name stays the
  // zero-config default. A page whose explicit role contradicts its name
  // (an `index.md` declaring `kb-role: log`) is what its frontmatter says.
  const explicitRole = new Map<string, 'index' | 'log' | null>()
  for (const [path, pg] of pages) explicitRole.set(path, extractRole(pg.content))
  const roleOf = (path: string): 'index' | 'log' | null => {
    const declared = explicitRole.get(path)
    if (declared) return declared
    if (isLogPage(path)) return 'log'
    if (isEntryPage(path)) return 'index'
    return null
  }
  const isEntry = (path: string): boolean => roleOf(path) !== null

  // Inbound map (self-links excluded).
  const inbound = new Map<string, Set<string>>()
  for (const [path, page] of pages) {
    for (const target of page.outgoing) {
      if (target === path || !pages.has(target)) continue
      let set = inbound.get(target)
      if (!set) inbound.set(target, (set = new Set()))
      set.add(path)
    }
  }

  const brokenLinks: LintReport['brokenLinks'] = []
  const orphans: string[] = []
  const weaklyLinked: string[] = []
  const noFrontmatter: string[] = []
  const thin: LintReport['thin'] = []
  const selfLinks: string[] = []
  const placeholders: string[] = []
  const danglingCitations: LintReport['danglingCitations'] = []
  const stalePages: LintReport['stalePages'] = []
  const staleLogEntries: LintReport['staleLogEntries'] = []
  /** normalised key → original spelling → how many pages used it. */
  const tagsByKey = new Map<string, Map<string, number>>()

  for (const [path, page] of pages) {
    if (page.broken.length) brokenLinks.push({ path, targets: [...new Set(page.broken)] })
    if (page.outgoing.includes(path)) selfLinks.push(path)
    if (/\[\[[^\]]*\.\.\.[^\]]*\]\]/.test(page.content)) placeholders.push(path)

    const { yaml, body } = splitFrontmatter(page.content)

    for (const tag of extractTags(page.content)) {
      const key = tagKey(tag)
      if (!key) continue
      let spellings = tagsByKey.get(key)
      if (!spellings) tagsByKey.set(key, (spellings = new Map()))
      spellings.set(tag, (spellings.get(tag) ?? 0) + 1)
    }

    // A declared citation path is a claim, not a fact — resolveCitePath accepts
    // a unique basename match so moving a file (the user's right) doesn't turn
    // every page that cites it red. Only what it can't place at all is dangling.
    //
    // The same declarations answer the other half: a page claims to have read
    // what it cites, so a source revised after the page was last written is the
    // one drift this file can prove without reading a word. Deliberately NOT
    // extended to pages that merely name a file (what `unreferencedSources`
    // matches on) — naming a source is not claiming to have compiled it, and a
    // check that cannot say why it fired does not belong here.
    if (files.length) {
      const missing: string[] = []
      const outrun: string[] = []
      for (const { declared, resolved } of citedSources(body, files)) {
        if (resolved === null) {
          missing.push(declared)
          continue
        }
        const sourceMtime = sourceMtimes.get(resolved)
        if (
          page.mtime !== undefined &&
          sourceMtime !== undefined &&
          sourceMtime - page.mtime > CLOCK_SLACK_MS
        ) {
          outrun.push(resolved)
        }
      }
      if (missing.length) danglingCitations.push({ path, targets: [...new Set(missing)] })
      if (outrun.length) stalePages.push({ path, sources: [...new Set(outrun)] })
    }

    // A log entry records something that was true when it was written. Once
    // ANY page it names has been edited since, the entry is a question worth
    // re-asking — a contradiction between two pages is settled by changing
    // either one — and that is the cheap half of a review queue's sweep, which
    // this deliberately stops short of: closing an entry needs a judgement
    // about content, and a check that guesses at meaning does not belong here.
    if (roleOf(path) === 'log') {
      for (const entry of parseLogEntries(body)) {
        const moved = [
          ...new Set(
            entry.targets
              .map((t) => matchLinkTarget(t, page.outgoing))
              .filter((p): p is string => !!p),
          ),
        ].filter((p) => {
          const m = pages.get(p)?.mtime
          return m !== undefined && m > entry.after
        })
        if (moved.length) staleLogEntries.push({ path, entry: entry.title, pages: moved.sort() })
      }
    }

    if (isEntry(path)) continue // skip page-quality checks for index/log

    const contentInbound = [...(inbound.get(path) ?? [])].filter((p) => !isEntry(p))
    const outbound = page.outgoing.filter((t) => t !== path)
    if (contentInbound.length === 0 && outbound.length === 0) orphans.push(path)
    else if (contentInbound.length === 0) weaklyLinked.push(path)

    if (yaml === null) noFrontmatter.push(path)
    const lines = body.split('\n').filter((l) => l.trim()).length
    if (lines < THIN_LINES) thin.push({ path, lines })
  }

  // A source counts as read when ANY page mentions its filename — wikilink,
  // markdown link, image, `[[pdfN:…]]` declaration or bare prose. Matching the
  // name rather than resolving each link form is deliberately generous: the
  // finding is "nothing in this KB has ever named this file", which is worth
  // acting on precisely because it cannot be a false alarm.
  const unreferencedSources: string[] = []
  if (files.length) {
    const haystack = [...pages.values()].map((p) => p.content).join('\n')
    for (const path of files) {
      if (!isSourceCandidate(path)) continue
      const base = path.slice(path.lastIndexOf('/') + 1)
      if (!haystack.includes(base) && !haystack.includes(encodeURIComponent(base))) {
        unreferencedSources.push(path)
      }
    }
  }

  const similarTags: LintReport['similarTags'] = []
  for (const spellings of tagsByKey.values()) {
    if (spellings.size < 2) continue
    similarTags.push({
      variants: [...spellings]
        .map(([tag, count]) => ({ tag, count }))
        // Most-used first: that is the spelling to standardise on.
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    })
  }

  // Pages you can't reach by navigating from the root index (missing index
  // entry). A page DECLARING `kb-role: index` outranks the name defaults —
  // this is what un-traps the KB whose `index.md` is the user's own,
  // unrelated file: point the role at the real index and the reachability
  // walk starts there instead. Two declarations tie-break lexicographically
  // (deterministic, never an error). A name candidate whose own frontmatter
  // says `log` is not an index.
  const unreachable: string[] = []
  const declaredIndexes = [...explicitRole]
    .filter(([, role]) => role === 'index')
    .map(([path]) => path)
    .sort()
  const nameCandidate = ['wiki/index.md', 'index.md'].find(
    (p) => pages.has(p) && explicitRole.get(p) !== 'log',
  )
  const root = declaredIndexes[0] ?? nameCandidate ?? null
  if (root) {
    const seen = new Set<string>([root])
    const queue = [root]
    while (queue.length) {
      const cur = queue.shift()!
      for (const t of pages.get(cur)?.outgoing ?? []) {
        if (!seen.has(t) && pages.has(t)) {
          seen.add(t)
          queue.push(t)
        }
      }
    }
    for (const path of pages.keys()) {
      if (!seen.has(path) && !isEntry(path)) unreachable.push(path)
    }
  }

  const byPath = (a: string, b: string): number => a.localeCompare(b)
  brokenLinks.sort((a, b) => byPath(a.path, b.path))
  thin.sort((a, b) => byPath(a.path, b.path))
  orphans.sort(byPath)
  weaklyLinked.sort(byPath)
  unreachable.sort(byPath)
  noFrontmatter.sort(byPath)
  selfLinks.sort(byPath)
  placeholders.sort(byPath)
  unreferencedSources.sort(byPath)
  danglingCitations.sort((a, b) => byPath(a.path, b.path))
  stalePages.sort((a, b) => byPath(a.path, b.path))
  // Entry order within a log is the author's; only the pages are sorted.
  staleLogEntries.sort((a, b) => byPath(a.path, b.path))
  similarTags.sort((a, b) => byPath(a.variants[0].tag, b.variants[0].tag))

  return {
    pageCount: pages.size,
    brokenLinks,
    orphans,
    weaklyLinked,
    unreachable,
    noFrontmatter,
    thin,
    selfLinks,
    placeholders,
    unreferencedSources,
    danglingCitations,
    stalePages,
    staleLogEntries,
    similarTags,
  }
}

/**
 * Every file the KB's pages declare as a source, resolved and de-duplicated —
 * the caller's shopping list for `sourceMtimes`. Usually a handful of
 * documents, which is the point: statting only what something actually cites
 * keeps the staleness check off the critical path of a KB with a large `data/`
 * folder, where statting every source candidate would not.
 */
export function declaredSourcePaths(
  pages: ReadonlyMap<string, LintPage>,
  files: readonly string[],
): string[] {
  const out = new Set<string>()
  for (const page of pages.values()) {
    const { body } = splitFrontmatter(page.content)
    for (const { resolved } of citedSources(body, files)) if (resolved) out.add(resolved)
  }
  return [...out]
}

/** Per-category cap in the rendered report — counts stay exact, long path
 *  lists get elided (the Health panel shows every entry). */
const MAX_LISTED = 40

/** Render a report as compact text for the agent (the kb_health tool result). */
export function formatLintReport(r: LintReport): string {
  const capped = (rendered: string[]): string => {
    const shown = rendered.slice(0, MAX_LISTED).map((p) => `  ${p}`)
    if (rendered.length > MAX_LISTED) {
      shown.push(`  … +${rendered.length - MAX_LISTED} more (full list in the Health panel)`)
    }
    return shown.join('\n')
  }
  const list = (title: string, items: string[]): string =>
    items.length ? `\n\n${title} (${items.length}):\n` + capped(items) : ''

  const summary =
    `KB structural health — ${r.pageCount} pages · ` +
    `${r.brokenLinks.length} with broken links · ${r.orphans.length} orphan · ` +
    `${r.weaklyLinked.length} weakly-linked · ${r.unreachable.length} unreachable · ` +
    `${r.noFrontmatter.length} no-frontmatter · ${r.thin.length} thin · ` +
    `${r.unreferencedSources.length} unread sources · ` +
    `${r.danglingCitations.length} with dangling citations · ` +
    `${r.stalePages.length} behind their sources · ` +
    `${r.staleLogEntries.length} to recheck in the log · ` +
    `${r.similarTags.length} tag collisions`

  const broken = r.brokenLinks.length
    ? `\n\nBroken wikilinks (target missing):\n` +
      capped(r.brokenLinks.map((b) => `${b.path} → ${b.targets.join(', ')}`))
    : ''
  const thin = r.thin.length
    ? `\n\nThin pages (<${THIN_LINES} lines):\n` +
      capped(r.thin.map((t) => `${t.path} (${t.lines})`))
    : ''
  const dangling = r.danglingCitations.length
    ? `\n\nDangling source declarations ([[pdfN:path]] with no such file):\n` +
      capped(r.danglingCitations.map((d) => `${d.path} → ${d.targets.join(', ')}`))
    : ''
  const stale = r.stalePages.length
    ? `\n\nPages older than a source they cite (the source was revised after the page ` +
      `was last written — re-read the source before trusting the page, and never ` +
      `rewrite a page from memory to "fix" this):\n` +
      capped(r.stalePages.map((p) => `${p.path} → ${p.sources.join(', ')}`))
    : ''
  const logEntries = r.staleLogEntries.length
    ? `\n\nLog entries whose pages have been edited since (whatever the entry ` +
      `recorded may already have been dealt with — re-read the pages before saying so, ` +
      `and close an entry only when the user agrees it is closed):\n` +
      capped(r.staleLogEntries.map((e) => `${e.path} · ${e.entry} → ${e.pages.join(', ')}`))
    : ''
  const tags = r.similarTags.length
    ? `\n\nNear-duplicate tags (same tag, different spellings — most-used first):\n` +
      capped(r.similarTags.map((g) => g.variants.map((v) => `${v.tag} (${v.count})`).join(' · ')))
    : ''

  const body =
    broken +
    list('Orphan pages (no content inbound, no outbound)', r.orphans) +
    list('Weakly-linked (only index/log link to them)', r.weaklyLinked) +
    list('Unreachable from the index', r.unreachable) +
    list('Missing frontmatter', r.noFrontmatter) +
    thin +
    list('Self-referencing links', r.selfLinks) +
    list('Placeholder links ([[…]])', r.placeholders) +
    list('Sources no page mentions (unread material)', r.unreferencedSources) +
    dangling +
    stale +
    logEntries +
    tags

  const tail =
    `\n\nThis is STRUCTURAL only. Semantic checks (contradictions, claims that no longer ` +
    `match what the source now says) require ` +
    `reading page content and are token-heavy — report the above first, then ask the user ` +
    `before scanning content (and let them narrow the scope). What such a scan finds is ` +
    `not a page: offer to record it as a dated entry in the KB's log page (log.md, ` +
    `creating one only if the user wants it), naming the pages involved with [[wikilinks]], ` +
    `so the finding outlives this conversation. Never edit a page to make a contradiction ` +
    `go away without the user choosing which side is right.`

  return summary + (body || '\n\nNo structural issues found.') + tail
}
