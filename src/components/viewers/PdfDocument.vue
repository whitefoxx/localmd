<script setup lang="ts">
/**
 * One EmbedPDF viewer instance per open PDF. The engine provides rendering,
 * selection, zoom, search,
 * outline sidebar and the highlight-annotation UI natively; this component
 * adds: sidecar annotation persistence, AI-index status, citation reveal,
 * and per-path page memory. `path` is fixed for the instance's lifetime.
 */
import {
  PDFViewer,
  registerIcon,
  ZoomMode,
  type PluginRegistry,
  type UISchema,
  type ToolbarItem,
  type GroupItem,
  type SelectionMenuItem,
  type SelectionMenuSchema,
  type ZoomLevel,
} from '@embedpdf/vue-pdf-viewer'
// Local wasm — absolute so the engine's blob: workers can resolve it.
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'
import {
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfHighlightAnnoObject,
  type PdfFreeTextAnnoObject,
} from '@embedpdf/models'
import NoteDialog from '@/components/NoteDialog.vue'
import SourceNoteBadge from '@/components/viewers/SourceNoteBadge.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as fs from '@/lib/fs'
import { hasIndex, indexDocument, indexState as queryIndexState } from '@/lib/docindex'
import { loadPdfLocations, loadPdfSpeechSegments, pdfTextSource } from '@/lib/docindex/pdf'
// The list, not the engine: tesseract itself stays behind ocr.ts's own
// dynamic import and is fetched at the click.
import { OCR_LANGS } from '@/lib/docindex/pdf/ocr'
import { useCitationsStore, type AnnotationTarget, type PendingJump } from '@/stores/citations'
import { sidecarRevision, HIGHLIGHT_COLORS, UNDERLINE_COLOR } from '@/lib/annotations'
import { useThemeStore } from '@/stores/theme'
import { pdfPage as pageMemory, rememberPdfPage } from '@/lib/viewMemory'
import { useTtsStore } from '@/stores/tts'
import { READ_ALOUD_ENABLED } from '@/lib/tts'
import { useFilesStore } from '@/stores/files'
import { useUiStore } from '@/stores/ui'
import { useComposerStore } from '@/stores/composer'
import { baseName } from '@/lib/wiki'
import { getLocale, t } from '@/i18n'
import { registerPdfKeyScope, takeoverPdfShortcuts, type ShortcutCommandsApi } from '@/lib/pdfKeys'

const props = defineProps<{ path: string }>()

const citations = useCitationsStore()
const theme = useThemeStore()
const uiStore = useUiStore()
const composer = useComposerStore()
const tts = useTtsStore()
const files = useFilesStore()

const absoluteWasmUrl = new URL(pdfiumWasmUrl, window.location.href).href
const blobUrl = ref<string | null>(null)
/** The component's root — polled for a rendered canvas, which is the only
 *  trustworthy sign the viewer has actually laid out (see scrollToPoint). */
const host = ref<HTMLElement | null>(null)
/** Shown while we scroll to the remembered page, to mask the page-1 flash. */
const restoring = ref(false)
/** False until the engine reports the document open (see markDocReady). Until
 *  then its own centred spinner is masked and replaced by one corner hint — two
 *  loading effects stacked on top of each other read as a glitch, and the
 *  reader only ever needs to be told one thing at a time. */
const docReady = ref(false)
/** Loading has run long enough to be worth explaining rather than just spun at. */
const loadingSlow = ref(false)
let disposed = false

const config = computed(() => ({
  wasmUrl: absoluteWasmUrl,
  src: blobUrl.value ?? '',
  theme: { preference: (theme.isDark ? 'dark' : 'light') as 'dark' | 'light' },
  // EmbedPDF calls out to the public internet on every open unless told not to,
  // and both requests land *before* the first page paints — they are what the
  // "Initializing plugins…" spinner is actually waiting on:
  //   fonts.googleapis.com  Open Sans for its own chrome (~1–3s, and it hangs
  //                         where Google is unreachable)
  //   cdn.jsdelivr.net      a rubber-stamp library, manifest then a 66 KB PDF
  //                         (~2s, two sequential round trips)
  // Neither belongs in a local-first reader: they leak every PDF open to two
  // third parties, break the viewer offline, and buy us nothing — stamps live
  // under the `insert` category we already disable. The UI falls back to the
  // system font stack. `fontFallback` is deliberately left alone: it is lazy
  // (only a document with no embedded font triggers it) and dropping it would
  // render CJK scans as blank boxes.
  fonts: { ui: null, signature: null },
  stamp: { manifests: [] },
  // EmbedPDF opens at "automatic", which is fit-width capped at 100% — and a
  // PDF point is not a screen pixel, so on any pane wider than the page (a
  // maximised window, the agent panel closed) that cap leaves a small page
  // marooned in white space, which reads as the reader being broken rather
  // than as a zoom setting. Fit the width and let the toolbar do the rest.
  zoom: { defaultZoomLevel: ZoomMode.FitWidth },
  // Trim EmbedPDF's default toolbar down to the essentials. Categories are
  // hierarchical and disabling one hides both its toolbar items AND its
  // text-selection-popup items:
  //   document-menu           → the ≡ button
  //   pan / pointer           → the hand & cursor tool buttons
  //   mode                    → the whole View/Annotate/Shapes/Insert/Form/Redact
  //                             tab row (annotation itself stays ON — highlight/
  //                             underline/comment still work from the selection popup)
  //   annotation-shape/insert/form/redaction → those tools and their mode tabs
  // NOTE: we do NOT disable `annotation-link` — that also strips link annotations
  // of their interactive layer, so clicking a PDF's table-of-contents links stops
  // navigating. The "add link" affordance is gone anyway because we rebuild the
  // selection popups from scratch (see customizeViewerUi).
  disabledCategories: [
    'document-menu',
    'pan',
    'pointer',
    'mode',
    'annotation-shape',
    'insert',
    'form',
    'redaction',
    // EmbedPDF's comment feature is replaced by our unified notes.
    'annotation-comment',
  ],
}))

/* ── EmbedPDF plugin capability slices ──────────────────────────────────── */

interface TransferItem {
  annotation: { id: string; type?: number; [k: string]: unknown }
  ctx?: unknown
}
type AnnotationEvent =
  | { type: 'create' | 'update' | 'delete'; annotation: TransferItem['annotation']; ctx?: unknown }
  | { type: 'loaded'; total: number }
/** Fields we read off a selected annotation object. */
interface AnnoObject {
  id?: string
  type?: number
  pageIndex?: number
  target?: unknown
  contents?: string
  strokeColor?: string
  rect?: { origin: { x: number; y: number }; size: { width: number; height: number } }
  segmentRects?: Array<{ origin: { x: number; y: number }; size: { width: number; height: number } }>
  custom?: { text?: string; bmNoteFor?: string }
}
interface AnnotationApi {
  importAnnotations: (items: TransferItem[]) => void
  onAnnotationEvent: (cb: (e: AnnotationEvent) => void) => () => void
  createAnnotation: (
    pageIndex: number,
    annotation: PdfHighlightAnnoObject | PdfFreeTextAnnoObject,
  ) => void
  deleteAnnotation: (pageIndex: number, annotationId: string) => void
  /** Disarm the active annotation tool (null → back to no tool). */
  setActiveTool: (toolId: string | null) => void
  /** Clear the current annotation selection (hides the floating edit popup). */
  deselectAnnotation: () => void
  /** Patch a tool's default appearance, e.g. the highlight/underline colour. */
  setToolDefaults: (toolId: string, patch: Record<string, unknown>) => void
  /** Fires on any annotation state change, incl. selection. */
  onStateChange: (cb: () => void) => () => void
  /** The currently selected annotation, or null. */
  getSelectedAnnotation: () => { object?: AnnoObject } | null
  /** Patch an existing annotation (e.g. recolour a highlight, set a note). */
  updateAnnotation: (pageIndex: number, annotationId: string, patch: Record<string, unknown>) => void
  /** Follow a link annotation's target (jumps to its destination page). */
  navigateTarget: (target: unknown) => void
}
interface ScrollApi {
  scrollToPage: (opts: {
    pageNumber: number
    pageCoordinates?: { x: number; y: number }
    behavior?: 'instant' | 'smooth' | 'auto'
    alignX?: number
    alignY?: number
  }) => void
  getCurrentPage: () => number
  onPageChange: (cb: (e: unknown) => void) => () => void
}

/** PDF "Link" annotations (subtype 2) belong to the document, not the user. */
const LINK_ANNOTATION_TYPE = 2

const sidecarPath = `${props.path}.annotations.json`
const userAnnotations = new Map<string, TransferItem>()
let initialLoadDone = false
let saveTimer: number | null = null
let unsubscribe: (() => void) | null = null
let pageUnsub: (() => void) | null = null
let viewerRegistry: PluginRegistry | null = null
let annotationApi: AnnotationApi | null = null

function getScrollApi(): ScrollApi | undefined {
  return (viewerRegistry?.getPlugin('scroll') as undefined | { provides?: () => ScrollApi })
    ?.provides?.()
}

/* ── zen mode ─────────────────────────────────────────────────────────────── */

/**
 * Hide the engine's toolbar while reading, and give it back when the cursor
 * goes looking (uiStore.zenPeek — the whole app shares that flag).
 *
 * The viewer renders into a shadow root, so no stylesheet of ours can reach the
 * toolbar from outside: this puts one INSIDE, keyed off an attribute on the
 * host element. The toolbar is addressed by its position rather than by a class
 * — it is the element the page content sits under, and `#document-content` is
 * the one stable id in there. If the engine ever reshapes that, the rule stops
 * matching and the toolbar simply stays visible: a plainer zen, never a broken
 * reader.
 */
const ZEN_STYLE = `
  :host([data-zen]) div:has(+ #document-content) {
    position: absolute;
    inset-inline: 0;
    top: 0;
    z-index: 30;
    opacity: 0;
    pointer-events: none;
    transition: opacity .2s;
  }
  :host([data-zen][data-peek]) div:has(+ #document-content) {
    opacity: 1;
    pointer-events: auto;
  }
`

let zenStyleEl: HTMLStyleElement | null = null

/** The engine's custom element, whose shadow root holds the viewer's own UI. */
function viewerShadowHost(): (HTMLElement & { shadowRoot: ShadowRoot | null }) | null {
  return host.value?.querySelector('embedpdf-container') ?? null
}

function applyZen(): void {
  const el = viewerShadowHost()
  const root = el?.shadowRoot
  if (!el || !root) return
  if (!zenStyleEl || zenStyleEl.ownerDocument !== root.ownerDocument || !root.contains(zenStyleEl)) {
    zenStyleEl = document.createElement('style')
    zenStyleEl.textContent = ZEN_STYLE
    root.appendChild(zenStyleEl)
  }
  el.toggleAttribute('data-zen', uiStore.zen)
  el.toggleAttribute('data-peek', uiStore.zen && uiStore.zenPeek)
}

watch([() => uiStore.zen, () => uiStore.zenPeek], applyZen)

/** The slice of the zoom plugin the re-fit uses. */
interface ZoomApi {
  requestZoom: (level: ZoomLevel) => void
  getState: () => { zoomLevel: ZoomLevel }
}

function getZoomApi(): ZoomApi | undefined {
  return (viewerRegistry?.getPlugin('zoom') as undefined | { provides?: () => ZoomApi })?.provides?.()
}

let paneObserver: ResizeObserver | null = null
let refitTimer: number | null = null
let paneWidth = 0

/**
 * Re-fit when the pane changes width on its own — closing the agent panel or
 * the sidebar widens the reader without the window resizing, and the engine
 * only recomputes a fit on ITS idea of a resize, so the page would sit at the
 * scale it was opened with in a pane that has since doubled.
 *
 * Only a fit mode is re-applied: a zoom the reader typed or picked is an answer
 * to "how big do I want this", not to "how wide is the pane", and re-fitting
 * would quietly throw it away.
 */
function watchPaneWidth(el: HTMLElement): void {
  paneWidth = el.clientWidth
  paneObserver = new ResizeObserver(() => {
    if (el.clientWidth === paneWidth) return // height-only: the fit is unchanged
    paneWidth = el.clientWidth
    if (refitTimer !== null) window.clearTimeout(refitTimer)
    refitTimer = window.setTimeout(() => {
      refitTimer = null
      const zoom = getZoomApi()
      const level = zoom?.getState().zoomLevel
      if (!zoom || level === undefined || typeof level === 'number') return
      zoom.requestZoom(level)
    }, 150)
  })
  paneObserver.observe(el)
}

/** The slice of the selection plugin's event surface the quote capture uses. */
interface SelectionEventsApi {
  onSelectionChange?: (
    cb: (e: { selection: { start: { page: number } } | null } | null) => void,
  ) => () => void
  onEndSelection?: (cb: () => void) => () => void
}

let selectionUnsubs: Array<() => void> = []
/** Where the current engine selection starts, 0-based, from the last change
 *  event — read when the selection ends, because the end event carries none. */
let selectionStartPage: number | null = null

/**
 * Mirror the engine's text selection into the composer as a quote chip — the
 * same behaviour markdown files get from lib/selectionContext, which cannot see
 * in here: EmbedPDF draws its own selection inside nested shadow DOM, so the
 * document-level `selectionchange` the generic capture listens to never fires
 * for it. The viewer pushes instead of being observed.
 *
 * Semantics mirror the generic capture: the chip follows the live selection
 * while the agent panel is open, clears when the selection does, and survives
 * as a snapshot once pinned. Provenance is the page the selection starts on.
 */
function watchSelectionForQuote(r: PluginRegistry): void {
  const api = (
    r.getPlugin('selection') as undefined | { provides?: () => SelectionEventsApi }
  )?.provides?.()
  if (!api?.onSelectionChange || !api.onEndSelection) return
  selectionUnsubs.push(
    api.onSelectionChange((e) => {
      const sel = e && 'selection' in e ? e.selection : null
      if (sel) {
        selectionStartPage = sel.start.page
      } else {
        selectionStartPage = null
        composer.clearTransient()
      }
    }),
    api.onEndSelection(() => {
      void stageQuoteFromSelection()
    }),
  )
}

async function stageQuoteFromSelection(): Promise<void> {
  if (!uiStore.agentOpen) return
  const text = await getEngineSelection()
  if (!text) return
  const page = selectionStartPage !== null ? selectionStartPage + 1 : pageMemory.get(props.path)
  composer.syncLive(props.path, text, { page })
}

/** Selected text from the engine's selection layer, '' when nothing selected. */
async function getEngineSelection(): Promise<string> {
  const api = (
    viewerRegistry?.getPlugin('selection') as
      | undefined
      | { provides?: () => { getSelectedText?: () => { toPromise: () => Promise<string[]> } } }
  )?.provides?.()
  const lines = await api?.getSelectedText?.()
    ?.toPromise()
    .catch(() => [] as string[])
  return (lines ?? []).join('\n').trim()
}

/** Read aloud: the engine selection if there is one, else the current page
 *  onward (text comes from the doc-index, so it needs the PDF to have finished
 *  indexing — which it auto-does on open). */
let readingThis = false // this instance started the current playback
let ttsLocations: Awaited<ReturnType<typeof loadPdfLocations>> = null
async function readAloud(): Promise<void> {
  const sel = await getEngineSelection()
  if (sel) {
    tts.speak(sel, t('viewers.selection'))
    return
  }
  // Triggered from a selected mark's popup: read the highlighted text itself.
  const markText = annotationApi?.getSelectedAnnotation?.()?.object?.custom?.text
  if (typeof markText === 'string' && markText.trim()) {
    tts.speak(markText, t('viewers.selection'))
    return
  }
  const page = getScrollApi()?.getCurrentPage?.() ?? 1
  const segments = await loadPdfSpeechSegments(props.path, page)
  if (!segments.length) return
  ttsLocations = await loadPdfLocations(props.path) // cached for highlight-follow
  readingThis = true
  tts.speak(segments, baseName(props.path))
}

/* ── Notes ───────────────────────────────────────────────────────────────────
   Same model as the EPUB reader: a note is a yellow highlight carrying the note
   in its `contents`, marked at its start with a small 📝 (a paired native Text
   annotation, tagged `custom.bmNoteFor`, so it tracks scroll/zoom for free). The
   shared NoteDialog edits it. */
const HIGHLIGHT_TYPE = PdfAnnotationSubtype.HIGHLIGHT
const UNDERLINE_TYPE = PdfAnnotationSubtype.UNDERLINE
type MarkStyle = 'highlight' | 'underline'
type Seg = { origin: { x: number; y: number }; size: { width: number; height: number } }
const noteEditor = ref<{
  excerpt: string
  note: string
  color: string
  style: MarkStyle
  annoId: string
  pageIndex: number
} | null>(null)
let openNoteOnCreate = false // the next created mark should open the note dialog
let noteBusy = false // suppress the selection watcher during programmatic note ops
let noteMarkCounter = 0
// Note mark id → its transient quote-marker id. Markers aren't persisted (the
// annotation's custom fields don't round-trip reliably), so we track the pairing
// here and re-stamp on load.
const noteMarkerFor = new Map<string, string>()

function boundsOf(segs: Seg[]): Seg {
  return segs.reduce((a, s) => {
    const x0 = Math.min(a.origin.x, s.origin.x)
    const y0 = Math.min(a.origin.y, s.origin.y)
    const x1 = Math.max(a.origin.x + a.size.width, s.origin.x + s.size.width)
    const y1 = Math.max(a.origin.y + a.size.height, s.origin.y + s.size.height)
    return { origin: { x: x0, y: y0 }, size: { width: x1 - x0, height: y1 - y0 } }
  })
}

/** Note button on a fresh text selection → create the highlight now (selection is
 *  live) and open the editor on its create event, so colour/underline act live. */
async function openNoteForSelection(): Promise<void> {
  const excerpt = await getEngineSelection()
  if (!excerpt) return
  openNoteOnCreate = true
  noteBusy = true
  annotationApi?.setToolDefaults('highlight', { strokeColor: HIGHLIGHT_COLORS[0].value })
  ;(
    viewerRegistry?.getPlugin('commands') as undefined | { provides?: () => CommandsApi }
  )?.provides?.()?.execute('annotation:add-highlight', undefined, 'ui')
  queueMicrotask(() => (noteBusy = false))
}

/** Clicking a noted mark (or its marker), or the note button on a selected mark. */
function openNoteForAnnotation(host: AnnoObject): void {
  if (host.id == null || host.pageIndex == null) return
  noteEditor.value = {
    excerpt: host.custom?.text ?? '',
    note: host.contents ?? '',
    color: host.strokeColor ?? HIGHLIGHT_COLORS[0].value,
    style: host.type === UNDERLINE_TYPE ? 'underline' : 'highlight',
    annoId: host.id,
    pageIndex: host.pageIndex,
  }
  annotationApi?.deselectAnnotation()
}

/** Read the note's passage aloud (the dialog's speaker button). */
function readNoteExcerpt(): void {
  if (noteEditor.value?.excerpt) tts.speak(noteEditor.value.excerpt, t('viewers.selection'))
}

/** The mark that owns a note, given any selected object (the mark itself, or its
 *  quote marker). Returns null for plain marks. */
function resolveNoteHost(obj: AnnoObject | undefined): AnnoObject | null {
  if (!obj) return null
  const forId = obj.custom?.bmNoteFor
  if (typeof forId === 'string') {
    return (userAnnotations.get(forId)?.annotation as AnnoObject | undefined) ?? null
  }
  if (
    (obj.type === HIGHLIGHT_TYPE || obj.type === UNDERLINE_TYPE) &&
    typeof obj.contents === 'string' &&
    obj.contents.trim()
  ) {
    return obj
  }
  return null
}

/* Live edits — the mark already exists, so these apply immediately. */
function noteRecolor(color: string): void {
  const ed = noteEditor.value
  if (!ed) return
  if (ed.style === 'underline') restyleMark('highlight', color)
  else {
    annotationApi?.updateAnnotation(ed.pageIndex, ed.annoId, { strokeColor: color })
    noteEditor.value = { ...ed, color }
  }
}
function noteUnderline(): void {
  const ed = noteEditor.value
  if (ed && ed.style !== 'underline') restyleMark('underline', ed.color)
}

/** Switch a mark's style by recreating it with the same geometry (PDFium can't
 *  change an annotation's subtype in place). "Delete, then re-add as the other
 *  style" — that's what makes highlight↔underline conversion possible. */
function restyleMark(style: MarkStyle, color: string): void {
  const ed = noteEditor.value
  if (!ed) return
  const cur = userAnnotations.get(ed.annoId)?.annotation as AnnoObject | undefined
  // Stored markups don't always carry segmentRects — fall back to the bounding
  // rect (same as the annotations viewer's pdfRects) so conversion never no-ops.
  const segs: Seg[] = cur?.segmentRects?.length
    ? (cur.segmentRects as Seg[])
    : cur?.rect
      ? [cur.rect as Seg]
      : []
  if (!segs.length) return
  noteBusy = true
  const contents = cur?.contents ?? ''
  const text = cur?.custom?.text ?? ''
  deleteMarkAndMarker(ed.annoId, ed.pageIndex)
  const id = `bm-note-${(noteMarkCounter += 1)}`
  annotationApi?.createAnnotation(ed.pageIndex, {
    type: style === 'underline' ? UNDERLINE_TYPE : HIGHLIGHT_TYPE,
    id,
    pageIndex: ed.pageIndex,
    rect: boundsOf(segs),
    segmentRects: segs,
    strokeColor: style === 'underline' ? UNDERLINE_COLOR : color,
    opacity: style === 'underline' ? 1 : 0.4,
    contents,
    custom: { text },
  } as unknown as PdfHighlightAnnoObject)
  noteEditor.value = { ...ed, annoId: id, color, style }
  if (contents.trim()) createNoteMarker(ed.pageIndex, segs[0].origin, id)
  queueMicrotask(() => (noteBusy = false))
}

/** Save just the note text; stamp the quote marker on first non-empty save. */
function saveNoteText(note: string): void {
  const ed = noteEditor.value
  if (!ed) return
  noteBusy = true
  annotationApi?.updateAnnotation(ed.pageIndex, ed.annoId, { contents: note })
  noteEditor.value = { ...ed, note }
  if (note && !noteMarkerFor.has(ed.annoId)) {
    const segs = (userAnnotations.get(ed.annoId)?.annotation as AnnoObject | undefined)
      ?.segmentRects as Seg[] | undefined
    if (segs?.[0]) createNoteMarker(ed.pageIndex, segs[0].origin, ed.annoId)
  }
  queueMicrotask(() => (noteBusy = false))
}

function deleteNote(): void {
  const ed = noteEditor.value
  noteEditor.value = null
  if (!ed) return
  noteBusy = true
  deleteMarkAndMarker(ed.annoId, ed.pageIndex)
  queueMicrotask(() => (noteBusy = false))
}

function deleteMarkAndMarker(annoId: string, pageIndex: number): void {
  const markerId = noteMarkerFor.get(annoId)
  if (markerId) {
    noteMarkerFor.delete(annoId)
    annotationApi?.deleteAnnotation(pageIndex, markerId)
  }
  annotationApi?.deleteAnnotation(pageIndex, annoId)
}

/** A quote glyph at the mark's start — the PDF twin of the EPUB reader's badge.
 *  A borderless/background-less FreeText annotation so it tracks scroll/zoom.
 *  Transient (not persisted); tracked in `noteMarkerFor` for delete/re-stamp. */
function createNoteMarker(pageIndex: number, origin: { x: number; y: number }, forId: string): void {
  const markerId = `bm-noteicon-${(noteMarkCounter += 1)}`
  try {
    annotationApi?.createAnnotation(pageIndex, {
      type: PdfAnnotationSubtype.FREETEXT,
      id: markerId,
      pageIndex,
      rect: { origin: { x: origin.x - 14, y: origin.y - 7 }, size: { width: 20, height: 22 } },
      contents: '“',
      fontFamily: PdfStandardFont.Helvetica_Bold,
      fontSize: 20,
      fontColor: '#dc2626',
      textAlign: PdfTextAlignment.Left,
      verticalAlign: PdfVerticalAlignment.Top,
      opacity: 1,
      custom: { bmNoteFor: forId },
    } as unknown as PdfFreeTextAnnoObject)
    noteMarkerFor.set(forId, markerId)
  } catch (err) {
    console.warn('note marker failed', err)
  }
}

/* TTS follow: highlight the block being spoken as a native highlight annotation
   (same mechanism as citation reveal — it tracks scroll/zoom for free) and
   bring its page into view when playback crosses onto a new one. Gated on this
   instance having started the read AND being the visible tab. */
let ttsHighlightId: string | null = null
let ttsHighlightPage: number | null = null
let ttsCounter = 0

function clearTtsHighlight(): void {
  if (ttsHighlightId !== null && ttsHighlightPage !== null) {
    annotationApi?.deleteAnnotation(ttsHighlightPage, ttsHighlightId)
  }
  ttsHighlightId = null
  ttsHighlightPage = null
}

watch(
  () => tts.chunkBlock,
  (blockId) => {
    if (!readingThis) return
    if (!blockId) {
      clearTtsHighlight()
      return
    }
    if (files.currentPath !== props.path || !annotationApi) return
    const block = ttsLocations?.blocks[blockId]
    const pageSize = block ? ttsLocations?.pageSizes?.[block.page - 1] : undefined
    if (!block || !pageSize || block.rects.length === 0) return

    const segmentRects = block.rects.map((r) => ({
      origin: { x: r.x * pageSize.w, y: r.y * pageSize.h },
      size: { width: r.w * pageSize.w, height: r.h * pageSize.h },
    }))
    const rect = segmentRects.reduce((a, s) => {
      const x0 = Math.min(a.origin.x, s.origin.x)
      const y0 = Math.min(a.origin.y, s.origin.y)
      const x1 = Math.max(a.origin.x + a.size.width, s.origin.x + s.size.width)
      const y1 = Math.max(a.origin.y + a.size.height, s.origin.y + s.size.height)
      return { origin: { x: x0, y: y0 }, size: { width: x1 - x0, height: y1 - y0 } }
    })

    clearTtsHighlight()
    const pageIndex = block.page - 1
    const id = `bm-tts-${(ttsCounter += 1)}`
    annotationApi.createAnnotation(pageIndex, {
      type: PdfAnnotationSubtype.HIGHLIGHT,
      id,
      pageIndex,
      rect,
      segmentRects,
      strokeColor: '#facc15',
      opacity: 0.4,
    } as PdfHighlightAnnoObject)
    ttsHighlightId = id
    ttsHighlightPage = pageIndex

    const scroll = getScrollApi()
    if (scroll && scroll.getCurrentPage?.() !== block.page) {
      scroll.scrollToPage({
        pageNumber: block.page,
        pageCoordinates: {
          x: rect.origin.x + rect.size.width / 2,
          y: rect.origin.y + rect.size.height / 2,
        },
        behavior: 'auto',
        alignX: 50,
        alignY: 50,
      })
    }
  },
)
watch(
  () => tts.playing,
  (v) => {
    if (!v) {
      readingThis = false
      clearTtsHighlight()
    }
  },
)

/* ── Page memory (per path, survives tab switches and reopen) ────────────── */
// The saved page is captured once in onReady, before any page-change event can
// fire — the initial page-1 render would otherwise overwrite it (and now that
// it persists to localStorage, clobber the stored value) before restore runs.
// Recording is gated on `restoreDone` so those pre-restore events are ignored.

let pendingRestorePage: number | null = null
let restoreDone = false

function subscribePageChanges(): void {
  const scroll = getScrollApi()
  if (!scroll?.onPageChange) return
  pageUnsub = scroll.onPageChange(() => {
    const page = scroll.getCurrentPage?.()
    if (!restoreDone) {
      // Reveal as soon as we actually land on the target, so it feels snappy.
      if (restoring.value && page === pendingRestorePage) finishRestore()
      return
    }
    if (page) rememberPdfPage(props.path, page)
  })
}

function finishRestore(): void {
  restoring.value = false
  restoreDone = true
}

/**
 * Restore the saved page, steering until the viewer arrives — same shape and
 * same reason as scrollToPoint above: a fixed retry window tuned on a warm
 * viewer quietly failed on a cold one, and the reader came back to page 1.
 * The page-change subscription calls finishRestore the moment the target is
 * reached; the deadline here is the fallback for targets no page-change event
 * names exactly (the last page, virtualization rounding), and drops the
 * restore overlay rather than leaving it up forever.
 */
function restoreSavedPage(): void {
  const page = pendingRestorePage
  if (!page || page <= 1 || !getScrollApi()?.scrollToPage) {
    finishRestore()
    return
  }
  restoring.value = true
  const stop = onUserScroll()
  // A handful of attempts while layout settles, and no more. Restoring a
  // reading position is a courtesy, not a promise: unlike a citation jump
  // nobody asked for it just now, so it must be the first thing to yield —
  // both to the reader and to the clock.
  const attempts = [60, 180, 400, 800, 1400, 2200]
  for (const delay of attempts) {
    window.setTimeout(() => {
      if (disposed || !restoring.value || stop.touched) return
      getScrollApi()?.scrollToPage({ pageNumber: page, behavior: 'auto' })
    }, delay)
  }
  // Reveal even if a page-change event for the exact target never arrives (the
  // last page, virtualization rounding) rather than leaving the overlay up.
  window.setTimeout(() => {
    stop.release()
    finishRestore()
  }, attempts[attempts.length - 1] + 400)
}

/* ── Annotation persistence (the published sidecar format) ──────────────── */
// Only the USER's annotations are persisted, built incrementally from events.
// Never call exportAnnotations() — hyperlinked books carry thousands of
// embedded Link annotations and serialising them freezes the renderer.

async function readSidecar(): Promise<TransferItem[]> {
  try {
    const text = await fs.tryReadFile(sidecarPath)
    if (!text) return []
    const parsed = JSON.parse(text) as { annotations?: TransferItem[] }
    if (!Array.isArray(parsed.annotations)) return []
    return parsed.annotations.filter((it) => it?.annotation?.type !== LINK_ANNOTATION_TYPE)
  } catch (e) {
    console.warn('Could not read annotation sidecar', e)
    return []
  }
}

function scheduleSave(): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void doSave(), 600)
}

async function doSave(): Promise<void> {
  const payload = JSON.stringify({ version: 1, annotations: [...userAnnotations.values()] }, null, 2)
  try {
    await fs.writeFile(sidecarPath, payload)
  } catch (e) {
    console.error('Failed to save annotation sidecar', e)
  }
}

function handleEvent(api: AnnotationApi, e: AnnotationEvent, saved: Promise<TransferItem[]>): void {
  if (e.type === 'loaded') {
    // The document is open: whatever the mask was hiding, it is not hiding a
    // blank viewer any more.
    markDocReady()
    // The document's own annotations finished loading — layer the user's on top.
    initialLoadDone = true
    void saved.then((items) => {
      if (items.length === 0) return
      for (const item of items) userAnnotations.set(item.annotation.id, item)
      api.importAnnotations(items)
      // Quote markers aren't persisted — re-stamp them for every noted mark.
      queueMicrotask(() => {
        for (const item of items) {
          const a = item.annotation as AnnoObject
          const origin = a.segmentRects?.[0]?.origin ?? a.rect?.origin
          if (a.id != null && a.pageIndex != null && a.contents?.trim() && origin) {
            createNoteMarker(a.pageIndex, origin, a.id)
          }
        }
      })
    })
    const hadReveal = !!pendingReveal
    flushReveal()
    // A citation jump wins over page restore; drop any restore overlay and
    // enable recording so later user scrolls are remembered.
    if (hadReveal) finishRestore()
    else restoreSavedPage()
    return
  }
  if (!initialLoadDone) return
  // App-managed overlays (citation flash, TTS follow, note quote markers) are
  // never persisted — they're re-derived from the notes on load.
  if (
    e.annotation.id.startsWith('bm-cite-') ||
    e.annotation.id.startsWith('bm-tts-') ||
    e.annotation.id.startsWith('bm-noteicon-')
  )
    return
  if (e.annotation.type === LINK_ANNOTATION_TYPE) return
  if (e.type === 'delete') {
    userAnnotations.delete(e.annotation.id)
  } else {
    userAnnotations.set(e.annotation.id, {
      annotation: e.annotation,
      ...(e.ctx !== undefined ? { ctx: e.ctx } : {}),
    })
    if (e.type === 'create') {
      // The note button created this mark — open the editor on it (deferred to
      // avoid re-entering the event emitter).
      if (
        openNoteOnCreate &&
        (e.annotation.type === HIGHLIGHT_TYPE || e.annotation.type === UNDERLINE_TYPE)
      ) {
        openNoteOnCreate = false
        const mark = e.annotation as AnnoObject
        queueMicrotask(() => openNoteForAnnotation(mark))
      }
      // The selection-popup markup commands (highlight/underline/…) arm their
      // tool right after creating the annotation, leaving a sticky "annotate
      // mode". Undo it so the next text selection is a plain selection.
      queueMicrotask(returnToPointerMode)
    }
  }
  scheduleSave()
}

/** After a markup annotation is created: disarm the tool, drop back to the
 *  default (pointer) interaction mode, and clear the selection so the floating
 *  edit popup (comment/colour/delete) never appears — matching the EPUB reader,
 *  where highlighting is a one-shot. The top annotation toolbar is suppressed
 *  separately, the moment it opens — see watchAnnotationToolbar(). */
function returnToPointerMode(): void {
  const r = viewerRegistry
  if (!r) return
  annotationApi?.setActiveTool(null)
  annotationApi?.deselectAnnotation()
  ;(
    r.getPlugin('interaction-manager') as
      | undefined
      | { provides?: () => { activateDefaultMode?: () => void } }
  )?.provides?.()?.activateDefaultMode?.()
}

/* ── Read-aloud toolbar button ───────────────────────────────────────────────
   Registered as a native EmbedPDF command + icon and injected into the top
   toolbar's right group, so it sits beside search/comment instead of floating
   over them (the old absolute overlay covered the comment button). Reading the
   engine selection still works from here — a UI click doesn't clear it. */
interface ToolbarChange {
  documentId: string
  placement: string
  slot: string
  toolbarId: string
}
interface UiApi {
  getSchema: () => UISchema
  mergeSchema: (partial: Partial<UISchema>) => void
  forDocument: (id: string) => { closeToolbarSlot: (placement: string, slot: string) => void }
  onToolbarChanged: (cb: (e: ToolbarChange) => void) => () => void
}
interface CommandsApi {
  registerCommand: (cmd: {
    id: string
    label?: string
    icon?: string
    iconProps?: { primaryColor?: string }
    action: (ctx: { registry: PluginRegistry; documentId: string }) => void
  }) => void
  execute: (commandId: string, documentId?: string, source?: string) => void
  /* The shortcut surface lib/pdfKeys takes over (optional: absent on an older
   * EmbedPDF, in which case the takeover simply does not run). */
  getAllShortcuts?: () => Map<string, string>
  getCommandByShortcut?: (shortcut: string) => { id: string } | null | undefined
  unregisterCommand?: (commandId: string) => void
}

/** Take EmbedPDF's keyboard shortcuts away from its document-wide listener and
 *  re-dispatch them under lib/pdfKeys' ownership rules. Without this, one
 *  mounted PDF tab — visible or not — ate ⌘C (and ⌘F, ⌘P, ArrowLeft…) for the
 *  whole app: the plugin preventDefaults any combo in its table regardless of
 *  where the user's selection lives. The full account is in lib/pdfKeys. */
let disposeKeyScope: (() => void) | null = null
function takeoverKeyboardShortcuts(r: PluginRegistry): void {
  const commands = (
    r.getPlugin('commands') as undefined | { provides?: () => CommandsApi }
  )?.provides?.()
  if (!commands?.getAllShortcuts || !commands.getCommandByShortcut || !commands.unregisterCommand)
    return
  const table = takeoverPdfShortcuts(commands as ShortcutCommandsApi)
  disposeKeyScope = registerPdfKeyScope({
    host: () => host.value,
    shortcuts: table,
    // documentId undefined + source 'keyboard': exactly what the library's own
    // handler passed, so a command cannot tell the difference.
    execute: (id) => commands.execute(id, undefined, 'keyboard'),
  })
}

/** Register our custom icons + commands and reshape the viewer UI: a read-aloud
 *  button in the top toolbar, and an EPUB-style text-selection popup — five
 *  highlight-colour swatches, a read-aloud button and a single underline —
 *  replacing EmbedPDF's default copy/highlight/strikeout/underline/squiggly bar. */
function customizeViewerUi(r: PluginRegistry): void {
  const commands = (
    r.getPlugin('commands') as undefined | { provides?: () => CommandsApi }
  )?.provides?.()
  const ui = (r.getPlugin('ui') as undefined | { provides?: () => UiApi })?.provides?.()
  const anno = (
    r.getPlugin('annotation') as undefined | { provides?: () => AnnotationApi }
  )?.provides?.()
  if (!commands || !ui) return

  // Speaker-with-waves glyph (lucide "volume-2"), stroked in the current icon
  // colour so it matches the built-in buttons.
  registerIcon('bm-read-aloud', {
    viewBox: '0 0 24 24',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    paths: [
      {
        d: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z',
        stroke: 'primary',
        fill: 'none',
      },
      { d: 'M16 9a5 5 0 0 1 0 6', stroke: 'primary', fill: 'none' },
      { d: 'M19.364 18.364a9 9 0 0 0 0-12.728', stroke: 'primary', fill: 'none' },
    ],
  })
  // A solid disc, filled with the command's primaryColor — one glyph, five colours.
  registerIcon('bm-swatch', {
    viewBox: '0 0 24 24',
    paths: [{ d: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', fill: 'primary', stroke: 'none' }],
  })
  // Zen (lucide "square"): the same window shape codicon-chrome-maximize draws
  // in the shell and the EPUB toolbar, redrawn here in the stroke weight of the
  // buttons beside it — one glyph for zen, two icon sets to say it in.
  registerIcon('bm-zen', {
    viewBox: '0 0 24 24',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    paths: [
      {
        d: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
        stroke: 'primary',
        fill: 'none',
      },
    ],
  })
  // Note (lucide "pencil") and view-annotations (lucide "list") glyphs.
  registerIcon('bm-note', {
    viewBox: '0 0 24 24',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    paths: [
      {
        d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
        stroke: 'primary',
        fill: 'none',
      },
      { d: 'm15 5 4 4', stroke: 'primary', fill: 'none' },
    ],
  })
  registerIcon('bm-view-annotations', {
    viewBox: '0 0 24 24',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    paths: [
      { d: 'M8 6h13', stroke: 'primary', fill: 'none' },
      { d: 'M8 12h13', stroke: 'primary', fill: 'none' },
      { d: 'M8 18h13', stroke: 'primary', fill: 'none' },
      { d: 'M3 6h.01', stroke: 'primary', fill: 'none' },
      { d: 'M3 12h.01', stroke: 'primary', fill: 'none' },
      { d: 'M3 18h.01', stroke: 'primary', fill: 'none' },
    ],
  })

  commands.registerCommand({
    id: 'bm:read-aloud',
    label: t('viewers.pdf.readAloud'),
    icon: 'bm-read-aloud',
    action: () => void readAloud(),
  })
  // One command per highlight colour: set the highlight tool's colour, then reuse
  // EmbedPDF's built-in highlight-from-selection command. The sticky annotate
  // mode / floating popup it leaves behind are undone by returnToPointerMode().
  // The same swatch also serves the "clicked an existing mark" popup: if an
  // annotation is already selected, recolour it in place instead of creating.
  for (const c of HIGHLIGHT_COLORS) {
    commands.registerCommand({
      id: `bm:hl-${c.name}`,
      label: c.name,
      icon: 'bm-swatch',
      iconProps: { primaryColor: c.value },
      action: ({ registry, documentId }) => {
        const a = (
          registry.getPlugin('annotation') as undefined | { provides?: () => AnnotationApi }
        )?.provides?.()
        const sel = a?.getSelectedAnnotation?.()
        if (sel?.object?.id != null && sel.object.pageIndex != null) {
          a?.updateAnnotation(sel.object.pageIndex, sel.object.id, { strokeColor: c.value })
          a?.deselectAnnotation()
          return
        }
        a?.setToolDefaults('highlight', { strokeColor: c.value })
        ;(
          registry.getPlugin('commands') as undefined | { provides?: () => CommandsApi }
        )?.provides?.()?.execute('annotation:add-highlight', documentId, 'ui')
      },
    })
  }
  // Underline is always the EPUB red.
  anno?.setToolDefaults('underline', { strokeColor: UNDERLINE_COLOR })
  // Underline-from-selection, but a no-op when a mark is already selected — the
  // built-in add-underline would otherwise arm the tool with no text to act on,
  // silently turning the *next* text selection into an underline.
  commands.registerCommand({
    id: 'bm:underline',
    label: t('viewers.pdf.underline'),
    icon: 'underline',
    iconProps: { primaryColor: UNDERLINE_COLOR },
    action: ({ registry, documentId }) => {
      const a = (
        registry.getPlugin('annotation') as undefined | { provides?: () => AnnotationApi }
      )?.provides?.()
      if (a?.getSelectedAnnotation?.()?.object?.id != null) return
      ;(
        registry.getPlugin('commands') as undefined | { provides?: () => CommandsApi }
      )?.provides?.()?.execute('annotation:add-underline', documentId, 'ui')
    },
  })
  // Note button → open the shared NoteDialog. On a selected mark it adds/edits
  // that mark's note; on a text selection it creates a fresh noted highlight.
  commands.registerCommand({
    id: 'bm:note',
    label: t('viewers.pdf.note'),
    icon: 'bm-note',
    action: ({ registry }) => {
      const a = (
        registry.getPlugin('annotation') as undefined | { provides?: () => AnnotationApi }
      )?.provides?.()
      const sel = a?.getSelectedAnnotation?.()?.object
      if (sel?.id != null && sel.pageIndex != null) openNoteForAnnotation(sel)
      else void openNoteForSelection()
    },
  })
  // Enter zen from the reader itself — the app's own chrome is gone by then, so
  // this is the button someone reaches for, and the same one takes them back.
  commands.registerCommand({
    id: 'bm:zen',
    label: t('viewers.zen'),
    icon: 'bm-zen',
    action: () => uiStore.toggleZen(),
  })
  // Replaces EmbedPDF's comment panel button: open this book's annotations.
  commands.registerCommand({
    id: 'bm:view-annotations',
    label: t('viewers.pdf.viewAnnotations'),
    icon: 'bm-view-annotations',
    action: () => void files.openFile(sidecarPath),
  })

  const schema = structuredClone(ui.getSchema())

  // Top toolbar right group: search · read-aloud · view-annotations. EmbedPDF's
  // comment-panel button is dropped — notes replace it, and view-annotations
  // (opens the sidecar) takes its place.
  const main = schema.toolbars['main-toolbar']
  if (main) {
    const right = main.items.find(
      (it) => it.type === 'group' && it.id === 'right-group',
    ) as GroupItem | undefined
    if (right) {
      right.items = right.items.filter((it) => it.id !== 'comment-button') // → [search]
      right.items.push(
        ...(READ_ALOUD_ENABLED
          ? ([
              {
                type: 'command-button',
                id: 'bm-read-aloud-btn',
                commandId: 'bm:read-aloud',
                variant: 'icon',
              },
            ] as ToolbarItem[])
          : []),
        { type: 'command-button', id: 'bm-zen-btn', commandId: 'bm:zen', variant: 'icon' },
        {
          type: 'command-button',
          id: 'bm-view-annotations-btn',
          commandId: 'bm:view-annotations',
          variant: 'icon',
        },
      )
    }
    // Drop the vertical divider lines (they bracket the zoom controls) for a
    // cleaner bar. Dividers live inside the toolbar's groups.
    const stripDividers = (items: ToolbarItem[]): ToolbarItem[] =>
      items
        .filter((it) => it.type !== 'divider')
        .map((it) => (it.type === 'group' ? { ...it, items: stripDividers(it.items) } : it))
    main.items = stripDividers(main.items)
  }

  // Text-selection popup, EPUB-style: swatches | read-aloud + underline.
  const swatches: SelectionMenuItem[] = HIGHLIGHT_COLORS.map((c): SelectionMenuItem => ({
    type: 'command-button',
    id: `bm-sel-hl-${c.name}`,
    commandId: `bm:hl-${c.name}`,
    variant: 'icon',
  }))
  const selection: SelectionMenuSchema = {
    id: 'selection',
    visibilityDependsOn: { itemIds: [...swatches.map((s) => s.id), 'bm-sel-underline'] },
    items: [
      ...swatches,
      { type: 'divider', id: 'bm-sel-divider' },
      ...(READ_ALOUD_ENABLED
        ? ([
            { type: 'command-button', id: 'bm-sel-read', commandId: 'bm:read-aloud', variant: 'icon' },
          ] as SelectionMenuItem[])
        : []),
      {
        type: 'command-button',
        id: 'bm-sel-underline',
        commandId: 'bm:underline',
        variant: 'icon',
      },
      { type: 'command-button', id: 'bm-sel-note', commandId: 'bm:note', variant: 'icon' },
    ],
  }
  // Popup for an already-created annotation (clicking a highlight/underline).
  // Same bar as the text-selection popup — swatches recolour the mark in place —
  // plus a trash button pinned to the far right. Rebuilding both menus is why
  // `mergeSchema` must carry BOTH: selectionMenus is replaced wholesale, so
  // omitting `annotation` here is what removed this popup before.
  const annoSwatches: SelectionMenuItem[] = HIGHLIGHT_COLORS.map((c): SelectionMenuItem => ({
    type: 'command-button',
    id: `bm-anno-hl-${c.name}`,
    commandId: `bm:hl-${c.name}`,
    variant: 'icon',
  }))
  const annotation: SelectionMenuSchema = {
    id: 'annotation',
    categories: ['annotation'],
    items: [
      ...annoSwatches,
      { type: 'divider', id: 'bm-anno-div1' },
      ...(READ_ALOUD_ENABLED
        ? ([
            { type: 'command-button', id: 'bm-anno-read', commandId: 'bm:read-aloud', variant: 'icon' },
          ] as SelectionMenuItem[])
        : []),
      {
        type: 'command-button',
        id: 'bm-anno-underline',
        commandId: 'bm:underline',
        variant: 'icon',
      },
      { type: 'command-button', id: 'bm-anno-note', commandId: 'bm:note', variant: 'icon' },
      { type: 'divider', id: 'bm-anno-div2' },
      {
        type: 'command-button',
        id: 'bm-anno-delete',
        commandId: 'annotation:delete-selected',
        variant: 'icon',
      },
    ],
  }

  ui.mergeSchema({
    ...(main ? { toolbars: { 'main-toolbar': main } } : {}),
    selectionMenus: { selection, annotation },
  })
}

/** With the mode tabs removed, the only thing that ever opens the top "secondary"
 *  toolbar slot is a markup command activating the annotation toolbar. We don't
 *  want it at all, so close the slot the instant it opens — synchronously, in the
 *  same tick as the open, so it never paints. The documentId comes from the event
 *  (a plugin lookup returns null too early here). Closing re-emits with an empty
 *  toolbarId, so the id guard keeps this from looping. */
let toolbarWatcher: (() => void) | null = null
function watchAnnotationToolbar(r: PluginRegistry): void {
  const ui = (r.getPlugin('ui') as undefined | { provides?: () => UiApi })?.provides?.()
  if (!ui?.onToolbarChanged) return
  toolbarWatcher = ui.onToolbarChanged((e) => {
    if (e.placement === 'top' && e.slot === 'secondary' && e.toolbarId === 'annotation-toolbar') {
      ui.forDocument(e.documentId).closeToolbarSlot('top', 'secondary')
    }
  })
}

/** React to what got selected: a link jumps to its destination; a noted mark
 *  (or its 📝 icon) opens the note editor. Both then clear the selection so the
 *  default annotation popup never shows. Guarded against the deselect re-entering,
 *  and against firing during our own note create/edit (`noteBusy`). */
let linkWatcher: (() => void) | null = null
let followingLink = false
function watchLinkSelection(r: PluginRegistry): void {
  const anno = (
    r.getPlugin('annotation') as undefined | { provides?: () => AnnotationApi }
  )?.provides?.()
  if (!anno?.onStateChange) return
  linkWatcher = anno.onStateChange(() => {
    if (followingLink || noteBusy || noteEditor.value) return
    const obj = anno.getSelectedAnnotation?.()?.object
    if (!obj) return
    if (obj.type === LINK_ANNOTATION_TYPE && obj.target != null) {
      followingLink = true
      try {
        anno.navigateTarget?.(obj.target)
        anno.deselectAnnotation?.()
      } finally {
        followingLink = false
      }
      return
    }
    const host = resolveNoteHost(obj)
    if (host) openNoteForAnnotation(host)
  })
}

function onReady(r: PluginRegistry): void {
  viewerRegistry = r
  if (host.value) watchPaneWidth(host.value)
  applyZen() // the shadow root only exists once the viewer has rendered
  takeoverKeyboardShortcuts(r)
  customizeViewerUi(r)
  watchAnnotationToolbar(r)
  watchLinkSelection(r)
  watchSelectionForQuote(r)
  // Capture the remembered page now, before the first page-change fires. Skip
  // the restore overlay when a citation jump is pending — that wins instead.
  pendingRestorePage = pageMemory.get(props.path) ?? null
  const willReveal =
    citations.pending?.path === props.path &&
    !!(citations.pending?.blockId || citations.pending?.annotation)
  if (!willReveal && pendingRestorePage && pendingRestorePage > 1) restoring.value = true
  subscribePageChanges()
  const plugin = r.getPlugin('annotation') as undefined | { provides?: () => unknown }
  const api = plugin?.provides?.() as AnnotationApi | undefined
  if (!api) {
    markDocReady() // nothing left that will tell us; don't mask on a maybe
    return
  }
  annotationApi = api
  // Subscribe FIRST (synchronously) — 'loaded' can fire before the read resolves.
  const saved = readSidecar()
  unsubscribe = api.onAnnotationEvent((e) => handleEvent(api, e, saved))
  maybeReveal(citations.pending)
}

/* ── AI index ────────────────────────────────────────────────────────────── */

type IndexState = 'idle' | 'parsing' | 'done' | 'error'
const indexState = ref<IndexState>('idle')
const indexMsg = ref('')
// An index from an older algorithm revision: fully usable, rebuild offered
// via a small badge — never rebuilt uninvited.
const indexOutdated = ref(false)
/** The indexed text was recognised off pictures, not read out of the file —
 *  a standing property of the document, so it is a badge and not a toast. */
const recognised = ref(false)
/** The index came back with no blocks: a picture-only PDF. */
const scanned = ref(false)
let msgTimer: number | null = null

/* ── Reading the pictures (OCR) ──────────────────────────────────────────── */

/**
 * Offered on a scan, never run uninvited. Recognition is minutes of this
 * machine's CPU for a book, and the engine plus its language data are
 * megabytes — so the module is imported at the click, and the page count and
 * a time estimate sit on the button that starts it.
 */
type OcrStage = 'idle' | 'setup' | 'running'
const ocrStage = ref<OcrStage>('idle')
const ocrLang = ref(getLocale() === 'zh' ? 'chi_sim' : 'eng')
const ocrPage = ref(0)
const ocrPageCount = ref(0)
const ocrNote = ref('')
let ocrAbort: AbortController | null = null

/** Seconds a page costs, measured on an Intel Mac against a 300-DPI Chinese
 *  scan. Wrong by a factor of two on other hardware and it still answers the
 *  question the user is actually asking: minutes, or an afternoon? */
const SECONDS_PER_PAGE = 6

const ocrMinutes = computed(() =>
  Math.max(1, Math.round((ocrPageCount.value * SECONDS_PER_PAGE) / 60)),
)

async function startOcr(): Promise<void> {
  ocrAbort = new AbortController()
  ocrStage.value = 'running'
  ocrPage.value = 0
  ocrNote.value = ''
  try {
    const result = await indexDocument(props.path, () => {}, {
      ocr: {
        lang: ocrLang.value,
        onPage: (c) => (ocrPage.value = c),
        signal: ocrAbort.signal,
      },
    })
    ocrStage.value = 'idle'
    if (result.blockCount === 0) {
      ocrNote.value = t('viewers.scanned.empty')
    } else {
      // The notice existed to say this document has no text. It now has some.
      scanned.value = false
      recognised.value = true
      indexMsg.value = t('viewers.scanned.done', { n: result.blockCount })
      msgTimer = window.setTimeout(() => (indexMsg.value = ''), 8000)
    }
  } catch (err) {
    // Back to the setup step, not to the offer: whoever cancelled or hit an
    // error was standing there a moment ago, and the language they picked is
    // the thing they are most likely to want to change.
    ocrStage.value = 'setup'
    ocrNote.value =
      (err as Error)?.name === 'AbortError'
        ? t('viewers.scanned.cancelled')
        : t('viewers.scanned.failed', { msg: (err as Error).message })
  } finally {
    ocrAbort = null
  }
}

function cancelOcr(): void {
  ocrAbort?.abort()
}

async function runIndex(auto = false, rebuild = false): Promise<void> {
  if (indexState.value === 'parsing') return
  if (msgTimer !== null) {
    window.clearTimeout(msgTimer)
    msgTimer = null
  }
  indexState.value = 'parsing'
  indexMsg.value = auto ? '' : t('viewers.pdf.indexStarting')
  try {
    const result = await indexDocument(
      props.path,
      (c, total, phase) => {
        // Three parts, and only the first used to say anything: a big PDF sat
        // under "Extracting page 2480/2480" for the whole of the other two,
        // which reads as hung rather than busy. `build` announces itself before
        // it has anything to count (see the parsers), hence the bare form.
        indexMsg.value =
          phase === 'extract'
            ? t('viewers.pdf.indexExtracting', { c, t: total })
            : phase === 'write'
              ? t('viewers.pdf.indexWriting', { c, t: total })
              : total
                ? t('viewers.pdf.indexBuildingN', { c, t: total })
                : t('viewers.pdf.indexBuilding')
      },
      { rebuild },
    )
    indexState.value = 'done'
    // A scan indexes "successfully" to nothing. That is a fact about the
    // document worth keeping on screen, not a five-second tail on a toast.
    scanned.value = result.blockCount === 0
    ocrPageCount.value = result.pageCount ?? 0
    if (!result.cached) indexOutdated.value = false
    if (auto && result.cached) {
      indexMsg.value = ''
    } else {
      indexMsg.value =
        `${result.cached ? t('viewers.pdf.indexAlready') : t('viewers.pdf.indexDone')} · ${t('viewers.pdf.indexSections', { n: result.sectionCount })}` +
        ''
      msgTimer = window.setTimeout(() => (indexMsg.value = ''), 5000)
    }
  } catch (err) {
    indexState.value = 'error'
    indexMsg.value = (err as Error).message || t('viewers.pdf.indexFailed')
  }
}

async function initIndexStatus(): Promise<void> {
  if (await hasIndex(props.path)) {
    indexState.value = 'done'
    indexOutdated.value = (await queryIndexState(props.path)) === 'outdated'
    recognised.value = (await pdfTextSource(props.path)) === 'ocr'
  } else {
    void runIndex(true)
  }
}

/* ── Citation reveal ─────────────────────────────────────────────────────── */
// Drawn as a native EmbedPDF highlight annotation, so it tracks the page on
// scroll/zoom for free. A fresh unique id every time — reusing one crashes
// EmbedPDF's async delete-commit.

let citationHighlightId: string | null = null
let citationHighlightPage: number | null = null
let citationCounter = 0
let pendingReveal: PendingJump | null = null
let lastDoneNonce = 0

function clearCitationHighlight(): void {
  if (citationHighlightId !== null && citationHighlightPage !== null) {
    annotationApi?.deleteAnnotation(citationHighlightPage, citationHighlightId)
  }
  citationHighlightId = null
  citationHighlightPage = null
}

async function showCitation(blockId: string, nonce: number): Promise<void> {
  if (!viewerRegistry || !annotationApi) return
  const locations = await loadPdfLocations(props.path)
  const block = locations?.blocks[blockId]
  const pageSize = block ? locations?.pageSizes?.[block.page - 1] : undefined
  if (!block || !pageSize || block.rects.length === 0) {
    console.warn(`[pdf-qa] citation ${blockId} not resolved`)
    return
  }
  if (nonce !== lastDoneNonce) return

  const segmentRects = block.rects.map((r) => ({
    origin: { x: r.x * pageSize.w, y: r.y * pageSize.h },
    size: { width: r.w * pageSize.w, height: r.h * pageSize.h },
  }))
  const rect = segmentRects.reduce((a, s) => {
    const x0 = Math.min(a.origin.x, s.origin.x)
    const y0 = Math.min(a.origin.y, s.origin.y)
    const x1 = Math.max(a.origin.x + a.size.width, s.origin.x + s.size.width)
    const y1 = Math.max(a.origin.y + a.size.height, s.origin.y + s.size.height)
    return { origin: { x: x0, y: y0 }, size: { width: x1 - x0, height: y1 - y0 } }
  })

  clearCitationHighlight()
  const pageIndex = block.page - 1
  const id = `bm-cite-${(citationCounter += 1)}`
  annotationApi.createAnnotation(pageIndex, {
    type: PdfAnnotationSubtype.HIGHLIGHT,
    id,
    pageIndex,
    rect,
    segmentRects,
    strokeColor: '#58a6ff',
    opacity: 0.4,
  } as PdfHighlightAnnoObject)
  citationHighlightId = id
  citationHighlightPage = pageIndex

  scrollToPoint(
    block.page,
    rect.origin.x + rect.size.width / 2,
    rect.origin.y + rect.size.height / 2,
    nonce,
  )
}

/**
 * Scroll a page-point to the viewport centre, steering until the viewer
 * actually arrives.
 *
 * The deadline is generous and the success check is observed, not assumed. An
 * earlier version retried for a fixed 2.5s from the moment the jump was
 * requested — tuned on a warm viewer, where layout settles in under a second.
 * On a cold one (first visit, worker still compiling, a 43-page document
 * measuring itself) the first paint can take ten, so the window died before
 * the viewer could move and the citation silently opened on page 1. Exactly
 * the load order every first-time demo visitor gets.
 *
 * Steering stops the moment the target page is reached (checked via
 * getCurrentPage, so a user who scrolls after arrival is never fought), when a
 * newer jump supersedes this one, or at the cap.
 */
/**
 * Whether the viewer has actually laid its pages out, detected as a scroll
 * container many times taller than its viewport — a 43-page document measures
 * ~27,000px against a ~650px client height once real.
 *
 * Two dead ends are baked into this shape. The probe pierces shadow roots,
 * because EmbedPDF renders its entire UI inside nested shadow DOM where an
 * ordinary querySelector sees nothing. And it looks for scroll extent rather
 * than a canvas, because a fully rendered viewer contains no canvas at all —
 * measured directly, both of them.
 */
function viewerHasLayout(root: Element | ShadowRoot): boolean {
  for (const el of root.querySelectorAll('*')) {
    if (el.scrollHeight > el.clientHeight * 3 && el.clientHeight > 100) return true
    if (el.shadowRoot && viewerHasLayout(el.shadowRoot)) return true
  }
  return false
}

function scrollToPoint(pageNumber: number, cx: number, cy: number, nonce: number): void {
  const stop = onUserScroll()
  // Phase one: wait for the viewer to actually paint. Every clock-based
  // version of this function failed the same way, tuned on a warm viewer and
  // dead on a cold one — the scroll plugin will accept a jump and report the
  // target page over a completely blank viewport, and then the real layout
  // (pages measuring themselves, the fit-width zoom recalculation) throws the
  // position back to page 1. The only signal that survives all of that is a
  // rendered canvas, so the steering clock starts when one exists.
  const renderDeadline = Date.now() + 90_000
  const awaitRender = (): void => {
    if (disposed || nonce !== lastDoneNonce || stop.touched) {
      stop.release()
      return
    }
    if (host.value && viewerHasLayout(host.value)) {
      steer()
      return
    }
    if (Date.now() < renderDeadline) window.setTimeout(awaitRender, 300)
    else stop.release()
  }
  // Phase two: steer until settled. "Arrived once" is not "done" — a late
  // relayout can still snap back — so the whole window is watched. A correct
  // position issues nothing, and the reader touching the document ends it.
  const steer = (): void => {
    const until = Date.now() + 12_000
    const tick = (): void => {
      if (disposed || nonce !== lastDoneNonce || stop.touched) {
        stop.release()
        return
      }
      const scroll = getScrollApi()
      if (scroll?.getCurrentPage?.() !== pageNumber) {
        scroll?.scrollToPage({
          pageNumber,
          pageCoordinates: { x: cx, y: cy },
          behavior: 'auto',
          alignX: 50,
          alignY: 50,
        })
      }
      if (Date.now() < until) window.setTimeout(tick, 250)
      else stop.release()
    }
    tick()
  }
  awaitRender()
}

/**
 * A latch that trips the moment the reader touches the document.
 *
 * Steering the viewport is only ever a guess about where someone wants to be,
 * and the instant they scroll it stops being a guess. Without this, a retry
 * loop long enough to survive a cold viewer is also long enough to hold the
 * page hostage: an earlier version re-issued a scroll every 250ms for twenty
 * seconds, so a document whose page-change event never named the exact target
 * simply refused to move for the reader. Better to give up on a jump than to
 * fight the person reading.
 */
function onUserScroll(): { touched: boolean; release: () => void } {
  const latch = {
    touched: false,
    release: () => {
      window.removeEventListener('wheel', trip, true)
      window.removeEventListener('touchmove', trip, true)
      window.removeEventListener('keydown', trip, true)
    },
  }
  function trip(): void {
    latch.touched = true
    latch.release()
  }
  window.addEventListener('wheel', trip, true)
  window.addEventListener('touchmove', trip, true)
  window.addEventListener('keydown', trip, true)
  return latch
}

/** Annotations-page jump: centre the annotation's own region. The highlight is
 *  already rendered by EmbedPDF, so no transient citation mark is drawn. */
function showAnnotationTarget(t: AnnotationTarget, nonce: number): void {
  const rects = t.rects ?? []
  if (!t.page || rects.length === 0) return
  clearCitationHighlight()
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w))
  const y1 = Math.max(...rects.map((r) => r.y + r.h))
  scrollToPoint(t.page, (x0 + x1) / 2, (y0 + y1) / 2, nonce)
}

function maybeReveal(r: PendingJump | null): void {
  if (!r) return
  if (r.path !== props.path) {
    clearCitationHighlight() // only one citation highlight across documents
    return
  }
  pendingReveal = r
  citations.clear() // consumed — buffered locally until the viewer is ready
  flushReveal()
}

function flushReveal(): void {
  const r = pendingReveal
  if (!r || (!r.blockId && !r.annotation)) {
    pendingReveal = null
    return
  }
  if (r.nonce === lastDoneNonce) {
    pendingReveal = null
    return
  }
  if (!viewerRegistry || !annotationApi || !initialLoadDone) return
  pendingReveal = null
  lastDoneNonce = r.nonce
  if (r.blockId) void showCitation(r.blockId, r.nonce)
  else if (r.annotation) showAnnotationTarget(r.annotation, r.nonce)
}

watch(() => citations.pending, maybeReveal)

/* ── Sidecar re-sync ─────────────────────────────────────────────────────── */
// PdfDocument instances stay mounted across tab switches (v-show), so edits
// made on the annotations page (or in the raw JSON editor) must be pulled in:
// diff by id — removed ids are deleted from EmbedPDF, new ids imported.
// Note-only edits change no id and need no EmbedPDF call; color edits arrive
// as delete+add because the annotations page assigns a fresh id (reusing an
// id across delete/create crashes EmbedPDF's async delete-commit).

async function reloadFromSidecar(): Promise<void> {
  if (!annotationApi || !initialLoadDone) return
  const items = await readSidecar()
  const next = new Map(items.map((it) => [it.annotation.id, it]))
  // Snapshot keys first: deleteAnnotation fires a 'delete' event that mutates
  // userAnnotations, which would corrupt a live iteration.
  for (const id of [...userAnnotations.keys()]) {
    if (next.has(id)) continue
    const pageIndex = (userAnnotations.get(id)!.annotation as { pageIndex?: unknown }).pageIndex
    if (typeof pageIndex === 'number') annotationApi.deleteAnnotation(pageIndex, id)
  }
  const added = items.filter((it) => !userAnnotations.has(it.annotation.id))
  userAnnotations.clear()
  for (const [id, it] of next) userAnnotations.set(id, it)
  if (added.length) annotationApi.importAnnotations(added)
}

watch(sidecarRevision, (rev) => {
  if (rev && rev.source === props.path) void reloadFromSidecar()
})

/* ── lifecycle ───────────────────────────────────────────────────────────── */

/**
 * The mask over a document that has not opened yet, and its two clocks.
 *
 * What lifts it is the engine telling us the document is loaded (see
 * handleEvent) — an event, not a look at the DOM. The obvious probe, "has the
 * viewer laid pages out", cannot be written against this viewer from outside
 * it: it virtualises, so its scroll container is exactly as tall as the
 * viewport, and its pages render inside shadow roots we cannot read. A probe
 * that answers "not yet" forever would leave every PDF behind a spinner.
 *
 * The deadline is the safety valve for a document that never loads at all:
 * the mask hides the engine's own error message, so it must not be able to
 * outlive the answer by much. It is armed twice: a long watchdog over the
 * file read (storage is the step we control least — a cloud placeholder can
 * take arbitrarily long or never return), then, once the engine actually has
 * the bytes, a budget that grows with the document — a fixed 15s is generous
 * for an article and tight for a 300MB scan. The slow clock is the other
 * end — a first open compiles the wasm engine and can take seconds, which is
 * worth saying rather than spinning through.
 */
const LOAD_DEADLINE_MS = 15_000
const DEADLINE_PER_MB_MS = 200
const DEADLINE_MAX_MS = 60_000
const READ_DEADLINE_MS = 60_000
const SLOW_AFTER_MS = 2500
let slowTimer: number | null = null
let deadlineTimer: number | null = null

function markDocReady(): void {
  docReady.value = true
  if (slowTimer !== null) window.clearTimeout(slowTimer)
  if (deadlineTimer !== null) window.clearTimeout(deadlineTimer)
  slowTimer = deadlineTimer = null
  scheduleAutoIndex()
}

/**
 * Auto-indexing waits for the document to be open, then for an idle frame:
 * a first-ever open of a large PDF used to start the whole-document text
 * extraction while the viewer was still measuring its pages, and the two
 * fought over the CPU for the length of the build — the reader stared at a
 * blank viewport the whole time. The index is a background artifact; nothing
 * about it is owed a slice of the first paint.
 */
let indexScheduled = false
function scheduleAutoIndex(): void {
  if (indexScheduled) return
  indexScheduled = true
  const idle =
    'requestIdleCallback' in window
      ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 8000 })
      : (cb: () => void) => window.setTimeout(cb, 1500)
  idle(() => {
    if (!disposed) void initIndexStatus()
  })
}

onMounted(async () => {
  slowTimer = window.setTimeout(() => (loadingSlow.value = true), SLOW_AFTER_MS)
  deadlineTimer = window.setTimeout(markDocReady, READ_DEADLINE_MS)
  let buf: ArrayBuffer
  try {
    buf = await fs.readBinary(props.path)
  } catch (err) {
    console.error(`Failed to read PDF ${props.path}`, err)
    markDocReady() // no engine is coming to explain; at least stop spinning
    return
  }
  if (disposed) return
  if (deadlineTimer !== null) window.clearTimeout(deadlineTimer)
  deadlineTimer = window.setTimeout(
    markDocReady,
    Math.min(LOAD_DEADLINE_MS + (buf.byteLength / 1_000_000) * DEADLINE_PER_MB_MS, DEADLINE_MAX_MS),
  )
  blobUrl.value = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
})

onBeforeUnmount(() => {
  disposed = true
  disposeKeyScope?.()
  disposeKeyScope = null
  if (slowTimer !== null) window.clearTimeout(slowTimer)
  if (deadlineTimer !== null) window.clearTimeout(deadlineTimer)
  if (msgTimer !== null) window.clearTimeout(msgTimer)
  if (refitTimer !== null) window.clearTimeout(refitTimer)
  paneObserver?.disconnect()
  paneObserver = null
  pageUnsub?.()
  unsubscribe?.()
  toolbarWatcher?.()
  linkWatcher?.()
  selectionUnsubs.forEach((u) => u())
  selectionUnsubs = []
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer)
    void doSave()
  }
  if (blobUrl.value) URL.revokeObjectURL(blobUrl.value)
})
</script>

<template>
  <div ref="host" class="h-full w-full flex flex-col">
    <div class="flex-1 min-h-0 relative">
      <PDFViewer
        v-if="blobUrl"
        :config="config"
        :style="{ width: '100%', height: '100%' }"
        @ready="onReady"
      />
      <!-- One loading effect, in one place: opaque, so the engine's own centred
           spinner never shows through it, and near the top of the pane, where
           the eye already is — a corner is somewhere nobody waiting for a
           document is looking. It also still does what it always did: mask the
           page-1 flash while we scroll to the remembered page. -->
      <div v-if="!docReady || restoring" class="absolute inset-0 z-10 bg-bg-1">
        <div
          class="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-border bg-bg-2 px-3 py-1.5 text-xs text-fg-3 shadow"
        >
          <span class="codicon codicon-sm codicon-loading codicon-modifier-spin" />
          {{
            docReady
              ? $t('viewers.pdf.restoring')
              : loadingSlow
                ? $t('viewers.pdf.loadingSlow')
                : $t('viewers.pdf.loading')
          }}
        </div>
      </div>
      <!-- Read aloud + highlight colours live in the PDF toolbar and selection
           popup now (see customizeViewerUi). -->
      <!-- Index status: rebuild progress/result, and the older-algorithm
           badge. The badge is an offer — the index works as it is; only a
           click rebuilds (block ids are inherited, citations survive). -->
      <!-- top-14: just below the engine's toolbar row, whose right side holds
           its own icons — the badge must not sit on top of them. -->
      <div
        v-if="docReady"
        class="absolute top-14 right-4 z-10 flex items-center gap-2"
      >
        <div
          v-if="indexMsg"
          class="px-2 py-1 rounded border border-border bg-bg-2 text-xs shadow-sm"
          :class="indexState === 'error' ? 'text-removed' : 'text-fg-3'"
        >
          {{ indexMsg }}
        </div>
        <!-- Not a button: there is nothing to do about it, only something
             to know before quoting. -->
        <span
          v-if="recognised && indexState !== 'parsing'"
          class="flex items-center gap-1 rounded border border-border bg-bg-1 px-1.5 py-0.5 text-xs text-fg-3 shadow-sm"
          :title="$t('viewers.index.recognisedHint')"
        >
          <span class="codicon codicon-sm codicon-file-media" />
          {{ $t('viewers.index.recognised') }}
        </span>
        <button
          v-if="indexOutdated && indexState !== 'parsing'"
          class="btn text-xs shadow-sm"
          :title="$t('viewers.index.updateHint')"
          @click="runIndex(false, true)"
        >
          <span class="codicon codicon-sm codicon-refresh" />
          {{ $t('viewers.index.updateAvailable') }}
        </button>
        <SourceNoteBadge :path="path" />
      </div>

      <!-- A scan indexes successfully to nothing, which used to be reported
           as a five-second "· no text layer" tail on a toast — a fact about
           the document delivered as if it were a status. It stays until
           dismissed, says what still works, and never blocks the page. -->
      <div
        v-if="docReady && scanned"
        class="absolute bottom-4 right-4 z-10 max-w-sm rounded-lg border border-border bg-bg-1 p-3 shadow-lg"
      >
        <div class="flex items-start gap-2">
          <span class="codicon codicon-sm codicon-file-media mt-0.5 shrink-0 text-fg-3" />
          <div class="min-w-0">
            <div class="text-xs font-semibold text-fg-1">{{ $t('viewers.scanned.title') }}</div>
            <p class="mt-1 text-xs leading-relaxed text-fg-3">{{ $t('viewers.scanned.body') }}</p>
          </div>
          <button
            v-if="ocrStage !== 'running'"
            class="shrink-0 text-fg-3 hover:text-fg-0"
            :title="$t('viewers.dismiss')"
            @click="scanned = false"
          >
            <span class="codicon codicon-sm codicon-close" />
          </button>
        </div>

        <!-- Reading the pictures. Three states in the same card, because it
             is one decision being made in one place: offer, price, progress.
             The estimate is on the button that spends the time. -->
        <div class="mt-2 pl-6">
          <button
            v-if="ocrStage === 'idle'"
            class="btn text-xs"
            @click="ocrStage = 'setup'"
          >
            {{ $t('viewers.scanned.offer') }}
          </button>

          <template v-else-if="ocrStage === 'setup'">
            <label class="flex items-center gap-2 text-xs text-fg-3">
              {{ $t('viewers.scanned.language') }}
              <select v-model="ocrLang" class="input text-xs py-0.5">
                <option v-for="l in OCR_LANGS" :key="l" :value="l">{{ l }}</option>
              </select>
            </label>
            <p class="mt-1.5 text-[11px] leading-relaxed text-fg-3">
              {{ $t('viewers.scanned.estimate', { mins: ocrMinutes }) }}
            </p>
            <div class="mt-2 flex items-center gap-2">
              <button class="btn-primary text-xs" @click="startOcr">
                {{ $t('viewers.scanned.start', { n: ocrPageCount }) }}
              </button>
              <button class="btn text-xs" @click="ocrStage = 'idle'">
                {{ $t('viewers.scanned.cancel') }}
              </button>
            </div>
          </template>

          <template v-else>
            <div class="flex items-center gap-2">
              <span class="codicon codicon-sm codicon-loading animate-spin text-fg-3" />
              <span class="text-xs text-fg-2">
                {{
                  ocrPage
                    ? $t('viewers.scanned.running', { c: ocrPage, t: ocrPageCount })
                    : $t('viewers.scanned.preparing')
                }}
              </span>
              <button class="btn text-xs ml-auto" @click="cancelOcr">
                {{ $t('viewers.scanned.cancel') }}
              </button>
            </div>
            <div class="mt-1.5 h-1 rounded bg-bg-2 overflow-hidden">
              <div
                class="h-full bg-accent transition-[width] duration-300"
                :style="{ width: `${ocrPageCount ? (100 * ocrPage) / ocrPageCount : 0}%` }"
              />
            </div>
          </template>

          <p v-if="ocrNote" class="mt-1.5 text-[11px] leading-relaxed text-fg-3">{{ ocrNote }}</p>
        </div>
      </div>
    </div>

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
