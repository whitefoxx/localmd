/**
 * Shared types for the PDF index — a parsed, location-aware representation of
 * a PDF that an AI agent can browse like a small codebase, and that the app
 * can use to map a cited block back to coordinates in the PDF.
 * The on-disk layout is the format existing KBs already hold (inherited from
 * trace-app, INDEX_VERSION 11) — user notes cite block ids from that era, so
 * the format is kept stable for them, not for another app.
 */

/**
 * Two revision numbers with two different jobs — never conflate them:
 *
 * - INDEX_VERSION is the READ CONTRACT. Bump it ONLY when existing readers
 *   could no longer make sense of the files (directory layout, meaning of a
 *   field). A bump strands every index on disk, so it needs a migration
 *   story — it is expected to never move again.
 * - BUILDER is the ALGORITHM revision. Bump it whenever extraction or
 *   sectioning improves enough that a rebuild is worth *suggesting*. It
 *   never invalidates anything: an older-builder index stays fully usable
 *   and the app only offers a rebuild — the user chooses. A manifest
 *   without a `builder` field predates the split and reads as builder 1.
 *
 * Rule of thumb: changed what the files SAY → bump BUILDER; changed how a
 * reader must PARSE them → that is an INDEX_VERSION conversation.
 */
export const INDEX_VERSION = 11
export const BUILDER = 1

/** A rectangle on a page, normalized to 0..1 with a top-left origin. */
export interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

/** A citeable unit of the document — one paragraph or one heading. */
export interface PdfBlock {
  /** Stable id, e.g. `b14-3` — the 3rd block on (1-based) page 14. */
  id: string
  /** 1-based page number. */
  page: number
  kind: 'heading' | 'text'
  /** Heading level (1 = major, 2 = minor); 0 for body text. */
  level: number
  text: string
  /** One rect per visual line the block occupies. */
  rects: NormRect[]
}

/** A node in the PDF's embedded outline (table of contents). */
export interface OutlineNode {
  title: string
  /** 1-based nesting depth. */
  level: number
  /** 1-based page the entry points at; 0 if it could not be resolved. */
  page: number
  children: OutlineNode[]
}

/** One section file — a contiguous run of pages. */
export interface SectionMeta {
  /** 1-based order. */
  index: number
  title: string
  level: number
  startPage: number
  endPage: number
  /** Path relative to the index directory, e.g. `sections/003-methods.md`. */
  file: string
}

export interface PdfIndexManifest {
  version: number
  /** Algorithm revision that produced this index (absent = 1, pre-split). */
  builder?: number
  /** Source PDF path, relative to the KB root. */
  source: string
  title: string
  pageCount: number
  /** Number of extracted text/heading blocks (0 ⇒ probably a scanned PDF). */
  blockCount: number
  /** SHA-256 of the PDF bytes — used to detect when the index is stale. */
  contentHash: string
  parsedAt: string
  /** How the section list was derived. */
  structure: 'outline' | 'headings' | 'pages'
  sections: SectionMeta[]
}

/** `locations.json` — maps every block id to where it sits in the PDF. */
export interface PdfLocations {
  version: number
  /** PDF-point size of each page, in page order — for un-normalizing rects. */
  pageSizes: { w: number; h: number }[]
  blocks: Record<string, { page: number; rects: NormRect[] }>
}
