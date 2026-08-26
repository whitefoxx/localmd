/**
 * Shared types for the EPUB index. The on-disk layout is the format existing
 * KBs already hold (INDEX_VERSION 3) and is kept stable for the notes that
 * cite into it.
 */

/** READ CONTRACT — see pdf/types.ts for the INDEX_VERSION/BUILDER split. */
export const INDEX_VERSION = 3
/** Algorithm revision — a rebuild suggestion, never an invalidation.
 *  Before bumping this for the FIRST time: EPUB has no id inheritance yet
 *  (pdf/inherit.ts is geometry-based; EPUB ids would need spine + text
 *  matching). A rebuild that renumbers published block ids re-points every
 *  existing citation — build the inheritance first, then bump. */
export const BUILDER = 1

/** A citeable unit of the document — one paragraph, heading, or code block. */
export interface EpubBlock {
  /** Stable id, e.g. `b3-12` — the 12th block in (1-based) spine item 3. */
  id: string
  /** 1-based spine item index. */
  spine: number
  kind: 'heading' | 'text' | 'code'
  /** Heading level (1–6, from `<h1>`–`<h6>`); 0 for body text. */
  level: number
  text: string
  /**
   * epub.js range CFI locating this block. The viewer navigates to it with
   * `rendition.display()` and highlights it with `rendition.annotations`.
   */
  cfi: string
}

/** One section file — a spine item, or a chunk of a large one. */
export interface SectionMeta {
  /** 1-based section-file order. */
  index: number
  /** 1-based index of the spine item this section's content came from. */
  spine: number
  title: string
  /** Spine item href — used to link the table of contents to section files. */
  href: string
  /** Path relative to the index directory, e.g. `sections/003-methods.md`. */
  file: string
}

export interface EpubIndexManifest {
  version: number
  /** Algorithm revision that produced this index (absent = 1, pre-split). */
  builder?: number
  /** Source EPUB path, relative to the KB root. */
  source: string
  title: string
  author: string
  /** Number of spine items (chapters/documents). */
  spineCount: number
  /** Number of extracted text/heading blocks. */
  blockCount: number
  /** SHA-256 of the EPUB bytes — used to detect when the index is stale. */
  contentHash: string
  parsedAt: string
  sections: SectionMeta[]
}

/** `locations.json` — maps every block id to where it sits in the EPUB. */
export interface EpubLocations {
  version: number
  blocks: Record<string, { spine: number; cfi: string }>
}

/** A node of the EPUB's table of contents. */
export interface TocNode {
  title: string
  /** Spine item href the entry points at (may include a `#fragment`). */
  href: string
  children: TocNode[]
}
