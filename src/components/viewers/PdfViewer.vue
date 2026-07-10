<script setup lang="ts">
/**
 * pdf.js-rendered viewer (replaces the earlier Chrome-native iframe): pages
 * render lazily into canvases, and citation jumps scroll to a block and
 * highlight its rects from the index's locations.json.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as fs from '@/lib/fs'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { hasIndex, indexDocument } from '@/lib/docindex'
import { loadPdfLocations } from '@/lib/docindex/pdf'
import { pdfScroll } from '@/lib/viewMemory'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const files = useFilesStore()
const citations = useCitationsStore()

const container = ref<HTMLElement | null>(null)
const indexState = ref<'none' | 'indexing' | 'indexed'>('none')
const indexDetail = ref('')

let doc: pdfjs.PDFDocumentProxy | null = null
let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null
let observer: IntersectionObserver | null = null
let pageEls: HTMLElement[] = []
const renderedPages = new Set<number>()
let renderScale = 1.5
let docPath: string | null = null

async function destroy(): Promise<void> {
  if (docPath && container.value) pdfScroll.set(docPath, container.value.scrollTop)
  observer?.disconnect()
  observer = null
  renderedPages.clear()
  pageEls = []
  if (container.value) container.value.innerHTML = ''
  doc = null
  if (loadingTask) {
    await loadingTask.destroy().catch(() => {})
    loadingTask = null
  }
}

async function load(path: string | null): Promise<void> {
  await destroy()
  docPath = path
  if (!path || !container.value) return

  indexState.value = (await hasIndex(path)) ? 'indexed' : 'none'
  indexDetail.value = ''

  const data = await fs.readBinary(path)
  loadingTask = pdfjs.getDocument({ data })
  doc = await loadingTask.promise
  if (docPath !== path || !container.value) return // switched away while loading

  const first = await doc.getPage(1)
  const vp1 = first.getViewport({ scale: 1 })
  const cw = container.value.clientWidth - 48
  renderScale = Math.min(2, Math.max(0.6, cw / vp1.width))

  observer = new IntersectionObserver(onIntersect, {
    root: container.value,
    rootMargin: '600px',
  })
  for (let p = 1; p <= doc.numPages; p++) {
    const wrap = document.createElement('div')
    wrap.className = 'pdf-page'
    wrap.dataset.page = String(p)
    // Placeholder sized from page 1; corrected to the real size at render time.
    wrap.style.width = `${vp1.width * renderScale}px`
    wrap.style.height = `${vp1.height * renderScale}px`
    container.value.appendChild(wrap)
    pageEls.push(wrap)
    observer.observe(wrap)
  }
  const saved = pdfScroll.get(path)
  if (saved != null) container.value.scrollTop = saved
  await maybeJump()
}

function onIntersect(entries: IntersectionObserverEntry[]): void {
  for (const e of entries) {
    if (!e.isIntersecting) continue
    const p = Number((e.target as HTMLElement).dataset.page)
    if (!renderedPages.has(p)) {
      renderedPages.add(p)
      void renderPage(p)
    }
  }
}

async function renderPage(p: number): Promise<void> {
  if (!doc) return
  const wrap = pageEls[p - 1]
  const page = await doc.getPage(p)
  const vp = page.getViewport({ scale: renderScale })
  const dpr = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(vp.width * dpr)
  canvas.height = Math.floor(vp.height * dpr)
  canvas.style.width = `${vp.width}px`
  canvas.style.height = `${vp.height}px`
  wrap.style.width = `${vp.width}px`
  wrap.style.height = `${vp.height}px`
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
  wrap.appendChild(canvas)
}

/** Scroll to a cited block and flash its line rects. */
async function jump(blockId: string): Promise<void> {
  if (!docPath || !container.value) return
  const locs = await loadPdfLocations(docPath)
  const loc = locs?.blocks[blockId]
  if (!loc) return
  const wrap = pageEls[loc.page - 1]
  if (!wrap) return

  container.value.querySelectorAll('.pdf-hl').forEach((el) => el.remove())
  const W = wrap.clientWidth
  const H = wrap.clientHeight
  let topInPage = H
  for (const r of loc.rects) {
    const hl = document.createElement('div')
    hl.className = 'pdf-hl'
    hl.style.left = `${r.x * W - 2}px`
    hl.style.top = `${r.y * H - 2}px`
    hl.style.width = `${r.w * W + 4}px`
    hl.style.height = `${r.h * H + 4}px`
    wrap.appendChild(hl)
    topInPage = Math.min(topInPage, r.y * H)
  }
  container.value.scrollTop = wrap.offsetTop + topInPage - 120
}

async function maybeJump(): Promise<void> {
  const pend = citations.pending
  if (!pend || pend.path !== docPath || !doc) return
  if (pend.blockId) await jump(pend.blockId)
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

onMounted(() => void load(files.currentPath))
watch(
  () => files.currentPath,
  (p) => void load(p),
)
watch(
  () => citations.pending,
  () => void maybeJump(),
)
onBeforeUnmount(() => void destroy())
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center gap-2 px-3 h-9 border-b border-border shrink-0">
      <span class="text-xs text-fg-3 flex-1 truncate">{{ files.currentPath }}</span>
      <span v-if="indexDetail" class="text-xs text-fg-3">{{ indexDetail }}</span>
      <button
        class="btn text-xs"
        :disabled="indexState === 'indexing'"
        :title="indexState === 'indexed' ? 'Refresh the AI index' : 'Generate the AI index'"
        @click="runIndex"
      >
        <span
          class="codicon codicon-sm mr-1"
          :class="{
            'codicon-sparkle': indexState === 'none',
            'codicon-loading codicon-modifier-spin': indexState === 'indexing',
            'codicon-check': indexState === 'indexed',
          }"
        />
        {{ indexState === 'indexed' ? 'Indexed' : indexState === 'indexing' ? 'Indexing…' : 'Index for AI' }}
      </button>
    </div>
    <div ref="container" class="flex-1 panel-scroll bg-bg-1 py-3 relative" />
  </div>
</template>
