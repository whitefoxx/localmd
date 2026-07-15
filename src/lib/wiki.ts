/**
 * Wikilink / frontmatter parsing helpers.
 * Ported from trace-app src/shared/wiki.ts — pure TS, no platform APIs.
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
