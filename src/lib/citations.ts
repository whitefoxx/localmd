/**
 * Render-time handling of Q&A citation tokens inside wiki pages and chat
 * answers. Token forms:
 *   [[pdf1:raw/papers/x.pdf]]   — declares source #1 (also [[epub2:…]], [[md3:…]], [[docx4:…]])
 *   [[1:b14-3]]                 — inline citation into source #1, block b14-3
 *   [[b14-3]]                   — inline citation, source inferred at click time
 */
import { escapeHtml, parseWikilinks, splitFrontmatter } from './wiki'

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
 * The anchor for one citation token, or null if `inner` is not one.
 *
 * This is a renderer for a single token rather than a pass over the whole
 * text, because a pass cannot tell prose from code. Citations are markup the
 * agent also *writes about* — quoting `[[1:b14-3]]` in backticks to discuss a
 * chip used to produce a chunk of raw anchor HTML inside the code span. The
 * markdown tokenizer already knows where code begins and ends, so citations
 * are tokenized alongside wikilinks (see lib/markdown) and inherit that
 * knowledge instead of re-deriving it.
 *
 * Source declarations become links that open the document; inline citations
 * become numbered chips carrying the resolved source path so a click can
 * reveal the cited block. A chip that resolves to no source stays clickable:
 * the click handler falls back to locating the block through the indexes.
 */
export function citationHtml(inner: string, sources: Map<string, CiteSource>): string | null {
  const s = inner.trim()

  CITE_SOURCE_RE.lastIndex = 0
  const decl = CITE_SOURCE_RE.exec(`[[${s}]]`)
  if (decl) {
    const esc = escapeHtml(decl[3].trim())
    return `<a href="#" class="cite-source" data-cite-path="${esc}">${esc}</a>`
  }

  CITE_INLINE_RE.lastIndex = 0
  const cite = CITE_INLINE_RE.exec(`[[${s}]]`)
  if (cite) {
    const num = cite[1] as string | undefined
    const blockId = cite[2]
    const src = num ? sources.get(num) : undefined
    const label = num ? `[${num}]` : '[•]'
    const title = src
      ? `${blockId} · ${src.path}`
      : `${blockId} (source located automatically on click)`
    const dataPath = src ? ` data-cite-path="${escapeHtml(src.path)}"` : ''
    return `<a href="#" class="citation" data-block="${escapeHtml(blockId)}"${dataPath} title="${escapeHtml(title)}">${label}</a>`
  }

  return null
}

/** One inline citation: the source it names (null for the bare `[[b14-3]]`
 *  form, whose source is inferred at click time) and the block id. */
export interface InlineCite {
  /** The `N` of `[[N:b14-3]]`, or null for the bare form. */
  num: string | null
  blockId: string
}

/** Every inline citation in `body`, in document order. */
export function parseCiteInline(body: string): InlineCite[] {
  const out: InlineCite[] = []
  CITE_INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CITE_INLINE_RE.exec(body)) !== null) {
    out.push({ num: m[1] ?? null, blockId: m[2] })
  }
  return out
}

/** Block ids the KB has already published against one document. */
export interface PublishedCitations {
  /** Distinct block ids, sorted. */
  ids: string[]
  /** Paths of the pages carrying them, sorted. */
  pages: string[]
}

/**
 * The block ids someone's notes already point at inside `source` — the names
 * an index rebuild is not free to reassign.
 *
 * A block id is a NAME, not a position (see docindex/pdf/inherit): once a page
 * says `[[1:b14-3]]`, that ordinal belongs to the passage it was written
 * against. This is the count of what is at stake before a build that cannot
 * carry the old ids forward, so the question can be put to the user in numbers
 * rather than in the abstract.
 *
 * Bare `[[b14-3]]` citations name no source and are resolved at click time by
 * searching the indexes. They are counted here only when the page declares
 * exactly one source and it is this document — anything looser would attribute
 * another document's ids to this one, and the whole point is a number the user
 * can trust.
 */
export function publishedCitations(
  pages: Iterable<readonly [string, string]>,
  files: readonly string[],
  source: string,
): PublishedCitations {
  const ids = new Set<string>()
  const citing = new Set<string>()
  for (const [path, content] of pages) {
    const { body } = splitFrontmatter(content)
    const declared = parseCiteSources(body)
    if (declared.size === 0) continue
    const ours = new Set<string>()
    for (const [num, s] of declared) {
      if (resolveCitePath(s.path, files as string[]) === source) ours.add(num)
    }
    if (ours.size === 0) continue
    const bareIsOurs = declared.size === 1
    for (const { num, blockId } of parseCiteInline(body)) {
      if (num === null ? !bareIsOurs : !ours.has(num)) continue
      ids.add(blockId)
      citing.add(path)
    }
  }
  return { ids: [...ids].sort(), pages: [...citing].sort() }
}

/** Which document a source-less block id belongs to. */
export type BlockSourceChoice =
  | { kind: 'one'; path: string }
  | { kind: 'ambiguous'; paths: string[] }
  | { kind: 'none' }

/**
 * Decide, at click time, which document a chip carrying no declared source
 * meant — or refuse to.
 *
 * A block id is a name inside ONE document (see docindex/pdf/types): every
 * book has a `b10-62`, so a set of candidates with more than one member is
 * not a ranking to take the head of, it is a question. Taking the head is
 * what sent a note about Han-dynasty salt policy into a book about
 * undergraduate mathematics — both indexes hold a `b10-62`, and the winner
 * was whichever index the section cache happened to load first.
 *
 * `exists` is asked first because an index outlives its source: rename or
 * delete the file and the index directory stays behind, still answering to
 * the id. A candidate nobody can open is not a candidate.
 */
export function chooseBlockSource(
  candidates: readonly string[],
  opts: { current?: string | null; exists: (path: string) => boolean },
): BlockSourceChoice {
  const live = candidates.filter((p) => opts.exists(p))
  if (live.length === 0) return { kind: 'none' }
  // Reading a book and clicking a citation into it means this one.
  if (opts.current && live.includes(opts.current)) return { kind: 'one', path: opts.current }
  if (live.length === 1) return { kind: 'one', path: live[0] }
  return { kind: 'ambiguous', paths: [...live].sort() }
}

/**
 * The `[[pdfN:path]]` declarations a page inherits from the source pages it
 * links to.
 *
 * Written for what knowledge bases actually grow into. A page about a topic
 * links to `[[wiki/sources/中国历代政治得失]]` — the page ABOUT the book, which
 * carries the declaration — and then cites `[[1:b10-62]]`. Read strictly, that
 * number names nothing, because declarations are per page; and a chip with no
 * source falls back to guessing which document it meant. The convention is not
 * wrong, it is just one hop away, so follow the hop.
 *
 * Two rules keep the inference honest:
 * - ONE hop. A source page is a page about a document, not a router; following
 *   links of links would reach declarations the author never had in view.
 * - A number two linked pages disagree about is dropped, not resolved.
 *   Numbering is per page, so both of them calling their own book "1" is
 *   normal, and picking either would be the guess this exists to remove.
 *
 * The page's own declarations always win; they are not passed in, so callers
 * merge this UNDER them (see markdown's `citeSources`).
 */
export function inheritedCiteSources(
  body: string,
  resolveLink: (target: string) => string | null,
  pageBody: (path: string) => string | null,
): Map<string, CiteSource> {
  const linked: string[] = []
  for (const { target } of parseWikilinks(body)) {
    if (isCitationToken(target)) continue
    const path = resolveLink(target)
    if (path) linked.push(path)
  }
  return inheritedFromPages(linked, pageBody)
}

/** The same rule over links already resolved to KB paths — what lint holds
 *  (`LintPage.outgoing`) and what `inheritedCiteSources` reduces to. */
export function inheritedFromPages(
  linked: Iterable<string>,
  pageBody: (path: string) => string | null,
): Map<string, CiteSource> {
  const out = new Map<string, CiteSource>()
  const conflicted = new Set<string>()
  const seen = new Set<string>()
  for (const path of linked) {
    if (seen.has(path)) continue
    seen.add(path)
    const text = pageBody(path)
    if (text === null) continue
    for (const [num, src] of parseCiteSources(splitFrontmatter(text).body)) {
      if (conflicted.has(num)) continue
      const held = out.get(num)
      if (!held) {
        out.set(num, src)
      } else if (held.path !== src.path) {
        out.delete(num)
        conflicted.add(num)
      }
    }
  }
  return out
}
