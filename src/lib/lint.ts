/**
 * Deterministic KB structural lint — computed purely from the cached page graph
 * (content + resolved outgoing links + unresolved targets), with NO file reads
 * and NO LLM. This is the cheap counterpart to an agent reading every page: it
 * catches broken links, orphans, unreachable pages, missing frontmatter, and
 * thin/self-linking/placeholder pages so the agent only spends tokens on the
 * genuinely semantic checks (contradictions).
 */
import { splitFrontmatter } from '@/lib/wiki'

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
}

const THIN_LINES = 10

/** index.md / log.md at any depth are structural entry points, not content. */
export function isEntryPage(path: string): boolean {
  const p = path.toLowerCase()
  return p === 'index.md' || p === 'log.md' || p.endsWith('/index.md') || p.endsWith('/log.md')
}

export function computeLint(pages: ReadonlyMap<string, LintPage>): LintReport {
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

  for (const [path, page] of pages) {
    if (page.broken.length) brokenLinks.push({ path, targets: [...new Set(page.broken)] })
    if (page.outgoing.includes(path)) selfLinks.push(path)
    if (/\[\[[^\]]*\.\.\.[^\]]*\]\]/.test(page.content)) placeholders.push(path)

    if (isEntryPage(path)) continue // skip page-quality checks for index/log

    const contentInbound = [...(inbound.get(path) ?? [])].filter((p) => !isEntryPage(p))
    const outbound = page.outgoing.filter((t) => t !== path)
    if (contentInbound.length === 0 && outbound.length === 0) orphans.push(path)
    else if (contentInbound.length === 0) weaklyLinked.push(path)

    const { yaml, body } = splitFrontmatter(page.content)
    if (yaml === null) noFrontmatter.push(path)
    const lines = body.split('\n').filter((l) => l.trim()).length
    if (lines < THIN_LINES) thin.push({ path, lines })
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
    `${r.noFrontmatter.length} no-frontmatter · ${r.thin.length} thin`

  const broken = r.brokenLinks.length
    ? `\n\nBroken wikilinks (target missing):\n` +
      capped(r.brokenLinks.map((b) => `${b.path} → ${b.targets.join(', ')}`))
    : ''
  const thin = r.thin.length
    ? `\n\nThin pages (<${THIN_LINES} lines):\n` +
      capped(r.thin.map((t) => `${t.path} (${t.lines})`))
    : ''

  const body =
    broken +
    list('Orphan pages (no content inbound, no outbound)', r.orphans) +
    list('Weakly-linked (only index/log link to them)', r.weaklyLinked) +
    list('Unreachable from the index', r.unreachable) +
    list('Missing frontmatter', r.noFrontmatter) +
    thin +
    list('Self-referencing links', r.selfLinks) +
    list('Placeholder links ([[…]])', r.placeholders)

  const tail =
    `\n\nThis is STRUCTURAL only. Semantic checks (contradictions, stale claims) require ` +
    `reading page content and are token-heavy — report the above first, then ask the user ` +
    `before scanning content (and let them narrow the scope).`

  return summary + (body || '\n\nNo structural issues found.') + tail
}
