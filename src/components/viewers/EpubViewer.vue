<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import ePub, { type Book, type Rendition, type NavItem } from 'epubjs'
import * as fs from '@/lib/fs'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { useThemeStore } from '@/stores/theme'
import { hasIndex, indexDocument } from '@/lib/docindex'
import { loadEpubLocations } from '@/lib/docindex/epub'
import { epubLocation, rememberEpubLocation } from '@/lib/viewMemory'
import {
  HIGHLIGHT_COLORS,
  loadEpubSidecar,
  saveEpubSidecar,
  type EpubAnnotation,
} from '@/lib/annotations'

const files = useFilesStore()
const citations = useCitationsStore()
const theme = useThemeStore()

const host = ref<HTMLElement | null>(null)
const indexState = ref<'none' | 'indexing' | 'indexed'>('none')
const indexDetail = ref('')
const tocOpen = ref(false)
const fontPct = ref(110)
const selCfi = ref<string | null>(null)
const popup = ref<{ x: number; y: number; cfi: string } | null>(null)
const progressPct = ref(0)
const chapterLabel = ref('')

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
  selCfi.value = null
  popup.value = null
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
  })
  // Also page on left/right arrows when the iframe isn't focused (e.g. right
  // after clicking a toolbar button). Skipped while typing / with modifiers.
  window.addEventListener('keydown', onWindowKey)
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
  })
  // epub.js computes highlight positions at insert time only — re-apply after
  // every relocation so they don't drift as the user pages around. Also track
  // reading progress and the current chapter label (trace-app behavior).
  rendition.on('relocated', (loc: { start: { percentage: number; href: string; cfi: string } }) => {
    progressPct.value = Math.round((loc.start.percentage || 0) * 100)
    const entry = toc.value.find(
      (t) => t.href.split('#')[0] === loc.start.href || t.href.split('#')[0].endsWith(loc.start.href),
    )
    if (entry) chapterLabel.value = entry.title
    // Persist on each page turn: a hard reload may skip destroy(), so saving
    // only on unmount would lose the latest page.
    if (docPath && loc.start.cfi) rememberEpubLocation(docPath, loc.start.cfi)
    reapplyHighlights()
    popup.value = null
  })

  annotations = await loadEpubSidecar(path)
  reapplyHighlights()
  await maybeJump()
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

/* ───────── highlights ───────── */

function applyOne(cfi: string, color: string): void {
  rendition?.annotations.highlight(
    cfi,
    {},
    (e: MouseEvent) => onHighlightClick(cfi, e),
    'bm-highlight',
    { fill: color, 'fill-opacity': '0.45' },
  )
}

function reapplyHighlights(): void {
  if (!rendition) return
  for (const a of annotations) {
    try {
      rendition.annotations.remove(a.cfi, 'highlight')
    } catch {
      /* not rendered yet */
    }
    applyOne(a.cfi, a.color)
  }
}

async function highlightSelection(color: string): Promise<void> {
  if (!rendition || !selCfi.value || !docPath) return
  const cfi = selCfi.value
  const existing = annotations.find((a) => a.cfi === cfi)
  if (existing) {
    rendition.annotations.remove(cfi, 'highlight')
    existing.color = color
  } else {
    annotations.push({ cfi, color, text: selText, createdAt: new Date().toISOString() })
  }
  applyOne(cfi, color)
  // Clear the in-iframe selection so the user sees the highlight commit.
  ;(rendition as unknown as { getContents?: () => Array<{ window: Window }> })
    .getContents?.()
    .forEach((c) => c.window.getSelection?.()?.removeAllRanges())
  selCfi.value = null
  await saveEpubSidecar(docPath, annotations)
}

/**
 * epub.js clones the iframe click event without prototype properties, so
 * clientX/Y arrive as 0 — anchor the popup to the mark's bounding rect.
 */
function onHighlightClick(cfi: string, e: MouseEvent): void {
  const target = (e.target ?? e.currentTarget) as Element | null
  const rect = target?.getBoundingClientRect()
  if (!rect || rect.width === 0) return
  popup.value = { x: rect.left + rect.width / 2, y: rect.bottom, cfi }
}

async function recolor(color: string): Promise<void> {
  if (!rendition || !popup.value || !docPath) return
  const { cfi } = popup.value
  const ann = annotations.find((a) => a.cfi === cfi)
  if (!ann) return
  rendition.annotations.remove(cfi, 'highlight')
  ann.color = color
  applyOne(cfi, color)
  await saveEpubSidecar(docPath, annotations)
}

async function deleteAnnot(): Promise<void> {
  if (!rendition || !popup.value || !docPath) return
  const { cfi } = popup.value
  rendition.annotations.remove(cfi, 'highlight')
  annotations = annotations.filter((a) => a.cfi !== cfi)
  popup.value = null
  await saveEpubSidecar(docPath, annotations)
}

/* ───────── zoom (font size) ───────── */

function setFont(pct: number): void {
  fontPct.value = Math.min(220, Math.max(60, pct))
  rendition?.themes.fontSize(`${fontPct.value}%`)
}

/* ───────── citation jump / toc / index ───────── */

function flattenNav(items: NavItem[], level = 1, out: FlatTocEntry[] = []): FlatTocEntry[] {
  for (const it of items) {
    out.push({ title: (it.label ?? '').trim(), level, href: it.href ?? '' })
    if (it.subitems?.length) flattenNav(it.subitems, level + 1, out)
  }
  return out
}

function goTo(href: string): void {
  if (href && rendition) void rendition.display(href)
}

async function maybeJump(): Promise<void> {
  const pend = citations.pending
  if (!pend || pend.path !== docPath || !rendition) return
  if (pend.blockId) {
    const locs = await loadEpubLocations(pend.path)
    const cfi = locs?.blocks[pend.blockId]?.cfi
    if (cfi) {
      await rendition.display(cfi)
      if (lastHighlight) {
        try {
          rendition.annotations.remove(lastHighlight, 'highlight')
        } catch {
          /* already gone */
        }
      }
      rendition.annotations.highlight(cfi, {}, undefined, 'epub-hl', {
        fill: 'rgb(88 166 255)',
        'fill-opacity': '0.35',
      })
      lastHighlight = cfi
    }
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
    <div class="flex items-center gap-2 h-10 px-3 border-b border-border shrink-0">
      <button
        class="btn text-xs"
        :class="{ '!text-accent': tocOpen }"
        :disabled="!toc.length"
        :title="toc.length ? 'Table of contents' : 'No navigation'"
        @click="tocOpen = !tocOpen"
      >
        <span class="codicon codicon-sm codicon-list-tree" />
      </button>

      <!-- Font zoom -->
      <button class="btn text-xs" title="Smaller text" @click="setFont(fontPct - 10)">
        <span class="codicon codicon-sm codicon-zoom-out" />
      </button>
      <span class="text-xs text-fg-3 w-9 text-center">{{ fontPct }}%</span>
      <button class="btn text-xs" title="Larger text" @click="setFont(fontPct + 10)">
        <span class="codicon codicon-sm codicon-zoom-in" />
      </button>

      <!-- Highlight colors (enabled when text is selected) -->
      <span class="flex items-center gap-1 ml-1">
        <button
          v-for="c in HIGHLIGHT_COLORS"
          :key="c.value"
          class="w-4 h-4 rounded-full border border-border disabled:opacity-30"
          :style="{ backgroundColor: c.value }"
          :disabled="!selCfi"
          :title="selCfi ? `Highlight ${c.name}` : 'Select text to highlight'"
          @click="highlightSelection(c.value)"
        />
      </span>

      <span class="text-xs text-fg-3 flex-1 truncate">
        {{ chapterLabel }}<template v-if="chapterLabel"> · </template>{{ progressPct }}%
      </span>
      <button class="btn text-xs" @click="prev">
        <span class="codicon codicon-sm codicon-chevron-left" /> Prev
      </button>
      <button class="btn text-xs" @click="next">
        Next <span class="codicon codicon-sm codicon-chevron-right" />
      </button>
    </div>

    <div class="flex-1 flex min-h-0">
      <!-- Table of contents -->
      <div v-if="tocOpen && toc.length" class="w-72 shrink-0 border-r border-border bg-bg-1 panel-scroll py-2">
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

    <!-- Highlight popup -->
    <Teleport to="body">
      <div
        v-if="popup"
        class="fixed z-50 flex items-center gap-1.5 px-2 py-1.5 rounded border border-border bg-bg-1 shadow-lg"
        :style="{ left: `${popup.x - 60}px`, top: `${popup.y + 8}px` }"
      >
        <button
          v-for="c in HIGHLIGHT_COLORS"
          :key="c.value"
          class="w-4 h-4 rounded-full border border-border"
          :style="{ backgroundColor: c.value }"
          @click="recolor(c.value)"
        />
        <button class="text-fg-3 hover:text-removed ml-1" title="Delete highlight" @click="deleteAnnot">
          <span class="codicon codicon-sm codicon-trash" />
        </button>
      </div>
    </Teleport>
  </div>
</template>
