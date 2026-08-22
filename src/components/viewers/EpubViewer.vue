<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import ePub, { EpubCFI, type Book, type Rendition, type NavItem } from 'epubjs'
import * as fs from '@/lib/fs'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { useThemeStore } from '@/stores/theme'
import { useSettingsStore } from '@/stores/settings'
import { useTtsStore } from '@/stores/tts'
import { READ_ALOUD_ENABLED } from '@/lib/tts'
import { useUiStore } from '@/stores/ui'
import { useComposerStore } from '@/stores/composer'
import { highlightSentence } from '@/composables/useTtsHighlight'
import { useMarkPopupPosition } from '@/composables/useMarkPopupPosition'
import { resolveHotkey } from '@/lib/hotkeys'
import { hasIndex, indexDocument, indexState as queryIndexState } from '@/lib/docindex'
import { loadEpubLocations } from '@/lib/docindex/epub'
import { epubLocation, epubLocations, rememberEpubLocation, rememberEpubLocations } from '@/lib/viewMemory'
import {
  HIGHLIGHT_COLORS,
  UNDERLINE_COLOR,
  loadEpubSidecar,
  saveEpubSidecar,
  sidecarPath,
  type EpubAnnotation,
} from '@/lib/annotations'
import NoteDialog from '@/components/NoteDialog.vue'
import { t } from '@/i18n'

type MarkStyle = 'highlight' | 'underline'

const files = useFilesStore()
const citations = useCitationsStore()
const theme = useThemeStore()
const settings = useSettingsStore()
const tts = useTtsStore()
const ui = useUiStore()
const composer = useComposerStore()

const host = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const indexState = ref<'none' | 'indexing' | 'indexed'>('none')
const indexDetail = ref('')
// Older-algorithm index: usable as is; the badge offers a rebuild.
const indexOutdated = ref(false)
const fontPct = ref(110)
const selCfi = ref<string | null>(null)
const popup = ref<{ x: number; y: number; cfi: string; existing: boolean } | null>(null)
const { el: popupEl, style: popupStyle } = useMarkPopupPosition(popup, host)
const progressPct = ref(0)
const chapterLabel = ref('')

// Page numbers (macOS Books-style), derived from epub.js locations.
const curPage = ref(0)
const totalPages = ref(0)
// "← page N" button, shown after a non-sequential jump (citation / TOC / search).
/** Where the reader was before a jump, as a CFI. Only the CFI: the page number
 *  shown on the button is derived from it (see `backPage`), because a jump can
 *  happen before the book HAS page numbers. */
const backTarget = ref<string | null>(null)
// The bottom page bar shows while the cursor is in the lower part of the page.
// The move events come from inside the chapter iframe (see the content hook),
// where clientY is already relative to the visible page (the iframe fills the
// host). `barHovered` keeps it up while the pointer is on the bar itself — the
// bar sits in the top document, so hovering it leaves the iframe and would
// otherwise flip `nearBottom` off, flickering the button.
const nearBottom = ref(false)
const barHovered = ref(false)
// Left/right paging buttons surface as the cursor approaches either edge — a
// mouse-only fallback for arrow paging.
const nearLeft = ref(false)
const nearRight = ref(false)
function onContentMouseMove(e: MouseEvent): void {
  // The chapter iframe spans every column (epub.js clips + translates it), so the
  // event's clientX is in full-content space. Map the pointer into the visible
  // host box via the iframe element's rect so edge detection tracks the page.
  const frame = (e.view as (Window & { frameElement?: Element | null }) | null)?.frameElement
  const hostEl = host.value
  if (!frame || !hostEl) return
  const fr = frame.getBoundingClientRect()
  const hr = hostEl.getBoundingClientRect()
  const x = fr.left + e.clientX - hr.left
  const y = fr.top + e.clientY - hr.top
  nearBottom.value = hr.height > 0 && y >= hr.height - 140
  nearLeft.value = x < 150
  nearRight.value = hr.width > 0 && x > hr.width - 150
  // Zen's peek is driven from the top document everywhere else; in here the
  // page IS an iframe, so this is the only handler that sees the cursor.
  if (ui.zen) ui.zenPeek = y < 72
}
function hideBottomBar(): void {
  nearBottom.value = false
  barHovered.value = false
  nearLeft.value = false
  nearRight.value = false
}

// In-book search.
const searchOpen = ref(false)
const searchQuery = ref('')
const searchResults = ref<{ cfi: string; excerpt: string }[]>([])
const searching = ref(false)

interface FlatTocEntry {
  title: string
  level: number
  href: string
}
const toc = ref<FlatTocEntry[]>([])

let book: Book | null = null
let rendition: Rendition | null = null
let docPath: string | null = null
let lastHighlight: string | null = null
let selText = ''
let annotations: EpubAnnotation[] = []
let ro: ResizeObserver | null = null
let resizeTimer = 0
/** Size the rendition is currently laid out at (0 until the first fit). */
let laidOut = { w: 0, h: 0 }
// Auto-clears the transient pulse flashCfi() puts on an existing mark.
let flashTimer = 0
// Set right before a programmatic jump so 'relocated' can offer a "back" button.
let jumpFrom: string | null = null

function destroy(): void {
  if (docPath && rendition) {
    try {
      const loc = rendition.currentLocation() as unknown as { start?: { cfi?: string } }
      if (loc?.start?.cfi) rememberEpubLocation(docPath, loc.start.cfi)
    } catch {
      /* not displayed yet */
    }
  }
  window.removeEventListener('keydown', onWindowKey)
  window.removeEventListener('mousedown', onWindowMousedown)
  ro?.disconnect()
  ro = null
  laidOut = { w: 0, h: 0 }
  if (resizeTimer) {
    clearTimeout(resizeTimer)
    resizeTimer = 0
  }
  if (flashTimer) {
    clearTimeout(flashTimer)
    flashTimer = 0
  }
  rendition?.destroy()
  book?.destroy()
  rendition = null
  book = null
  lastHighlight = null
  annotations = []
  jumpFrom = null
  selCfi.value = null
  popup.value = null
  curPage.value = 0
  totalPages.value = 0
  backTarget.value = null
  searchOpen.value = false
  searchQuery.value = ''
  searchResults.value = []
  searching.value = false
}

/**
 * Height held back from the page so the reader can lose a strip of viewport
 * without repaginating. A Chrome infobar (the "being controlled by automated
 * software" banner, an extension prompt, a download bar) appears while you are
 * reading and takes ~40px off the window — and a paginated book cannot absorb
 * that quietly: fewer lines fit per page, so the text reflows, and epub.js
 * lands on the page CONTAINING the line you were on, which puts that line
 * anywhere in the new page. Reading is interrupted by a jump you did not ask
 * for, over a bar you did not ask for either.
 *
 * Laying the page out shorter than its slot turns that into nothing at all:
 * the strip is bottom margin, and a viewport that shrinks by less than it just
 * spends the margin instead of reflowing. The book is one line shorter per page
 * for it, which is invisible next to the page bar that already floats there.
 */
const HEIGHT_SLACK = 48

/** The size the book should be laid out at inside `el` — its width, and its
 *  height minus the slack — or null when the pane has no size to lay out
 *  against (a hidden tab). */
function fitSize(el: HTMLElement): { w: number; h: number } | null {
  const w = el.clientWidth
  const avail = el.clientHeight
  if (!w || !avail) return null
  return { w, h: Math.max(120, avail - HEIGHT_SLACK) }
}

/**
 * Lay the book out for the space it has, but only when that space actually
 * changed shape. Width is exact — columns are as wide as the page, so a
 * narrower panel must reflow. Height is deliberately loose in both directions:
 * a shrink is absorbed while the current layout still fits, and a growth is
 * absorbed until the unused strip is wide enough to be worth reclaiming.
 */
function refit(el: HTMLElement): void {
  if (!rendition) return
  const w = el.clientWidth
  const avail = el.clientHeight
  if (!w || !avail) return // hidden tab: nothing to lay out against
  const fits = avail >= laidOut.h && avail - laidOut.h <= HEIGHT_SLACK * 2
  if (w === laidOut.w && fits) return
  const next = fitSize(el)
  if (!next) return
  laidOut = next
  rendition.resize(next.w, next.h)
}

async function load(path: string | null): Promise<void> {
  destroy()
  docPath = path
  toc.value = []
  if (!path || !host.value) return
  indexDetail.value = ''
  indexOutdated.value = false
  if (await hasIndex(path)) {
    indexState.value = 'indexed'
    void queryIndexState(path).then((s) => {
      if (path === docPath) indexOutdated.value = s === 'outdated'
    })
  } else {
    // Auto-index on first open, matching the PDF viewer.
    indexState.value = 'none'
    void runIndex()
  }
  const buf = await fs.readBinary(path)
  book = ePub(buf)
  // Lay the book out at the size it will KEEP, before its first page is drawn.
  // Rendering at 100% and letting the observer apply the slack afterwards meant
  // every open repaginated ~150ms in — after display() had already landed on a
  // CFI. A jump to an annotation therefore aimed at one pagination and was read
  // in another: epub.js re-displays the page START on resize, so the mark the
  // user clicked ended up mid-page, a page early, or a page late. Sizing up
  // front makes the observer's first callback a no-op and the jump final.
  const initial = fitSize(host.value)
  if (initial) laidOut = initial
  rendition = book.renderTo(host.value, {
    width: initial ? initial.w : '100%',
    height: initial ? initial.h : '100%',
    flow: 'paginated',
    spread: 'auto',
    allowScriptedContent: false,
  })
  registerThemes()
  rendition.themes.fontSize(`${fontPct.value}%`)
  // epub.js renders chapters in iframes; keydowns there never reach our window.
  // Register the content hook BEFORE display so the FIRST chapter's iframe also
  // gets the listener — hooks only apply to chapters rendered after they're
  // registered, so a late registration leaves the opening chapter unbound and
  // arrow-key paging dies once focus is inside it (trace-app fix).
  rendition.hooks.content.register((contents: { document: Document }) => {
    // Read-aloud highlight style — the CSS Highlight API is scoped per document,
    // so each chapter iframe needs its own copy of the rule.
    const hl = contents.document.createElement('style')
    hl.textContent = '::highlight(tts-sentence){background-color:rgba(250,204,21,.4);color:inherit}'
    contents.document.head?.appendChild(hl)
    contents.document.addEventListener('keydown', onKey)
    // Deselecting inside the chapter clears the transient quote chip, matching
    // the generic capture's behaviour for markdown. Clicking the composer in
    // the top document never collapses THIS iframe's selection, so the chip
    // survives exactly the interaction it exists for: type about the passage.
    contents.document.addEventListener('selectionchange', () => {
      const sel = contents.document.getSelection?.()
      if (!sel || sel.isCollapsed) composer.clearTransient()
    })
    // A mousedown on the page body (never on a highlight — those live in an
    // overlay in the top document) dismisses the floating popup / citation mark.
    contents.document.addEventListener('mousedown', onContentMousedown)
    // Reveal the bottom page bar when the cursor is in the lower page. The book
    // is in an iframe, so its mousemoves never reach the top document — listen
    // here. (No mouseleave: moving onto the bar leaves the iframe, and hiding on
    // that would make the bar flicker — the wrapper's mouseleave handles exit.)
    contents.document.addEventListener('mousemove', onContentMouseMove)
  })
  // Also page on left/right arrows when the iframe isn't focused (e.g. right
  // after clicking a toolbar button). Skipped while typing / with modifiers.
  window.addEventListener('keydown', onWindowKey)
  // Dismiss the popup / citation highlight when clicking anywhere in the top
  // document that isn't the popup or an existing mark.
  window.addEventListener('mousedown', onWindowMousedown)
  await rendition.display(epubLocation.get(path))
  // Focus the book so arrow paging works immediately — e.g. after switching back
  // from another file tab (this component remounts, so focus would otherwise sit
  // in the app chrome until the user clicks into the page).
  void nextTick(refocusReader)

  // The container can change width without a window resize (e.g. toggling or
  // dragging the agent panel). epub.js only auto-handles window resizes, so
  // observe the host and refit. Debounced: a re-layout is expensive, so we skip
  // every intermediate size during a drag and refit once it settles.
  const el = host.value
  if (el) {
    ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        resizeTimer = 0
        refit(el)
      }, 150)
    })
    // observe() delivers an initial callback, which is what lays the book out
    // with its slack — deliberately through the same debounce, because a resize
    // straight after display() would clear the views before epub.js has a
    // location to restore them to, leaving a blank reader.
    ro.observe(el)
  }

  // Capture text selections so the highlight buttons know what to apply to.
  rendition.on('selected', (cfiRange: string, contents: { window: Window }) => {
    selCfi.value = cfiRange
    selText = contents?.window?.getSelection?.()?.toString().trim() ?? ''
    // Pop the color bar right at the selection so highlighting no longer needs
    // a trip to the toolbar.
    if (selText) showSelectionPopup(cfiRange, contents)
    // Mirror the selection into the composer as a quote chip — the same
    // behaviour markdown files get from lib/selectionContext, which cannot see
    // in here: chapters render inside an iframe, whose selections never reach
    // the top document's `selectionchange`. The chapter title stands in for
    // the heading locator; EPUB "pages" are synthetic, so no page is claimed.
    if (selText && ui.agentOpen) {
      composer.syncLive(docPath, selText, { heading: chapterLabel.value || undefined })
    }
  })
  // epub.js computes mark positions at insert time only — re-apply after every
  // relocation so they don't drift as the user pages around. Also track reading
  // progress, current chapter, page number, and the back-jump button.
  rendition.on('relocated', (loc: { start: { percentage: number; href: string; cfi: string } }) => {
    progressPct.value = Math.round((loc.start.percentage || 0) * 100)
    const entry = toc.value.find(
      (t) => t.href.split('#')[0] === loc.start.href || t.href.split('#')[0].endsWith(loc.start.href),
    )
    if (entry) chapterLabel.value = entry.title
    updatePage(loc.start.cfi)
    // Offer a "← page N" button when we landed here via a jump (not sequential
    // paging) that moved more than one page — or before page counts are ready.
    if (jumpFrom) {
      const from = pageOf(jumpFrom)
      const far = !from || Math.abs(curPage.value - from) > 1
      backTarget.value = far ? jumpFrom : null
      jumpFrom = null
    }
    // Persist on each page turn: a hard reload may skip destroy(), so saving
    // only on unmount would lose the latest page.
    if (docPath && loc.start.cfi) rememberEpubLocation(docPath, loc.start.cfi)
    reapplyHighlights()
    // A page turn closes the popup. Don't clear the citation highlight here:
    // flashCfi()'s own display() also fires 'relocated', and doing so would
    // race with — and wipe — the highlight it just added. Clicks dismiss it.
    popup.value = null
  })

  annotations = await loadEpubSidecar(path)
  reapplyHighlights()
  await maybeJump()
  void generateLocations(path)
  const nav = await book.loaded.navigation
  toc.value = flattenNav(nav.toc ?? [])
}

/* ── theme (light/dark follows the app theme) ────────────────────────────── */

function registerThemes(): void {
  if (!rendition) return
  // Scope each theme's rules under the body class epub.js toggles in select()
  // (it adds `light`/`dark` to <body>). Unscoped `body {}` rules from both
  // themes otherwise coexist in the iframe, and the later-injected stylesheet
  // always wins regardless of the selected class — so switching back to a
  // previously-shown theme wouldn't re-apply (epub.js 0.3.93 select() only
  // appends rules + toggles a class nothing keys off).
  rendition.themes.register('light', {
    'body.light': { background: '#ffffff', color: '#1f2328' },
  })
  rendition.themes.register('dark', {
    'body.dark': { background: '#161b22', color: '#c9d1d9' },
    'body.dark a, body.dark a *': { color: '#58a6ff' },
  })
  rendition.themes.select(theme.isDark ? 'dark' : 'light')
}

watch(
  () => theme.isDark,
  (dark) => rendition?.themes.select(dark ? 'dark' : 'light'),
)

function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowRight' || e.key === 'PageDown') {
    next()
    return
  }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    prev()
    return
  }
  // Focus is inside the chapter iframe, so global shortcuts (⌘S/⌘K/…) fire in
  // the iframe's document and never reach App.vue's window listener — the reason
  // hotkeys go dead the moment you click into the page. Forward only the combos
  // that are real app hotkeys: kill the browser default (⌘S save dialog, ⌘P
  // print) and re-dispatch on window so the single registry in App.vue runs the
  // command. Non-hotkey combos (⌘C copy, ⌘A select-all, ⌘F find) are left alone.
  // Esc is not in the hotkey registry (App.vue handles it as "close the top
  // layer"), and in zen it is the way out — from in here it would go nowhere.
  if (e.key === 'Escape') {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    return
  }
  if (resolveHotkey(e, settings.state.hotkeys)) {
    e.preventDefault()
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      }),
    )
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  )
}

function onWindowKey(e: KeyboardEvent): void {
  if (!rendition) return
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
  if (isTypingTarget(e.target)) return
  if (e.key === 'ArrowRight') {
    e.preventDefault()
    next()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    prev()
  }
}

/* ───────── marks (highlights + underlines) ───────── */

function applyOne(cfi: string, color: string, style: MarkStyle = 'highlight'): void {
  const cb = (e: MouseEvent) => onMarkClick(cfi, e)
  if (style === 'underline') {
    // marks-pane draws a bordered <rect> + a hardcoded-black <line>; we override
    // both in CSS (.bm-underline) to a single red underline, so pass no styles.
    rendition?.annotations.underline(cfi, {}, cb, 'bm-underline', {})
  } else {
    rendition?.annotations.highlight(cfi, {}, cb, 'bm-highlight', {
      fill: color,
      'fill-opacity': '0.4',
    })
  }
}

function removeMark(cfi: string, style?: MarkStyle): void {
  if (!rendition) return
  try {
    rendition.annotations.remove(cfi, style === 'underline' ? 'underline' : 'highlight')
  } catch {
    /* not currently rendered */
  }
}

/**
 * Drop any stray mark elements epub.js left behind for this CFI — a DELETE-time
 * cleanup only. Never call it on the paging hot path (`reapplyHighlights`),
 * which remove+re-adds every mark on every relocation: sweeping there strips the
 * live highlight a click just focus-scrolled past before it's re-added.
 *
 * Why orphans happen: `flashCfi()` (annotations-page jump) draws its cue with
 * `annotations.highlight(cfi, …)` on the SAME CFI as the annotation. epub.js
 * 0.3.93 keys marks by `cfi + type` (both "highlight"), so the flash's add
 * clobbers the annotation's bookkeeping — `_annotations[hash]` and the
 * single-slot `view.highlights[cfi]` — stranding the original `bm-highlight`
 * `<g>` in the marks-pane overlay, tracked by nothing. Dismissing the cue then
 * `annotations.remove(cfi, 'highlight')`s that hash away entirely, so a later
 * `deleteAnnot` finds nothing to detach and the orphan lingers on screen though
 * the data is gone — until a reload rebuilds the overlay. marks-pane stamps each
 * element with `data-epubcfi`, so we can find and drop the leftovers directly.
 */
function sweepOrphanMarks(cfi: string): void {
  const root = host.value
  if (!root) return
  for (const el of root.querySelectorAll<SVGGElement>('g.bm-highlight, g.bm-underline')) {
    if (el.dataset.epubcfi === cfi) el.remove()
  }
}

function reapplyHighlights(): void {
  if (!rendition) return
  for (const a of annotations) {
    removeMark(a.cfi, a.style)
    applyOne(a.cfi, a.color, a.style ?? 'highlight')
  }
  void nextTick(decorateNotes)
}

/** Create/update a mark, then close the popup/selection. A highlight carries a
 *  chosen color; an underline is always red, so callers pass the fixed color. */
async function applyMark(cfi: string, color: string, style: MarkStyle): Promise<void> {
  if (!rendition || !docPath) return
  const existing = annotations.find((a) => a.cfi === cfi)
  if (existing) {
    removeMark(cfi, existing.style ?? 'highlight') // remove in its OLD style first
    existing.color = color
    existing.style = style
  } else {
    annotations.push({ cfi, color, text: selText, createdAt: new Date().toISOString(), style })
  }
  applyOne(cfi, color, style)
  clearSelectionRanges()
  selCfi.value = null
  popup.value = null
  await saveEpubSidecar(docPath, annotations)
}

/** Popup color swatches always highlight. */
function pickColor(color: string): void {
  if (popup.value) void applyMark(popup.value.cfi, color, 'highlight')
}

/** The "U" button always underlines in red — no color choice for underlines. */
function underlineSelection(): void {
  if (popup.value) void applyMark(popup.value.cfi, UNDERLINE_COLOR, 'underline')
}

/** Drop the in-iframe selection so the user sees the mark commit. */
function clearSelectionRanges(): void {
  ;(rendition as unknown as { getContents?: () => Array<{ window: Window }> })
    .getContents?.()
    .forEach((c) => c.window.getSelection?.()?.removeAllRanges())
}

/** Anchor the popup to a text selection. epub.js renders inside an iframe, so
 *  shift the in-iframe selection rect by the iframe's offset in the top
 *  document to get page coordinates for the teleported popup. */
function showSelectionPopup(cfiRange: string, contents: { window: Window }): void {
  const sel = contents.window.getSelection?.()
  if (!sel || sel.rangeCount === 0) return
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  const off = host.value?.querySelector('iframe')?.getBoundingClientRect()
  if (!off || rect.width === 0) return
  popup.value = {
    x: off.left + rect.left + rect.width / 2,
    y: off.top + rect.bottom,
    cfi: cfiRange,
    existing: annotations.some((a) => a.cfi === cfiRange),
  }
}

/**
 * epub.js clones the iframe click event without prototype properties, so
 * clientX/Y arrive as 0 — anchor the popup to the mark's bounding rect.
 */
function onMarkClick(cfi: string, e: MouseEvent): void {
  // A mark that carries a note edits its note on click; a plain mark shows the
  // recolour/delete popup.
  if (annotations.find((a) => a.cfi === cfi)?.note) {
    openNoteEditor(cfi)
    return
  }
  const target = (e.target ?? e.currentTarget) as Element | null
  const rect = target?.getBoundingClientRect()
  if (!rect || rect.width === 0) return
  popup.value = { x: rect.left + rect.width / 2, y: rect.bottom, cfi, existing: true }
}

async function deleteAnnot(): Promise<void> {
  if (!rendition || !popup.value || !docPath) return
  const { cfi } = popup.value
  removeMark(cfi, annotations.find((a) => a.cfi === cfi)?.style)
  // epub.js's own remove above misses orphaned marks (see sweepOrphanMarks) —
  // most commonly on annotations reached via the annotations-page flash cue. A
  // full sweep here guarantees the highlight actually leaves the screen.
  sweepOrphanMarks(cfi)
  annotations = annotations.filter((a) => a.cfi !== cfi)
  popup.value = null
  await saveEpubSidecar(docPath, annotations)
}

/* ───────── notes ───────── */
// A note is a yellow highlight carrying `note` text, marked in the margin with a
// 📝 badge. Editing/deleting go through the shared NoteDialog. Same model as PDF.

const SVG_NS = 'http://www.w3.org/2000/svg'
const noteEditor = ref<{
  cfi: string
  excerpt: string
  note: string
  color: string
  style: MarkStyle
} | null>(null)

/** Open the note dialog. The mark exists while the dialog is open (created now
 *  for a fresh selection), so colour/underline act live; only the text is saved
 *  explicitly. */
function openNoteEditor(cfi: string): void {
  popup.value = null
  const existing = annotations.find((a) => a.cfi === cfi)
  if (!existing) void applyMark(cfi, HIGHLIGHT_COLORS[0].value, 'highlight')
  noteEditor.value = {
    cfi,
    excerpt: existing?.text ?? selText,
    note: existing?.note ?? '',
    color: existing && existing.style !== 'underline' ? existing.color : HIGHLIGHT_COLORS[0].value,
    style: existing?.style ?? 'highlight',
  }
}

/** Read the note's passage aloud (the dialog's speaker button). */
function readNoteExcerpt(): void {
  if (noteEditor.value?.excerpt) tts.speak(noteEditor.value.excerpt, t('viewers.selection'))
}

/** Live: recolour / restyle the open note's mark (no save button needed). */
function noteRecolor(color: string): void {
  const cfi = noteEditor.value?.cfi
  if (!cfi) return
  void applyMark(cfi, color, 'highlight')
  noteEditor.value = { ...noteEditor.value!, color, style: 'highlight' }
  void nextTick(decorateNotes)
}
function noteUnderline(): void {
  const ed = noteEditor.value
  if (!ed) return
  void applyMark(ed.cfi, ed.color, 'underline')
  noteEditor.value = { ...ed, style: 'underline' }
  void nextTick(decorateNotes)
}

/** Save just the note text onto the (already-existing) mark. */
function saveNoteText(note: string): void {
  const cfi = noteEditor.value?.cfi
  if (!cfi || !docPath) return
  const a = annotations.find((x) => x.cfi === cfi)
  if (!a) return
  if (note) a.note = note
  else delete a.note
  void saveEpubSidecar(docPath, annotations)
  void nextTick(decorateNotes)
}

async function deleteNote(): Promise<void> {
  const ed = noteEditor.value
  if (!ed || !docPath) return
  noteEditor.value = null
  removeMark(ed.cfi, annotations.find((a) => a.cfi === ed.cfi)?.style)
  sweepOrphanMarks(ed.cfi)
  annotations = annotations.filter((a) => a.cfi !== ed.cfi)
  await saveEpubSidecar(docPath, annotations)
}

/** Stamp a quote mark straddling the start of every noted mark's first rect —
 *  clearly signalling "this passage has a note". Runs after marks (re)render
 *  (rebuilt on every page turn). Idempotent. */
function decorateNotes(): void {
  const root = host.value
  if (!root) return
  for (const g of root.querySelectorAll<SVGGElement>('g.bm-highlight, g.bm-underline')) {
    const cfi = g.dataset.epubcfi
    if (!cfi || !annotations.find((a) => a.cfi === cfi && a.note)) continue
    if (g.querySelector('.bm-note-badge')) continue
    const rect = g.querySelector('rect')
    if (!rect) continue
    const x = parseFloat(rect.getAttribute('x') ?? '0')
    const y = parseFloat(rect.getAttribute('y') ?? '0')
    const badge = document.createElementNS(SVG_NS, 'text')
    badge.setAttribute('class', 'bm-note-badge')
    badge.setAttribute('x', String(x - 2))
    badge.setAttribute('y', String(y + 6)) // straddles the top of the first line
    badge.textContent = '“' // “
    g.appendChild(badge)
  }
}

/** Open this book's annotations sidecar in the rendered AnnotationsViewer. */
function viewAnnotations(): void {
  if (docPath) void files.openFile(sidecarPath(docPath))
}

/** Remove the transient citation/search-jump highlight, if present. */
function clearCitationHighlight(): void {
  if (!lastHighlight || !rendition) return
  try {
    rendition.annotations.remove(lastHighlight, 'highlight')
  } catch {
    /* already gone */
  }
  lastHighlight = null
}

/** Dismiss both floating layers: the mark popup and the citation highlight. */
function dismissOverlays(): void {
  popup.value = null
  clearCitationHighlight()
}

/** A mousedown on the page body (text, not a mark) dismisses overlays. */
function onContentMousedown(): void {
  dismissOverlays()
}

/** A mousedown in the top document dismisses overlays, unless it lands on the
 *  popup itself or on an existing mark (which opens its own popup). */
function onWindowMousedown(e: MouseEvent): void {
  const t = e.target as Element | null
  if (t?.closest?.('.bm-popup') || t?.closest?.('.bm-highlight') || t?.closest?.('.bm-underline')) return
  dismissOverlays()
}

/* ───────── zoom (font size) ───────── */

function setFont(pct: number): void {
  fontPct.value = Math.min(220, Math.max(60, pct))
  rendition?.themes.fontSize(`${fontPct.value}%`)
}

/* ───────── page numbers (epub.js locations) ───────── */

async function generateLocations(path: string): Promise<void> {
  if (!book) return
  try {
    const cached = epubLocations.get(path)
    if (cached) {
      book.locations.load(cached)
    } else {
      await book.locations.generate(1000)
      if (!book) return
      rememberEpubLocations(path, book.locations.save())
    }
    totalPages.value = book.locations.length()
    updatePage(currentCfi())
  } catch {
    /* page numbers are best-effort */
  }
}

/** The page a CFI sits on, or 0 while the book has no location index yet.
 *  Reads `totalPages` so anything derived from it recomputes when the index
 *  finishes generating. */
function pageOf(cfi: string): number {
  if (!book || !totalPages.value) return 0
  const idx = book.locations.locationFromCfi(cfi) as unknown as number
  return (typeof idx === 'number' && idx >= 0 ? idx : 0) + 1
}

function updatePage(cfi: string | null): void {
  if (!cfi) return
  const page = pageOf(cfi)
  if (page) curPage.value = page
}

/**
 * The page the back button offers to return to — derived from the CFI, never
 * captured at jump time.
 *
 * Generating the location index walks the whole book, so it finishes seconds
 * after the reader appears; a jump that arrives with the book (clicking an
 * annotation on the annotations page opens the file AND jumps) therefore
 * happened while the current page was still 0. Snapshotting that left the
 * button reading "← 0" for the rest of the session, over a CFI that was right
 * all along — it jumped back to the correct place while naming the wrong one.
 */
const backPage = computed(() => (backTarget.value ? pageOf(backTarget.value) : 0))

function currentCfi(): string | null {
  try {
    return (rendition?.currentLocation() as unknown as { start?: { cfi?: string } })?.start?.cfi ?? null
  } catch {
    return null
  }
}

/** Record where we are before a jump, so 'relocated' can offer a back button. */
function markJumpOrigin(): void {
  jumpFrom = currentCfi()
}

function goBack(): void {
  const cfi = backTarget.value
  if (!cfi || !rendition) return
  backTarget.value = null
  jumpFrom = null // returning shouldn't arm another back button
  void rendition.display(cfi)
}

/* ───────── in-book search ───────── */

function toggleSearch(): void {
  searchOpen.value = !searchOpen.value
  if (searchOpen.value) {
    ui.epubTocOpen = false
    void nextTick(() => searchInput.value?.focus())
  } else {
    // Return focus to the book so arrow paging works again.
    refocusReader()
  }
}

async function runSearch(): Promise<void> {
  const q = searchQuery.value.trim()
  if (!book || !q) return
  searching.value = true
  searchResults.value = []
  try {
    const items = (book.spine as unknown as { spineItems: Array<{
      load: (r: unknown) => Promise<unknown>
      find: (q: string) => Array<{ cfi: string; excerpt: string }>
      unload: () => void
    }> }).spineItems
    const loader = book.load.bind(book)
    const out: { cfi: string; excerpt: string }[] = []
    for (const item of items) {
      try {
        await item.load(loader)
        for (const f of item.find(q)) out.push({ cfi: f.cfi, excerpt: (f.excerpt || '').trim() })
      } catch {
        /* skip a section that won't load */
      } finally {
        try {
          item.unload()
        } catch {
          /* already unloaded */
        }
      }
      if (out.length >= 300) break
    }
    searchResults.value = out
  } finally {
    searching.value = false
  }
}

function goToResult(cfi: string): void {
  searchOpen.value = false
  void flashCfi(cfi)
}

/* ───────── citation jump / toc / index ───────── */

/** Display a CFI and briefly highlight it (citation chips and search results). */
async function flashCfi(cfi: string): Promise<void> {
  if (!rendition) return
  markJumpOrigin()
  await rendition.display(cfi)
  // A tab switch / unmount during the async display() can destroy the rendition
  // out from under us — bail rather than deref null.
  if (!rendition) return
  // Jumps (search result / citation / TOC index) leave focus on the clicked UI;
  // hand it back to the book so arrow paging keeps working.
  void nextTick(refocusReader)
  clearCitationHighlight()
  // When we're jumping TO an annotation (from the annotations page), that CFI
  // already carries a mark. epub.js keys marks by cfi+type, so adding a second
  // 'highlight' here would clobber the annotation's bookkeeping and strand its
  // element as an orphan you can no longer delete. Pulse the existing mark
  // instead — same visual "here it is" cue, no overlay, no collision.
  if (annotations.some((a) => a.cfi === cfi)) {
    pulseMark(cfi)
    return
  }
  rendition.annotations.highlight(cfi, {}, undefined, 'epub-hl', {
    fill: 'rgb(88 166 255)',
    'fill-opacity': '0.35',
  })
  lastHighlight = cfi
}

/** Briefly emphasize an already-rendered annotation mark without touching
 *  epub.js's annotation store (see flashCfi). The class is dropped after the
 *  pulse, or naturally when a page turn re-renders the mark. */
function pulseMark(cfi: string): void {
  const root = host.value
  if (!root) return
  const els = [...root.querySelectorAll<SVGGElement>('g.bm-highlight, g.bm-underline')].filter(
    (el) => el.dataset.epubcfi === cfi,
  )
  if (!els.length) return
  els.forEach((el) => el.classList.add('bm-flash'))
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => {
    flashTimer = 0
    els.forEach((el) => el.classList.remove('bm-flash'))
  }, 1400)
}

function flattenNav(items: NavItem[], level = 1, out: FlatTocEntry[] = []): FlatTocEntry[] {
  for (const it of items) {
    out.push({ title: (it.label ?? '').trim(), level, href: it.href ?? '' })
    if (it.subitems?.length) flattenNav(it.subitems, level + 1, out)
  }
  return out
}

function goTo(href: string): void {
  if (href && rendition) {
    markJumpOrigin()
    void rendition.display(href)
  }
}

async function maybeJump(): Promise<void> {
  const pend = citations.pending
  if (!pend || pend.path !== docPath || !rendition) return
  if (pend.blockId) {
    const locs = await loadEpubLocations(pend.path)
    const cfi = locs?.blocks[pend.blockId]?.cfi
    if (cfi) await flashCfi(cfi)
  } else if (pend.annotation?.cfi) {
    // Annotations-page jump: the mark itself is already rendered; the flash
    // overlay just draws the eye to it (dismissed by any click).
    await flashCfi(pend.annotation.cfi)
  }
  citations.clear()
}

async function runIndex(rebuild = false): Promise<void> {
  if (!docPath || indexState.value === 'indexing') return
  indexState.value = 'indexing'
  try {
    const s = await indexDocument(
      docPath,
      (c, t) => {
        indexDetail.value = `${c}/${t}`
      },
      { rebuild },
    )
    indexState.value = 'indexed'
    if (!s.cached) indexOutdated.value = false
    indexDetail.value = `${s.blockCount} blocks`
  } catch (err) {
    indexState.value = 'none'
    indexDetail.value = (err as Error).message
  }
}

watch(() => files.currentPath, load)
watch(host, () => void load(files.currentPath))
watch(
  () => citations.pending,
  () => void maybeJump(),
)
onBeforeUnmount(destroy)

/** After a page turn the iframe that had keyboard focus is replaced, so focus
 *  falls back to the top document and arrow keys stop paging until you click
 *  back into the book. Re-focus the current chapter iframe once the turn settles
 *  so arrow paging keeps working. */
function refocusReader(): void {
  const iframe = host.value?.querySelector('iframe')
  iframe?.contentWindow?.focus()
}
function prev(): void {
  void Promise.resolve(rendition?.prev()).then(refocusReader)
}
function next(): void {
  void Promise.resolve(rendition?.next()).then(refocusReader)
}

/** The chapter iframes currently attached (spread mode can hold two). epub.js
 *  renders same-origin, so we can read their text, highlight inside them, and
 *  map DOM Ranges to CFIs for follow-paging. */
interface EpubContents {
  document: Document
  cfiFromRange?: (r: Range) => string
  range?: (cfi: string) => Range
}
function getContentsList(): EpubContents[] {
  return (rendition as unknown as { getContents?: () => EpubContents[] })?.getContents?.() ?? []
}

/** Chapter text from the top of the VISIBLE page to the chapter's end — reading
 *  starts where the reader is, not at the chapter start. Falls back to the whole
 *  chapter when the location CFI can't be resolved into the DOM. */
function chapterTextFromHere(): string {
  const ct = getContentsList()[0]
  const doc = ct?.document
  if (!doc?.body) return ''
  const startCfi = (rendition?.currentLocation() as unknown as { start?: { cfi?: string } })?.start
    ?.cfi
  if (startCfi && ct.range) {
    try {
      const at = ct.range(startCfi)
      if (at) {
        const r = doc.createRange()
        r.setStart(at.startContainer, at.startOffset)
        r.setEndAfter(doc.body.lastChild ?? doc.body)
        const text = r.toString().trim()
        if (text) return text
      }
    } catch {
      /* fall back to the whole chapter */
    }
  }
  return doc.body.innerText?.trim() ?? ''
}

/** Speak the current chapter from the visible page onward. Returns false when
 *  there's no text (image-only section). On natural finish, continue with the
 *  next chapter — continuous listening through the book. */
function speakCurrentChapter(): boolean {
  const text = chapterTextFromHere()
  if (!text) return false
  tts.speak(text, chapterLabel.value || 'EPUB', { onFinish: () => void advanceAndContinue() })
  return true
}
function readAloud(): void {
  speakCurrentChapter()
}

/** Speak the passage selected in the chapter (from the selection popup). */
function speakSelection(): void {
  if (selText) tts.speak(selText, t('viewers.selection'))
  popup.value = null
}

/** Turn to the next spine section (skipping text-less ones) and keep reading. */
async function advanceAndContinue(): Promise<void> {
  if (!book || !rendition) return
  const cur = (rendition.currentLocation() as unknown as { start?: { href?: string } })?.start?.href
  if (!cur) return
  const items = (book.spine as unknown as { spineItems: Array<{ href: string }> }).spineItems
  const at = items.findIndex((it) => it.href === cur || it.href.endsWith(cur))
  if (at < 0) return
  for (let i = at + 1; i < items.length; i++) {
    await rendition.display(items[i].href)
    if (speakCurrentChapter()) return
  }
}

// Highlight-follow inside the chapter iframes as each sentence is spoken, and
// page forward when the spoken sentence lies beyond the visible page. Geometry
// can't tell us that — the iframe holds the WHOLE chapter and epub.js clips and
// translates it (iframe innerWidth spans every column) — so compare the
// sentence's CFI against the visible range's end CFI instead.
watch(
  () => tts.chunkText,
  (c) => {
    for (const ct of getContentsList()) {
      const doc = ct.document
      const range = highlightSentence(doc, doc.body, c || '', { scroll: false })
      if (!range || !c || !rendition) continue
      try {
        const cfi = ct.cfiFromRange?.(range)
        const end = (rendition.currentLocation() as unknown as { end?: { cfi?: string } })?.end?.cfi
        if (cfi && end && new EpubCFI().compare(cfi, end) > 0) void rendition.display(cfi)
      } catch {
        /* highlight still shows; follow-paging is best-effort */
      }
    }
  },
)
</script>

<template>
  <div class="h-full flex flex-col relative">
    <!-- Top bar: navigation/zoom on the left, search · read-aloud ·
         view-annotations on the right, title centered. -->
    <!-- Toolbar. In zen it leaves the flow and fades out — the page takes the
         whole height, and the controls come back when the cursor nears the top
         (ui.zenPeek), which is also what draws the way out of zen. -->
    <div
      class="flex items-center gap-2 h-10 px-3 border-b border-border shrink-0 bg-bg-1 transition-opacity duration-200"
      :class="
        ui.zen
          ? [
              'absolute inset-x-0 top-0 z-30',
              ui.zenPeek ? 'opacity-100' : 'opacity-0 pointer-events-none',
            ]
          : 'relative'
      "
    >
      <!-- Left: TOC + font zoom -->
      <button
        class="btn text-xs"
        :class="{ '!text-accent': ui.epubTocOpen }"
        :disabled="!toc.length"
        :title="toc.length ? $t('viewers.epub.toc') : $t('viewers.epub.noNav')"
        @click="ui.epubTocOpen = !ui.epubTocOpen; searchOpen && (searchOpen = false)"
      >
        <span class="codicon codicon-sm codicon-list-tree" />
      </button>
      <button class="btn text-xs" :title="$t('viewers.epub.smallerText')" @click="setFont(fontPct - 10)">
        <span class="codicon codicon-sm codicon-zoom-out" />
      </button>
      <span class="text-xs text-fg-3 w-9 text-center">{{ fontPct }}%</span>
      <button class="btn text-xs" :title="$t('viewers.epub.largerText')" @click="setFont(fontPct + 10)">
        <span class="codicon codicon-sm codicon-zoom-in" />
      </button>

      <!-- Chapter title, centered. Paging is arrow-keys only (no prev/next buttons). -->
      <span
        class="pointer-events-none absolute left-1/2 -translate-x-1/2 max-w-[40%] truncate text-center text-xs text-fg-3"
      >{{ chapterLabel }}</span>

      <!-- Right: search · read-aloud · view-annotations -->
      <div class="ml-auto flex items-center gap-2">
        <button
          v-if="indexOutdated && indexState !== 'indexing'"
          class="btn text-xs"
          :title="$t('viewers.index.updateHint')"
          @click="runIndex(true)"
        >
          <span class="codicon codicon-sm codicon-refresh" />
          {{ $t('viewers.index.updateAvailable') }}
        </button>
        <button
          class="btn text-xs"
          :class="{ '!text-accent': searchOpen }"
          :title="$t('viewers.epub.searchInBook')"
          @click="toggleSearch"
        >
          <span class="codicon codicon-sm codicon-search" />
        </button>
        <button
          v-if="READ_ALOUD_ENABLED"
          class="btn text-xs"
          :title="$t('viewers.epub.readChapter')"
          @click="readAloud"
        >
          <span class="codicon codicon-sm codicon-unmute" />
        </button>
        <button
          class="btn text-xs"
          :class="{ '!text-accent': ui.zen }"
          :title="$t('viewers.zen')"
          @click="ui.toggleZen()"
        >
          <span
            class="codicon codicon-sm"
            :class="ui.zen ? 'codicon-chrome-restore' : 'codicon-chrome-maximize'"
          />
        </button>
        <button class="btn text-xs" :title="$t('viewers.epub.viewAnnotations')" @click="viewAnnotations">
          <span class="codicon codicon-sm codicon-list-selection" />
        </button>
      </div>
    </div>

    <div class="flex-1 flex min-h-0">
      <!-- Search panel -->
      <div v-if="searchOpen" class="w-72 shrink-0 border-r border-border bg-bg-1 flex flex-col min-h-0">
        <div class="p-2 border-b border-border shrink-0">
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="text"
            :placeholder="$t('viewers.epub.searchPlaceholder')"
            class="w-full text-sm bg-bg-2 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-accent"
            @keydown.enter="runSearch"
          />
        </div>
        <div class="flex-1 min-h-0 panel-scroll">
          <div v-if="searching" class="px-3 py-2 text-xs text-fg-3">{{ $t('viewers.epub.searching') }}</div>
          <div v-else-if="searchResults.length" class="px-3 py-1 text-[11px] uppercase tracking-wide text-fg-3">
            {{ searchResults.length > 1 ? $t('viewers.epub.results', { n: searchResults.length }) : $t('viewers.epub.resultsOne', { n: searchResults.length }) }}
          </div>
          <div
            v-else-if="searchQuery.trim()"
            class="px-3 py-2 text-xs text-fg-3"
          >
            {{ $t('viewers.epub.noMatches') }}
          </div>
          <button
            v-for="(r, i) in searchResults"
            :key="i"
            class="block w-full text-left px-3 py-1.5 text-xs text-fg-1 hover:bg-bg-2 border-b border-border/40"
            @click="goToResult(r.cfi)"
          >
            <span class="block line-clamp-2 leading-snug">{{ r.excerpt }}</span>
          </button>
        </div>
      </div>

      <!-- Table of contents -->
      <div v-else-if="ui.epubTocOpen && toc.length" class="w-72 shrink-0 border-r border-border bg-bg-1 panel-scroll py-2">
        <button
          v-for="(entry, i) in toc"
          :key="i"
          class="w-full text-left py-1 pr-2 text-sm text-fg-1 hover:bg-bg-2"
          :style="{ paddingLeft: `${8 + (entry.level - 1) * 14}px` }"
          @click="goTo(entry.href)"
        >
          <span class="block truncate">{{ entry.title }}</span>
        </button>
      </div>
      <!-- Book page, with an unobtrusive bottom bar that only fades in when the
           cursor nears the bottom edge — otherwise nothing distracts from reading. -->
      <div
        class="relative flex-1 min-w-0"
        :class="theme.isDark ? 'bg-bg-1' : 'bg-white'"
        @mouseleave="hideBottomBar"
      >
        <div class="h-full w-full" ref="host" />
        <!-- Edge paging buttons — fade in as the cursor nears each side. -->
        <button
          class="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full border border-border bg-bg-1/80 shadow flex items-center justify-center text-fg-2 hover:text-fg-1 transition-opacity duration-200"
          :class="nearLeft ? 'opacity-90' : 'opacity-0 pointer-events-none'"
          :title="$t('viewers.epub.prevPage')"
          @mousedown.prevent
          @click="prev"
        >
          <span class="codicon codicon-chevron-left" />
        </button>
        <button
          class="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full border border-border bg-bg-1/80 shadow flex items-center justify-center text-fg-2 hover:text-fg-1 transition-opacity duration-200"
          :class="nearRight ? 'opacity-90' : 'opacity-0 pointer-events-none'"
          :title="$t('viewers.epub.nextPage')"
          @mousedown.prevent
          @click="next"
        >
          <span class="codicon codicon-chevron-right" />
        </button>
        <div
          class="absolute inset-x-0 bottom-0 flex items-center px-3 h-6 transition-opacity duration-200"
          :class="nearBottom || barHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'"
          @mouseenter="barHovered = true"
          @mouseleave="barHovered = false"
        >
          <button
            v-if="backTarget"
            class="flex items-center gap-1 text-[11px] text-accent hover:opacity-80"
            :title="
              backPage ? $t('viewers.epub.backToPage', { page: backPage }) : $t('viewers.epub.backToOrigin')
            "
            @click="goBack"
          >
            <!-- No number until the book has page numbers: the jump still works,
                 and a made-up page is worse than none. -->
            <span class="codicon codicon-discard !text-[12px]" /> {{ backPage || '' }}
          </button>
          <span
            class="absolute left-1/2 -translate-x-1/2 text-[11px] text-fg-3 whitespace-nowrap"
          >
            <template v-if="totalPages">{{ curPage }} / {{ totalPages }}</template>
            <template v-else>{{ progressPct }}%</template>
          </span>
        </div>
      </div>
    </div>

    <!-- Mark popup: color swatches + highlight/underline toggle + delete -->
    <Teleport to="body">
      <div
        v-if="popup"
        ref="popupEl"
        class="bm-popup fixed z-50 flex items-center gap-1.5 px-2 py-1.5 rounded border border-border bg-bg-1 shadow-lg"
        :style="popupStyle"
      >
        <button
          v-for="c in HIGHLIGHT_COLORS"
          :key="c.value"
          class="w-5 h-5 rounded-full border border-border transition-transform hover:scale-110"
          :style="{ backgroundColor: c.value }"
          :title="$t('viewers.epub.highlightColor', { name: c.name })"
          @click="pickColor(c.value)"
        />
        <span class="w-px h-4 bg-border mx-0.5" />
        <button
          v-if="READ_ALOUD_ENABLED"
          class="w-6 h-5 rounded flex items-center justify-center text-fg-3 hover:text-fg-1"
          :title="$t('viewers.epub.readSelection')"
          @click="speakSelection"
        >
          <span class="codicon codicon-sm codicon-unmute" />
        </button>
        <button
          class="w-6 h-5 rounded flex items-center justify-center leading-none text-fg-3 hover:text-fg-1"
          :title="$t('viewers.epub.underlineRed')"
          @click="underlineSelection"
        >
          <span class="text-xs font-semibold underline underline-offset-2" :style="{ color: UNDERLINE_COLOR }">U</span>
        </button>
        <button
          class="w-6 h-5 rounded flex items-center justify-center text-fg-3 hover:text-fg-1"
          :title="$t('viewers.epub.note')"
          @click="openNoteEditor(popup.cfi)"
        >
          <span class="codicon codicon-sm codicon-note" />
        </button>
        <button
          v-if="popup.existing"
          class="text-fg-3 hover:text-removed ml-0.5"
          :title="$t('viewers.epub.deleteMark')"
          @click="deleteAnnot"
        >
          <span class="codicon codicon-sm codicon-trash" />
        </button>
      </div>
    </Teleport>

    <NoteDialog
      :open="!!noteEditor"
      :excerpt="noteEditor?.excerpt ?? ''"
      :initial-note="noteEditor?.note ?? ''"
      :colors="HIGHLIGHT_COLORS"
      :underline-color="UNDERLINE_COLOR"
      :color="noteEditor?.color ?? HIGHLIGHT_COLORS[0].value"
      :mark-style="noteEditor?.style ?? 'highlight'"
      @pick-color="noteRecolor"
      @set-underline="noteUnderline"
      @read="readNoteExcerpt"
      @save-text="saveNoteText"
      @delete="deleteNote"
      @close="noteEditor = null"
    />
  </div>
</template>

<!-- Global (not scoped): epub.js mark overlays live in the top document, outside
     this component's scoped styles. marks-pane renders an underline as a bordered
     <rect> plus a hardcoded-black <line>; collapse that to one red underline. -->
<style>
.bm-underline rect {
  fill: none;
  stroke: none;
}
.bm-underline line {
  stroke: #ff3b30;
  stroke-width: 2px;
  stroke-opacity: 1;
}
/* Quote mark stamped at the start of a noted mark — bold red (matching the PDF
   viewer's marker) so it's obvious. Non-interactive so the click falls through
   to the edit handler. */
.bm-note-badge {
  font-size: 20px;
  font-weight: 700;
  fill: #dc2626;
  /* The mark's <g> carries fill-opacity 0.4 (the highlight tint); override it so
     the quote reads as a solid deep red, matching the PDF viewer's marker. */
  fill-opacity: 1;
  pointer-events: none;
  user-select: none;
}
/* Transient "here it is" pulse for a jumped-to annotation (see flashCfi/pulseMark).
   Highlights deepen their fill; underlines thicken their stroke. */
.bm-flash rect {
  animation: bm-flash-hl 0.45s ease-in-out 3;
}
.bm-flash line {
  animation: bm-flash-ul 0.45s ease-in-out 3;
}
@keyframes bm-flash-hl {
  0%,
  100% {
    fill-opacity: 0.4;
  }
  50% {
    fill-opacity: 0.9;
  }
}
@keyframes bm-flash-ul {
  0%,
  100% {
    stroke-width: 2px;
  }
  50% {
    stroke-width: 5px;
  }
}
</style>
