/**
 * Wikilink / frontmatter parsing helpers. Pure TS, no platform APIs.
 */

export const WIKILINK_RE = /\[\[([^\[\]]+)\]\]/g

export interface ParsedWikilink {
  target: string
  label: string
}

export function parseWikilinks(content: string): ParsedWikilink[] {
  const out: ParsedWikilink[] = []
  WIKILINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    out.push(splitLink(m[1]))
  }
  return out
}

export function splitLink(inner: string): ParsedWikilink {
  const [t, l] = inner.split('|').map((s) => s.trim())
  return { target: t, label: l || t }
}

// Inline markdown links `[label](href "title")`, excluding images (`![...]`).
// The leading `(?<!\!)` drops image syntax; the href stops at whitespace or `)`.
const MD_LINK_RE = /(?<!!)\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g

/**
 * Extract internal document links from a markdown body — the OKF/CommonMark
 * counterpart to wikilinks. Returns hrefs pointing at pages: bundle-relative
 * absolute (`/tables/x.md`), relative (`./x.md`, `../x`), or bare (`x.md`).
 * External URLs, `mailto:`, protocol-relative, pure anchors, and non-page
 * assets (images, `.pdf`, `.png` …) are filtered out so the graph and health
 * report stay page-to-page. Query strings and anchors are stripped.
 */
export function parseMarkdownLinks(content: string): string[] {
  const out: string[] = []
  MD_LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MD_LINK_RE.exec(content)) !== null) {
    let href = m[1].replace(/^<|>$/g, '').trim()
    if (!href || href.startsWith('#')) continue
    // Scheme (http:, mailto:, …) or protocol-relative → external, skip.
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) continue
    href = href.replace(/[?#].*$/, '') // drop query / fragment
    if (!href) continue
    // Keep only page references: explicit `.md`, or an extensionless basename.
    const base = href.split('/').pop() ?? href
    if (href.endsWith('.md') || !base.includes('.')) out.push(href)
  }
  return out
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?/

export interface FrontmatterParse {
  /** Raw YAML body inside the `---` fences, or null if no frontmatter. */
  yaml: string | null
  /** Markdown body with frontmatter stripped. */
  body: string
}

export function splitFrontmatter(content: string): FrontmatterParse {
  const m = content.match(FM_RE)
  if (!m) return { yaml: null, body: content }
  return { yaml: m[1], body: content.slice(m[0].length) }
}

/** Lightweight title extraction (`title:` in YAML or first `# h1`). */
export function extractTitle(content: string): string | null {
  const { yaml, body } = splitFrontmatter(content)
  if (yaml) {
    const t = yaml.match(/^title:\s*['"]?([^'"\n]+?)['"]?\s*$/m)
    if (t) return t[1].trim()
  }
  const h1 = body.match(/^#\s+(.+)$/m)
  return h1 ? h1[1].trim() : null
}

/** Frontmatter `type:` value (OKF's one required field per concept), or null. */
export function extractType(content: string): string | null {
  const { yaml } = splitFrontmatter(content)
  if (!yaml) return null
  const m = yaml.match(/^type:\s*['"]?([^'"\n]+?)['"]?\s*$/m)
  return m ? m[1].trim() : null
}

/**
 * Frontmatter `kb-role:` — a page declaring which structural role it plays,
 * regardless of its filename. Names are the zero-config default (`index.md`,
 * `log.md`); the marker exists for the collision case: a KB whose `log.md` is
 * the user's own (a workout log, say) gets its synthesis log under another
 * name, with `kb-role: log` carrying the role. The role travels with the
 * file through renames and moves — one fact, one place (docs/TODO.md,
 * "meta 页面的角色解析"). Unknown values are ignored, not errors: the KB is a
 * soft constraint.
 */
export function extractRole(content: string): 'index' | 'log' | null {
  const { yaml } = splitFrontmatter(content)
  if (!yaml) return null
  const m = yaml.match(/^kb-role:\s*['"]?([^'"\n]+?)['"]?\s*$/m)
  const v = m?.[1].trim().toLowerCase()
  return v === 'index' || v === 'log' ? v : null
}

/**
 * Frontmatter `tags:` values, in both YAML shapes people actually write:
 * `tags: [a, b]` / `tags: a, b` on one line, or a `- item` block under it.
 * Returns them verbatim — case and separators are the caller's business
 * (the tag-hygiene lint compares near-duplicates on a normalised key).
 */
export function extractTags(content: string): string[] {
  const { yaml } = splitFrontmatter(content)
  if (!yaml) return []
  const m = yaml.match(/^tags:[ \t]*(.*)$/m)
  if (!m) return []
  const unquote = (s: string): string => s.trim().replace(/^['"]|['"]$/g, '').trim()

  const inline = m[1].trim()
  if (inline) {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(unquote)
      .filter(Boolean)
  }

  const out: string[] = []
  for (const line of yaml.slice(m.index! + m[0].length).replace(/^\n/, '').split('\n')) {
    const item = line.match(/^[ \t]*-[ \t]*(.+)$/)
    if (!item) break // first non-item line ends the block
    const tag = unquote(item[1])
    if (tag) out.push(tag)
  }
  return out
}

/** Cross-platform basename. */
export function baseName(p: string): string {
  return p.split('/').pop() ?? p
}

/** Cross-platform dirname. */
export function dirName(p: string): string {
  const parts = p.split('/')
  parts.pop()
  return parts.join('/')
}

/** File stem: basename without the trailing extension. */
export function fileStem(p: string): string {
  const b = baseName(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(0, i) : b
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * A source's tags, inherited from the pages that cite it.
 *
 * A PDF has no frontmatter of its own, and a sidecar only this app could read
 * would put a second copy of the same fact in someone's folder. So the tags
 * stay on the pages and a document gets the union of what its readers said
 * about it — nothing to write, nothing to keep in sync, and re-tagging a page
 * re-tags its sources for free.
 *
 * @param pages path → { tags it declares, sources it resolves to }
 */
export function deriveSourceTags(
  pages: Iterable<{ tags: readonly string[]; sources: readonly string[] }>,
): Map<string, string[]> {
  const map = new Map<string, Set<string>>()
  for (const { tags, sources } of pages) {
    if (!tags.length) continue
    for (const source of sources) {
      let set = map.get(source)
      if (!set) map.set(source, (set = new Set()))
      for (const t of tags) set.add(t)
    }
  }
  return new Map([...map].map(([k, v]) => [k, [...v].sort()]))
}
