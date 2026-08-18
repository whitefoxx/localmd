/**
 * Deterministic KB structural lint — computed purely from the cached page graph
 * (content + resolved outgoing links + unresolved targets) plus the KB's file
 * list, with NO file reads and NO LLM. This is the cheap counterpart to an
 * agent reading every page: it catches broken links, orphans, unreachable
 * pages, missing frontmatter, thin/self-linking/placeholder pages, sources
 * nothing has read, dangling source declarations, and near-duplicate tags — so
 * the agent only spends tokens on the genuinely semantic checks
 * (contradictions).
 *
 * Everything here reports; nothing here fixes or blocks. The KB is a soft
 * constraint — a user is free to keep an unread PDF and two spellings of a tag,
 * and a check that cannot say why it fired does not belong.
 */
import { splitFrontmatter, extractTags } from '@/lib/wiki'
import { parseCiteSources, resolveCitePath } from '@/lib/citations'
import { isAnnotationsPath } from '@/lib/annotations'

export interface LintPage {
  content: string
  /** Resolved KB paths this page links to (wikilinks + markdown links). */
  outgoing: string[]
  /** Link targets that resolve to no file. */
  broken: string[]
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
  /** Tags that differ only in case, separator, or a trailing `s`. */
  similarTags: { variants: { tag: string; count: number }[] }[]
}

const THIN_LINES = 10

/**
 * A file that can be *cited* rather than linked: source material a page could
 * have read. Excluded: notes (the orphan checks own those), anything under a
 * dot-directory (`.trace/` indexes, `.agents/`, `.obsidian/` are plumbing, ours
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

/** index.md / log.md at any depth are structural entry points, not content. */
export function isEntryPage(path: string): boolean {
  const p = path.toLowerCase()
  return p === 'index.md' || p === 'log.md' || p.endsWith('/index.md') || p.endsWith('/log.md')
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
): LintReport {
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
    if (files.length) {
      const missing = [...parseCiteSources(body).values()]
        .map((s) => s.path)
        .filter((p) => resolveCitePath(p, files as string[]) === null)
      if (missing.length) danglingCitations.push({ path, targets: [...new Set(missing)] })
    }

    if (isEntryPage(path)) continue // skip page-quality checks for index/log

    const contentInbound = [...(inbound.get(path) ?? [])].filter((p) => !isEntryPage(p))
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

  // Pages you can't reach by navigating from the root index (missing index entry).
  const unreachable: string[] = []
  const root = pages.has('wiki/index.md') ? 'wiki/index.md' : pages.has('index.md') ? 'index.md' : null
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
      if (!seen.has(path) && !isEntryPage(path)) unreachable.push(path)
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
    similarTags,
  }
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
    tags

  const tail =
    `\n\nThis is STRUCTURAL only. Semantic checks (contradictions, stale claims) require ` +
    `reading page content and are token-heavy — report the above first, then ask the user ` +
    `before scanning content (and let them narrow the scope).`

  return summary + (body || '\n\nNo structural issues found.') + tail
}
