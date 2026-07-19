<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import ePub, { type Book, type Rendition, type NavItem } from 'epubjs'
import * as fs from '@/lib/fs'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { useThemeStore } from '@/stores/theme'
import { hasIndex, indexDocument } from '@/lib/docindex'
import { loadEpubLocations } from '@/lib/docindex/epub'
import { epubLocation, epubLocations, rememberEpubLocation, rememberEpubLocations } from '@/lib/viewMemory'
import {
  HIGHLIGHT_COLORS,
  UNDERLINE_COLOR,
  loadEpubSidecar,
  saveEpubSidecar,
  type EpubAnnotation,
} from '@/lib/annotations'

type MarkStyle = 'highlight' | 'underline'

const files = useFilesStore()
const citations = useCitationsStore()
const theme = useThemeStore()

const host = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const indexState = ref<'none' | 'indexing' | 'indexed'>('none')
const indexDetail = ref('')
const tocOpen = ref(false)
const fontPct = ref(110)
const selCfi = ref<string | null>(null)
const popup = ref<{ x: number; y: number; cfi: string; existing: boolean } | null>(null)
const progressPct = ref(0)
const chapterLabel = ref('')

// Page numbers (macOS Books-style), derived from epub.js locations.
const curPage = ref(0)
const totalPages = ref(0)
// "← page N" button, shown after a non-sequential jump (citation / TOC / search).
const backTarget = ref<{ cfi: string; page: number } | null>(null)

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
// Set right before a programmatic jump so 'relocated' can offer a "back" button.
let jumpFrom: { cfi: string; page: number } | null = null

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
  if (resizeTimer) {
    clearTimeout(resizeTimer)
    resizeTimer = 0
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

async function load(path: string | null): Promise<void> {
  destroy()
  docPath = path
  toc.value = []
  if (!path || !host.value) return
  indexDetail.value = ''
  if (await hasIndex(path)) {
    indexState.value = 'indexed'
  } else {
    // Auto-index on first open, matching the PDF viewer.
    indexState.value = 'none'
    void runIndex()
  }
  const buf = await fs.readBinary(path)
  book = ePub(buf)
  rendition = book.renderTo(host.value, {
    width: '100%',
    height: '100%',
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
    contents.document.addEventListener('keydown', onKey)
    // A mousedown on the page body (never on a highlight — those live in an
    // overlay in the top document) dismisses the floating popup / citation mark.
    contents.document.addEventListener('mousedown', onContentMousedown)
  })
  // Also page on left/right arrows when the iframe isn't focused (e.g. right
  // after clicking a toolbar button). Skipped while typing / with modifiers.
  window.addEventListener('keydown', onWindowKey)
  // Dismiss the popup / citation highlight when clicking anywhere in the top
  // document that isn't the popup or an existing mark.
  window.addEventListener('mousedown', onWindowMousedown)
  await rendition.display(epubLocation.get(path))

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
        rendition?.resize(el.clientWidth, el.clientHeight)
      }, 150)
    })
    ro.observe(el)
  }

  // Capture text selections so the highlight buttons know what to apply to.
  rendition.on('selected', (cfiRange: string, contents: { window: Window }) => {
    selCfi.value = cfiRange
    selText = contents?.window?.getSelection?.()?.toString().trim() ?? ''
    // Pop the color bar right at the selection so highlighting no longer needs
    // a trip to the toolbar.
    if (selText) showSelectionPopup(cfiRange, contents)
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
      const far = !totalPages.value || Math.abs(curPage.value - jumpFrom.page) > 1
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
  if (e.key === 'ArrowRight' || e.key === 'PageDown') next()
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev()
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

function reapplyHighlights(): void {
  if (!rendition) return
  for (const a of annotations) {
    removeMark(a.cfi, a.style)
    applyOne(a.cfi, a.color, a.style ?? 'highlight')
  }
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
  const target = (e.target ?? e.currentTarget) as Element | null
  const rect = target?.getBoundingClientRect()
  if (!rect || rect.width === 0) return
  popup.value = { x: rect.left + rect.width / 2, y: rect.bottom, cfi, existing: true }
}

async function deleteAnnot(): Promise<void> {
  if (!rendition || !popup.value || !docPath) return
  const { cfi } = popup.value
  removeMark(cfi, annotations.find((a) => a.cfi === cfi)?.style)
  annotations = annotations.filter((a) => a.cfi !== cfi)
  popup.value = null
  await saveEpubSidecar(docPath, annotations)
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

function updatePage(cfi: string | null): void {
  if (!book || !totalPages.value || !cfi) return
  const idx = book.locations.locationFromCfi(cfi) as unknown as number
  curPage.value = (typeof idx === 'number' && idx >= 0 ? idx : 0) + 1
}

function currentCfi(): string | null {
  try {
    return (rendition?.currentLocation() as unknown as { start?: { cfi?: string } })?.start?.cfi ?? null
  } catch {
    return null
  }
}

/** Record where we are before a jump, so 'relocated' can offer a back button. */
function markJumpOrigin(): void {
  const cfi = currentCfi()
  if (cfi) jumpFrom = { cfi, page: curPage.value }
}

function goBack(): void {
  const t = backTarget.value
  if (!t || !rendition) return
  backTarget.value = null
  jumpFrom = null // returning shouldn't arm another back button
  void rendition.display(t.cfi)
}

/* ───────── in-book search ───────── */

function toggleSearch(): void {
  searchOpen.value = !searchOpen.value
  if (searchOpen.value) {
    tocOpen.value = false
    void nextTick(() => searchInput.value?.focus())
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
  clearCitationHighlight()
  rendition.annotations.highlight(cfi, {}, undefined, 'epub-hl', {
    fill: 'rgb(88 166 255)',
    'fill-opacity': '0.35',
  })
  lastHighlight = cfi
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
  }
  citations.clear()
}

async function runIndex(): Promise<void> {
  if (!docPath || indexState.value === 'indexing') return
  indexState.value = 'indexing'
  try {
    const s = await indexDocument(docPath, (c, t) => {
      indexDetail.value = `${c}/${t}`
    })
    indexState.value = 'indexed'
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

function prev(): void {
  void rendition?.prev()
}
function next(): void {
  void rendition?.next()
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="relative flex items-center gap-2 h-10 px-3 border-b border-border shrink-0">
      <button
        class="btn text-xs"
        :class="{ '!text-accent': tocOpen }"
        :disabled="!toc.length"
        :title="toc.length ? 'Table of contents' : 'No navigation'"
        @click="tocOpen = !tocOpen; searchOpen && (searchOpen = false)"
      >
        <span class="codicon codicon-sm codicon-list-tree" />
      </button>
      <button
        class="btn text-xs"
        :class="{ '!text-accent': searchOpen }"
        title="Search in book"
        @click="toggleSearch"
      >
        <span class="codicon codicon-sm codicon-search" />
      </button>

      <!-- Font zoom -->
      <button class="btn text-xs" title="Smaller text" @click="setFont(fontPct - 10)">
        <span class="codicon codicon-sm codicon-zoom-out" />
      </button>
      <span class="text-xs text-fg-3 w-9 text-center">{{ fontPct }}%</span>
      <button class="btn text-xs" title="Larger text" @click="setFont(fontPct + 10)">
        <span class="codicon codicon-sm codicon-zoom-in" />
      </button>

      <!-- Chapter title, centered. Paging is arrow-keys only (no prev/next buttons). -->
      <span
        class="pointer-events-none absolute left-1/2 -translate-x-1/2 max-w-[40%] truncate text-center text-xs text-fg-3"
      >{{ chapterLabel }}</span>

      <!-- Right side: back-to-page (left) then current / total page (right). -->
      <div class="ml-auto flex items-center gap-2">
        <button
          v-if="backTarget"
          class="btn text-xs !text-accent"
          :title="`Back to page ${backTarget.page}`"
          @click="goBack"
        >
          <span class="codicon codicon-sm codicon-discard" /> {{ backTarget.page }}
        </button>
        <span class="text-xs text-fg-3 whitespace-nowrap">
          <template v-if="totalPages">{{ curPage }} / {{ totalPages }}</template>
          <template v-else>{{ progressPct }}%</template>
        </span>
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
            placeholder="Search in book…"
            class="w-full text-sm bg-bg-2 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-accent"
            @keydown.enter="runSearch"
          />
        </div>
        <div class="flex-1 min-h-0 panel-scroll">
          <div v-if="searching" class="px-3 py-2 text-xs text-fg-3">Searching…</div>
          <div v-else-if="searchResults.length" class="px-3 py-1 text-[11px] uppercase tracking-wide text-fg-3">
            {{ searchResults.length }} result<span v-if="searchResults.length > 1">s</span>
          </div>
          <div
            v-else-if="searchQuery.trim()"
            class="px-3 py-2 text-xs text-fg-3"
          >
            No matches.
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
      <div v-else-if="tocOpen && toc.length" class="w-72 shrink-0 border-r border-border bg-bg-1 panel-scroll py-2">
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
      <div class="flex-1 min-w-0" :class="theme.isDark ? 'bg-bg-1' : 'bg-white'" ref="host" />
    </div>

    <!-- Mark popup: color swatches + highlight/underline toggle + delete -->
    <Teleport to="body">
      <div
        v-if="popup"
        class="bm-popup fixed z-50 flex items-center gap-1.5 px-2 py-1.5 rounded border border-border bg-bg-1 shadow-lg"
        :style="{ left: `${popup.x - 76}px`, top: `${popup.y + 8}px` }"
      >
        <button
          v-for="c in HIGHLIGHT_COLORS"
          :key="c.value"
          class="w-5 h-5 rounded-full border border-border transition-transform hover:scale-110"
          :style="{ backgroundColor: c.value }"
          :title="`Highlight ${c.name}`"
          @click="pickColor(c.value)"
        />
        <span class="w-px h-4 bg-border mx-0.5" />
        <button
          class="w-6 h-5 rounded flex items-center justify-center leading-none text-fg-3 hover:text-fg-1"
          title="Underline (red)"
          @click="underlineSelection"
        >
          <span class="text-xs font-semibold underline underline-offset-2" :style="{ color: UNDERLINE_COLOR }">U</span>
        </button>
        <button
          v-if="popup.existing"
          class="text-fg-3 hover:text-removed ml-0.5"
          title="Delete mark"
          @click="deleteAnnot"
        >
          <span class="codicon codicon-sm codicon-trash" />
        </button>
      </div>
    </Teleport>
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
</style>
