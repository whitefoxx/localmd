/**
 * Render-time handling of Q&A citation tokens inside wiki pages and chat
 * answers. Ported from trace-app — token forms:
 *   [[pdf1:raw/papers/x.pdf]]   — declares source #1 (also [[epub2:…]], [[md3:…]], [[docx4:…]])
 *   [[1:b14-3]]                 — inline citation into source #1, block b14-3
 *   [[b14-3]]                   — inline citation, source inferred at click time
 */
import { escapeHtml } from './wiki'

const CITE_SOURCE_RE = /\[\[(pdf|epub|md|docx)(\d+):([^\]]+?)\]\]/g
const CITE_INLINE_RE = /\[\[(?:(\d+):)?(b\d+-\d+)\]\]/g

export interface CiteSource {
  kind: 'pdf' | 'epub' | 'md' | 'docx'
  path: string
}

/** True if a `[[…]]` inner string is a citation token, not a wikilink target. */
export function isCitationToken(inner: string): boolean {
  const s = inner.trim()
  return /^(?:pdf|epub|md|docx)\d+:/i.test(s) || /^(?:\d+:)?b\d+-\d+$/i.test(s)
}

/** Map source number → declared path, from every `[[pdfN:path]]` in the body. */
export function parseCiteSources(body: string): Map<string, CiteSource> {
  const out = new Map<string, CiteSource>()
  CITE_SOURCE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CITE_SOURCE_RE.exec(body)) !== null) {
    const num = m[2]
    if (!out.has(num)) out.set(num, { kind: m[1] as CiteSource['kind'], path: m[3].trim() })
  }
  return out
}

/**
 * Repair a declared citation path against the KB's real file list. A declared
 * path is a claim, not a fact: the model may abbreviate to a basename, and the
 * user may have moved the file since — files are theirs to move, and a chip
 * that answers "not found" to a rename has broken something we promised not
 * to. Exact match wins; otherwise a UNIQUE basename match is accepted (two
 * same-named files would make the repair a guess, so decline and let the
 * caller fall back to block-id lookup). Null = no defensible target.
 */
export function resolveCitePath(declared: string, allFiles: string[]): string | null {
  if (allFiles.includes(declared)) return declared
  const base = declared.split('/').pop()
  if (!base) return null
  const hits = allFiles.filter((p) => p === base || p.endsWith(`/${base}`))
  return hits.length === 1 ? hits[0] : null
}

/**
 * Rewrite citation tokens to anchors (run before generic wikilink rewriting so
 * these specific tokens are consumed first). Source declarations become links
 * that open the document; inline citations become numbered chips carrying the
 * resolved source path so a click can reveal the cited block.
 *
 * `extraSources` supplies declarations from outside this text — chat messages
 * render part-by-part, so a `[[pdf1:…]]` declared in an earlier part (or an
 * earlier message) wouldn't otherwise resolve `[[1:bxx-y]]` here. Chips that
 * still resolve to no source stay clickable: the click handler falls back to
 * locating the block through the document indexes.
 */
export function renderCitationTokens(
  body: string,
  extraSources?: Map<string, CiteSource>,
): string {
  const sources = parseCiteSources(body)
  if (extraSources) {
    for (const [num, src] of extraSources) {
      if (!sources.has(num)) sources.set(num, src)
    }
  }

  CITE_SOURCE_RE.lastIndex = 0
  let out = body.replace(CITE_SOURCE_RE, (_m, _kind: string, _num: string, path: string) => {
    const p = path.trim()
    const esc = escapeHtml(p)
    return `<a href="#" class="cite-source" data-cite-path="${esc}">${esc}</a>`
  })

  CITE_INLINE_RE.lastIndex = 0
  out = out.replace(CITE_INLINE_RE, (_m, num: string | undefined, blockId: string) => {
    const src = num ? sources.get(num) : undefined
    const label = num ? `[${num}]` : '[•]'
    const title = src ? `${blockId} · ${src.path}` : `${blockId} (source located automatically on click)`
    const dataPath = src ? ` data-cite-path="${escapeHtml(src.path)}"` : ''
    return `<a href="#" class="citation" data-block="${escapeHtml(blockId)}"${dataPath} title="${escapeHtml(title)}">${label}</a>`
  })

  return out
}
