/**
 * Extract an EPUB into citeable blocks. Unlike the PDF extractor there are no
 * geometry heuristics: an EPUB's content is HTML, so block-level elements
 * (`<p>`, `<h1>`–`<h6>`, `<li>`, …) ARE the blocks and heading levels are
 * explicit. Each block carries an epub.js range CFI — the app navigates and
 * highlights with it. Because extraction and the viewer both run epub.js over
 * the same bytes, a CFI made here resolves identically in the viewer.
 */
import type { Book, NavItem } from 'epubjs'
import type { EpubBlock, TocNode } from './types'

/** The slice of epub.js's `Section` we use — `Section` isn't exported by epubjs. */
interface EpubSection {
  /** 0-based spine index. */
  index: number
  href: string
  /** Set once `load()` resolves; the section's parsed XHTML document. */
  document?: Document
  load(request?: unknown): unknown
  cfiFromRange(range: Range): string
  unload(): void
}

/** Block-level tags whose text becomes one citeable block. */
const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'pre', 'figcaption', 'dd', 'dt',
])
const BLOCK_SELECTOR = [...BLOCK_TAGS].join(',')

/** One spine item's metadata, gathered while extracting it. */
export interface SpineItemInfo {
  /** 1-based spine index. */
  spine: number
  href: string
  title: string
}

export interface ExtractResult {
  title: string
  author: string
  blocks: EpubBlock[]
  spineItems: SpineItemInfo[]
  toc: TocNode[]
}

/** Parse `book` (already-awaited `ready`) into blocks, spine info, and a TOC. */
export async function extractEpub(
  book: Book,
  onProgress: (section: number, total: number) => void = () => {},
): Promise<ExtractResult> {
  const sections: EpubSection[] = []
  book.spine.each((s: EpubSection) => {
    sections.push(s)
  })

  // Resolve each TOC entry's href to its spine item, so a chapter file can be
  // titled from the table of contents rather than a generic "Section N".
  const nav = await book.loaded.navigation
  const tocItems: NavItem[] = nav.toc ?? []
  const titleBySpine = new Map<number, string>()
  walkToc(tocItems, (item) => {
    if (!item.href) return
    const sec = book.spine.get(item.href) as unknown as EpubSection | undefined
    if (sec && typeof sec.index === 'number' && !titleBySpine.has(sec.index)) {
      titleBySpine.set(sec.index, (item.label ?? '').trim())
    }
  })

  const blocks: EpubBlock[] = []
  const spineItems: SpineItemInfo[] = []

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    const spine = section.index + 1
    onProgress(i + 1, sections.length)

    let firstHeading = ''
    let count = 0
    try {
      await section.load(book.load.bind(book))
      const doc = section.document
      if (doc?.body) {
        for (const el of Array.from(doc.body.querySelectorAll(BLOCK_SELECTOR))) {
          const nodes: Text[] = []
          collectOwnText(el, nodes)
          const withText = nodes.filter((n) => n.data.trim() !== '')
          if (withText.length === 0) continue
          const tag = el.tagName.toLowerCase()
          const isCode = tag === 'pre'
          const joined = nodes.map((n) => n.data).join('')
          // <pre> keeps its newlines and indentation; other blocks collapse
          // whitespace runs to single spaces.
          const text = isCode ? joined.replace(/^\n+/, '').replace(/\n+$/, '') : normalize(joined)
          if (!text) continue
          const level = /^h[1-6]$/.test(tag) ? Number(tag[1]) : 0
          let cfi: string
          try {
            // Span the block's text with a first-text-node → last-text-node
            // range — the shape epub.js makes for a user selection, which it
            // highlights reliably. selectNodeContents (an element-boundary
            // range) collapses to a 1–2 character mark in the viewer.
            const first = withText[0]
            const last = withText[withText.length - 1]
            const range = doc.createRange()
            range.setStart(first, first.data.length - first.data.replace(/^\s+/, '').length)
            range.setEnd(last, last.data.replace(/\s+$/, '').length)
            cfi = section.cfiFromRange(range)
          } catch {
            continue // un-addressable node — skip rather than emit a dead citation
          }
          if (!cfi) continue
          count += 1
          blocks.push({
            id: `b${spine}-${count}`,
            spine,
            kind: isCode ? 'code' : level > 0 ? 'heading' : 'text',
            level,
            text,
            cfi,
          })
          if (level > 0 && !firstHeading) firstHeading = text
        }
      }
    } catch (e) {
      console.warn(`[epub-index] could not read spine item ${spine}`, e)
    } finally {
      try {
        section.unload()
      } catch {
        /* ignore */
      }
    }

    spineItems.push({
      spine,
      href: section.href,
      title: titleBySpine.get(section.index) || firstHeading || `Section ${spine}`,
    })
    // Yield between spine items so indexing a big book never freezes the UI.
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 0))
  }

  const meta = book.packaging.metadata
  return {
    title: (meta.title || '').trim() || 'Untitled',
    author: (meta.creator || '').trim(),
    blocks,
    spineItems,
    toc: toTocTree(tocItems),
  }
}

/**
 * Collect an element's own text nodes — descending through inline elements
 * (`<em>`, `<a>`, …) but skipping nested block elements, which are captured as
 * their own blocks.
 */
function collectOwnText(el: Element, out: Text[]): void {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node as Text)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element
      if (BLOCK_TAGS.has(child.tagName.toLowerCase())) continue
      collectOwnText(child, out)
    }
  }
}

/** Collapse whitespace runs to single spaces and trim. */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function walkToc(items: NavItem[], fn: (item: NavItem) => void): void {
  for (const it of items) {
    fn(it)
    if (it.subitems?.length) walkToc(it.subitems, fn)
  }
}

function toTocTree(items: NavItem[]): TocNode[] {
  return items.map((it) => ({
    title: (it.label ?? '').trim(),
    href: it.href ?? '',
    children: it.subitems?.length ? toTocTree(it.subitems) : [],
  }))
}
