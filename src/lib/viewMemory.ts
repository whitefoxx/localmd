/**
 * Per-path reading-position memory, shared across viewer component instances
 * so positions survive tab switches (components unmount when the active tab
 * changes file kind). Module-level by design; entries are tiny and unbounded
 * growth is bounded by the number of files a user opens in a session.
 *
 * Scroll positions (editor/preview) stay in-memory only — a pixel offset is
 * fragile across reloads. PDF page and EPUB CFI are additionally persisted to
 * localStorage (see below) so reopening a book after a reload lands on the last
 * page read.
 */
export const editorScroll = new Map<string, number>()
export const previewScroll = new Map<string, number>()

/**
 * Reading positions that outlive a reload. The in-memory maps below are the hot
 * cache other code reads (e.g. chat.ts sends the current PDF page to the agent);
 * writes go through remember*() which also persists to localStorage, keyed by
 * the open KB's folder name so identical relative paths in different KBs don't
 * collide (matching how idb.ts keys recents by handle.name).
 */
/** Current page per PDF path (EmbedPDF viewer). */
export const pdfPage = new Map<string, number>()
/** Last epub.js CFI per EPUB path. */
export const epubLocation = new Map<string, string>()
/** Cached epub.js locations JSON per EPUB path (for page numbers). Session-only
 *  and not persisted — it's derivable by regenerating, just slow to compute. */
export const epubLocations = new Map<string, string>()

const LS_KEY = 'browser-md:reading-position:v1'
interface KbPositions {
  pdf: Record<string, number>
  epub: Record<string, string>
  /** epub.js locations JSON per path (page-number index; slow to regenerate). */
  epubLocs?: Record<string, string>
}
type PersistStore = Record<string, KbPositions>

let currentKb: string | null = null
let saveTimer = 0

function readStore(): PersistStore {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as PersistStore) : {}
  } catch {
    return {}
  }
}

function persist(): void {
  saveTimer = 0
  if (!currentKb) return
  const store = readStore()
  store[currentKb] = {
    pdf: Object.fromEntries(pdfPage),
    epub: Object.fromEntries(epubLocation),
    epubLocs: Object.fromEntries(epubLocations),
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store))
  } catch {
    /* quota exceeded or private mode — position memory is best-effort */
  }
}

/** Debounced: PDF page updates fire on every scroll-driven page change. */
function scheduleSave(): void {
  if (!currentKb) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(persist, 500)
}

/**
 * Called when a KB opens: swap the hot cache to that KB's persisted positions.
 * Clearing first prevents the previous KB's entries from leaking across.
 */
export function hydrateReadingPositions(kb: string | null): void {
  currentKb = kb
  pdfPage.clear()
  epubLocation.clear()
  epubLocations.clear()
  if (!kb) return
  const bucket = readStore()[kb]
  if (!bucket) return
  for (const [path, page] of Object.entries(bucket.pdf ?? {})) pdfPage.set(path, page)
  for (const [path, cfi] of Object.entries(bucket.epub ?? {})) epubLocation.set(path, cfi)
  for (const [path, json] of Object.entries(bucket.epubLocs ?? {})) epubLocations.set(path, json)
}

/** Persist a book's generated locations JSON so page numbers survive reloads. */
export function rememberEpubLocations(path: string, json: string): void {
  epubLocations.set(path, json)
  scheduleSave()
}

export function rememberPdfPage(path: string, page: number): void {
  pdfPage.set(path, page)
  scheduleSave()
}

export function rememberEpubLocation(path: string, cfi: string): void {
  epubLocation.set(path, cfi)
  scheduleSave()
}
