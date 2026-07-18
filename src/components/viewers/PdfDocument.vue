<script setup lang="ts">
/**
 * One EmbedPDF viewer instance per open PDF — ported from trace-app's
 * PdfDocument.vue. The engine provides rendering, selection, zoom, search,
 * outline sidebar and the highlight-annotation UI natively; this component
 * adds: sidecar annotation persistence, AI-index status, citation reveal,
 * and per-path page memory. `path` is fixed for the instance's lifetime.
 */
import { PDFViewer, type PluginRegistry } from '@embedpdf/vue-pdf-viewer'
// Local wasm — absolute so the engine's blob: workers can resolve it.
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'
import { PdfAnnotationSubtype, type PdfHighlightAnnoObject } from '@embedpdf/models'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as fs from '@/lib/fs'
import { hasIndex, indexDocument } from '@/lib/docindex'
import { loadPdfLocations } from '@/lib/docindex/pdf'
import { useCitationsStore, type PendingJump } from '@/stores/citations'
import { useThemeStore } from '@/stores/theme'
import { pdfPage as pageMemory, rememberPdfPage } from '@/lib/viewMemory'

const props = defineProps<{ path: string }>()

const citations = useCitationsStore()
const theme = useThemeStore()

const absoluteWasmUrl = new URL(pdfiumWasmUrl, window.location.href).href
const blobUrl = ref<string | null>(null)
/** Shown while we scroll to the remembered page, to mask the page-1 flash. */
const restoring = ref(false)
let disposed = false

const config = computed(() => ({
  wasmUrl: absoluteWasmUrl,
  src: blobUrl.value ?? '',
  theme: { preference: (theme.isDark ? 'dark' : 'light') as 'dark' | 'light' },
}))

/* ── EmbedPDF plugin capability slices (same shapes trace-app drives) ────── */

interface TransferItem {
  annotation: { id: string; type?: number; [k: string]: unknown }
  ctx?: unknown
}
type AnnotationEvent =
  | { type: 'create' | 'update' | 'delete'; annotation: TransferItem['annotation']; ctx?: unknown }
  | { type: 'loaded'; total: number }
interface AnnotationApi {
  importAnnotations: (items: TransferItem[]) => void
  onAnnotationEvent: (cb: (e: AnnotationEvent) => void) => () => void
  createAnnotation: (pageIndex: number, annotation: PdfHighlightAnnoObject) => void
  deleteAnnotation: (pageIndex: number, annotationId: string) => void
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

/** Restore the saved page; retried because layout settles shortly after load. */
function restoreSavedPage(): void {
  const page = pendingRestorePage
  const scroll = getScrollApi()
  if (!page || page <= 1 || !scroll?.scrollToPage) {
    finishRestore()
    return
  }
  restoring.value = true
  const attempts = [60, 180, 400, 800, 1400]
  for (const delay of attempts) {
    window.setTimeout(() => {
      if (!disposed && restoring.value) scroll.scrollToPage({ pageNumber: page, behavior: 'auto' })
    }, delay)
  }
  // Fallback: reveal even if a page-change event for the exact target never
  // arrives (e.g. the last page, or virtualization rounding).
  window.setTimeout(finishRestore, attempts[attempts.length - 1] + 400)
}

/* ── Annotation persistence (trace-app sidecar format) ───────────────────── */
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
    // The document's own annotations finished loading — layer the user's on top.
    initialLoadDone = true
    void saved.then((items) => {
      if (items.length === 0) return
      for (const item of items) userAnnotations.set(item.annotation.id, item)
      api.importAnnotations(items)
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
  if (e.annotation.id.startsWith('bm-cite-')) return // app-managed, never persisted
  if (e.annotation.type === LINK_ANNOTATION_TYPE) return
  if (e.type === 'delete') {
    userAnnotations.delete(e.annotation.id)
  } else {
    userAnnotations.set(e.annotation.id, {
      annotation: e.annotation,
      ...(e.ctx !== undefined ? { ctx: e.ctx } : {}),
    })
  }
  scheduleSave()
}

function onReady(r: PluginRegistry): void {
  viewerRegistry = r
  // Capture the remembered page now, before the first page-change fires. Skip
  // the restore overlay when a citation jump is pending — that wins instead.
  pendingRestorePage = pageMemory.get(props.path) ?? null
  const willReveal = citations.pending?.path === props.path && !!citations.pending?.blockId
  if (!willReveal && pendingRestorePage && pendingRestorePage > 1) restoring.value = true
  subscribePageChanges()
  void initIndexStatus()
  const plugin = r.getPlugin('annotation') as undefined | { provides?: () => unknown }
  const api = plugin?.provides?.() as AnnotationApi | undefined
  if (!api) return
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
let msgTimer: number | null = null

async function runIndex(auto = false): Promise<void> {
  if (indexState.value === 'parsing') return
  if (msgTimer !== null) {
    window.clearTimeout(msgTimer)
    msgTimer = null
  }
  indexState.value = 'parsing'
  indexMsg.value = auto ? '' : 'Starting…'
  try {
    const result = await indexDocument(props.path, (c, t) => {
      indexMsg.value = `Extracting page ${c}/${t}`
    })
    indexState.value = 'done'
    if (auto && result.cached) {
      indexMsg.value = ''
    } else {
      indexMsg.value =
        `${result.cached ? 'Already indexed' : 'Indexed'} · ${result.sectionCount} sections` +
        `${result.blockCount === 0 ? ' · no text layer (scanned?)' : ''}`
      msgTimer = window.setTimeout(() => (indexMsg.value = ''), 5000)
    }
  } catch (err) {
    indexState.value = 'error'
    indexMsg.value = (err as Error).message || 'Indexing failed'
  }
}

async function initIndexStatus(): Promise<void> {
  if (await hasIndex(props.path)) {
    indexState.value = 'done'
  } else {
    void runIndex(true)
  }
}

/* ── Citation reveal ─────────────────────────────────────────────────────── */
// Drawn as a native EmbedPDF highlight annotation, so it tracks the page on
// scroll/zoom for free. A fresh unique id every time — reusing one crashes
// EmbedPDF's async delete-commit (see trace-app's embedpdf-config note).

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

  // Scroll to the block's centre; retried while the viewport settles.
  const scroll = getScrollApi()
  const cx = rect.origin.x + rect.size.width / 2
  const cy = rect.origin.y + rect.size.height / 2
  const until = Date.now() + 2500
  const doScroll = (): void => {
    if (disposed || nonce !== lastDoneNonce) return
    scroll?.scrollToPage({
      pageNumber: block.page,
      pageCoordinates: { x: cx, y: cy },
      behavior: 'auto',
      alignX: 50,
      alignY: 50,
    })
    if (Date.now() < until) window.setTimeout(doScroll, 150)
  }
  doScroll()
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
  if (!r || !r.blockId) {
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
  void showCitation(r.blockId, r.nonce)
}

watch(() => citations.pending, maybeReveal)

/* ── lifecycle ───────────────────────────────────────────────────────────── */

onMounted(async () => {
  const buf = await fs.readBinary(props.path)
  if (disposed) return
  blobUrl.value = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
})

onBeforeUnmount(() => {
  disposed = true
  if (msgTimer !== null) window.clearTimeout(msgTimer)
  pageUnsub?.()
  unsubscribe?.()
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer)
    void doSave()
  }
  if (blobUrl.value) URL.revokeObjectURL(blobUrl.value)
})
</script>

<template>
  <div class="h-full w-full flex flex-col">
    <!-- No chrome bar: filename shows in the editor tab, and (re)indexing lives
         in the file-tree right-click menu. PDFs still auto-index on open. -->
    <div class="flex-1 min-h-0 relative">
      <PDFViewer
        v-if="blobUrl"
        :config="config"
        :style="{ width: '100%', height: '100%' }"
        @ready="onReady"
      />
      <!-- Masks the page-1 flash while we scroll to the remembered page. -->
      <div
        v-if="restoring"
        class="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-bg-1/50 text-sm text-fg-3"
      >
        <span class="codicon codicon-sm codicon-loading codicon-modifier-spin" />
        跳转到上次阅读位置…
      </div>
    </div>
  </div>
</template>
