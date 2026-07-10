/**
 * Split a markdown source into ordered, citable blocks. The block ids produced
 * here are the single source of truth shared by the indexer (which writes
 * `[[id]]`-tagged section files for the agent) and the source preview (which
 * maps a citation back to the nth rendered element) — so the two always agree.
 *
 * Ids use the same `b<section>-<n>` shape as the PDF/EPUB indexes.
 * Ported from trace-app.
 */
import { marked, type Token } from 'marked'

export type MdBlockKind = 'heading' | 'code' | 'list' | 'quote' | 'table' | 'paragraph' | 'other'

export interface EnumBlock {
  id: string
  section: number
  token: Token
}

export interface MdBlock {
  id: string
  kind: MdBlockKind
  /** Heading depth (1–6), else 0. */
  level: number
  /** Readable text for the index — markdown the agent reads. */
  text: string
}

export interface MdSection {
  index: number
  title: string
  blocks: MdBlock[]
}

/** A heading at this depth or shallower starts a new section. */
const SECTION_DEPTH = 2

/**
 * Walk the document's top-level block tokens (skipping blank-line "space"
 * tokens) and assign each a `b<section>-<n>` id. Sections break at H1/H2.
 */
export function enumerateMarkdownBlocks(content: string): EnumBlock[] {
  const tokens = marked.lexer(content)
  const out: EnumBlock[] = []
  let section = 0
  let n = 0
  for (const t of tokens) {
    if (t.type === 'space') continue
    const isSectionHead = t.type === 'heading' && (t as { depth: number }).depth <= SECTION_DEPTH
    if (section === 0) {
      section = 1
      n = 0
    } else if (isSectionHead && n > 0) {
      section += 1
      n = 0
    }
    n += 1
    out.push({ id: `b${section}-${n}`, section, token: t })
  }
  return out
}

/** Group the enumerated blocks into sections (one per H1/H2 run). */
export function parseMarkdownDoc(content: string, fallbackTitle: string): MdSection[] {
  const blocks = enumerateMarkdownBlocks(content)
  const sections: MdSection[] = []
  for (const { id, section, token } of blocks) {
    let sec = sections.find((s) => s.index === section)
    if (!sec) {
      sec = { index: section, title: '', blocks: [] }
      sections.push(sec)
    }
    const b = toBlock(id, token)
    if (!sec.title && b.kind === 'heading') sec.title = b.text
    sec.blocks.push(b)
  }
  for (const s of sections) {
    if (!s.title) s.title = s.index === 1 ? fallbackTitle : `Part ${s.index}`
  }
  return sections
}

function toBlock(id: string, token: Token): MdBlock {
  const t = token as Token & { depth?: number; text?: string; raw?: string }
  const kind = kindOf(token.type)
  const level = kind === 'heading' ? (t.depth ?? 1) : 0
  return { id, kind, level, text: blockText(kind, t) }
}

function kindOf(type: string): MdBlockKind {
  switch (type) {
    case 'heading':
      return 'heading'
    case 'code':
      return 'code'
    case 'list':
      return 'list'
    case 'blockquote':
      return 'quote'
    case 'table':
      return 'table'
    case 'paragraph':
      return 'paragraph'
    default:
      return 'other'
  }
}

function blockText(kind: MdBlockKind, t: { text?: string; raw?: string }): string {
  // Headings/code carry clean `.text`; everything else keeps its raw markdown
  // (lists, tables, blockquotes) so the agent reads it faithfully.
  if (kind === 'heading' || kind === 'code') return (t.text ?? '').trim()
  return (t.raw ?? t.text ?? '').trim()
}
