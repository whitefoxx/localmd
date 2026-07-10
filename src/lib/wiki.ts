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
