/**
 * Shared types for the DOCX index. Unlike the PDF/EPUB indexes there is no
 * published format to stay compatible with — nothing on anyone's disk cites
 * into this one yet.
 */

/** READ CONTRACT — see pdf/types.ts for the INDEX_VERSION/BUILDER split. */
export const INDEX_VERSION = 1
/** Algorithm revision — a rebuild suggestion, never an invalidation.
 *  Before bumping this for the FIRST time: DOCX has no id inheritance yet
 *  (pdf/inherit.ts is geometry-based; DOCX ids would need text matching).
 *  A rebuild that renumbers published block ids re-points every existing
 *  citation — build the inheritance first, then bump. */
export const BUILDER = 1

/** A citeable unit of the document — one paragraph, heading, list item, or table. */
export interface DocxBlock {
  /** Stable id, e.g. `b1-12` — the 12th block of the document. */
  id: string
  kind: 'heading' | 'text' | 'list' | 'quote' | 'code' | 'table'
  /** Heading level (1–6); list nesting depth (1-based); 0 for body text. */
  level: number
  text: string
}

export interface DocxSectionMeta {
  /** 1-based section-file order. */
  index: number
  title: string
  /** Path relative to the index directory, e.g. `sections/003-methods.md`. */
  file: string
}

export interface DocxIndexManifest {
  version: number
  /** Algorithm revision that produced this index (absent = 1, pre-split). */
  builder?: number
  /** Source DOCX path, relative to the KB root. */
  source: string
  title: string
  blockCount: number
  /** SHA-256 of the DOCX bytes — used to detect when the index is stale. */
  contentHash: string
  parsedAt: string
  sections: DocxSectionMeta[]
}
