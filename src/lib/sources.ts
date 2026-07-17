/**
 * Reply sources: turn the references an agent leaves in a chat answer —
 * [[wikilinks]] to KB files and Markdown/auto links to external URLs — into
 * numbered citations. A superscript is injected after each reference and a
 * "Sources" list is rendered at the foot of the message; both jump to the
 * target on click (KB file → open it; URL → new tab).
 *
 * This is deliberately separate from the indexed-document citation system
 * ([[pdfN:path]] / [[N:block-id]] in lib/citations.ts): those are block-level
 * anchors into PDFs/EPUBs with their own click routing and are left untouched.
 */

export interface Source {
  /** 1-based citation number, in first-appearance order across the message. */
  n: number
  kind: 'url' | 'file'
  /** URL, or KB-relative file path. */
  target: string
  /** Human label — the link text, falling back to the target. */
  label: string
}

/** The minimal anchor shape classifyAnchor needs (a real DOM <a>, or a stub). */
export interface AnchorInfo {
  classes: string[]
  href: string | null
  /** wikilink resolved KB path (data-target) and whether it resolved. */
  dataTarget?: string
  dataResolved?: string
  text: string
}

/**
 * Decide whether an anchor is a citable source. Returns null for non-sources:
 * indexed-document block citations (their own system), broken wikilinks,
 * in-page anchors, mailto:, and our own already-injected superscripts.
 */
export function classifyAnchor(a: AnchorInfo): Omit<Source, 'n'> | null {
  // Block citations into indexed docs are handled elsewhere — never re-cite.
  if (a.classes.includes('citation') || a.classes.includes('cite-source')) return null
  // Our own injected superscript / footer links.
  if (a.classes.includes('src-cite-ref')) return null

  if (a.classes.includes('wikilink')) {
    // Only a resolved wikilink points at a real KB file; broken ones aren't sources.
    if (a.dataResolved === '1' && a.dataTarget) {
      return { kind: 'file', target: a.dataTarget, label: (a.text || a.dataTarget).trim() }
    }
    return null
  }

  const href = (a.href ?? '').trim()
  if (!href || href.startsWith('#') || href.startsWith('mailto:')) return null
  if (/^https?:\/\//i.test(href)) return { kind: 'url', target: href, label: (a.text || href).trim() }
  // Any other explicit scheme (data:, tel:, javascript:, …) is not a KB file.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null
  // A relative Markdown link — a KB file reference resolved at click time.
  return { kind: 'file', target: href, label: (a.text || href).trim() }
}

/**
 * Accumulates sources across a message's parts, deduping by kind+target and
 * numbering by first appearance. `collect` returns the assigned number so the
 * caller can inject a matching superscript.
 */
export function createSourceCollector(): {
  collect: (s: Omit<Source, 'n'>) => number
  sources: Source[]
} {
  const byKey = new Map<string, Source>()
  const sources: Source[] = []
  return {
    collect(s) {
      const key = `${s.kind}:${s.target}`
      const existing = byKey.get(key)
      if (existing) return existing.n
      const entry: Source = { n: sources.length + 1, ...s }
      byKey.set(key, entry)
      sources.push(entry)
      return entry.n
    },
    sources,
  }
}
