/**
 * Shared types for the DOCX index. Unlike the PDF/EPUB indexes there is no
 * trace-app format to stay compatible with — this one is ours.
 */

/** Bump when the parser output format changes — invalidates cached indexes. */
export const INDEX_VERSION = 1

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
  /** Source DOCX path, relative to the KB root. */
  source: string
  title: string
  blockCount: number
  /** SHA-256 of the DOCX bytes — used to detect when the index is stale. */
  contentHash: string
  parsedAt: string
  sections: DocxSectionMeta[]
}
