<script setup lang="ts">
/**
 * A picture, at a size you choose.
 *
 * It used to be `object-contain` and nothing else, which is the right way to
 * ARRIVE at an image and the wrong way to read one: a full-page screenshot is
 * a few thousand pixels tall, so fitting it to the pane makes every word in it
 * too small to read. Fit is still what you land on; zoom is what you do next.
 *
 * The arithmetic lives in lib/zoom — the ladder, the fit, and the scroll that
 * keeps the point under the cursor still — so it can be tested without a
 * browser.
 */
import { computed, ref, watch, onBeforeUnmount, nextTick } from 'vue'
import * as fs from '@/lib/fs'
import { mimeFor } from '@/lib/filetypes'
import { useFilesStore } from '@/stores/files'
import { anchoredScroll, clampZoom, fitZoom, stepZoom, wheelZoom, zoomLabel } from '@/lib/zoom'

const files = useFilesStore()
const url = ref<string | null>(null)

const pane = ref<HTMLElement | null>(null)
const natural = ref({ w: 0, h: 0 })
/** null = follow the pane: the picture is fitted, and stays fitted as it resizes. */
const manual = ref<number | null>(null)
const dragging = ref(false)
const paneSize = ref({ w: 0, h: 0 })

const fitted = computed(() => fitZoom(natural.value, paneSize.value))
const scale = computed(() => manual.value ?? fitted.value)
const isFit = computed(() => manual.value === null)
/** There is something to pan only once the picture is bigger than the pane. */
const pannable = computed(
  () =>
    natural.value.w * scale.value > paneSize.value.w + 1 ||
    natural.value.h * scale.value > paneSize.value.h + 1,
)

const imgStyle = computed(() => ({
  width: natural.value.w ? `${Math.round(natural.value.w * scale.value)}px` : 'auto',
  // Height follows from the width. Naming both invites a rounding mismatch,
  // which on a tall screenshot shows up as a squashed pixel row.
  height: 'auto',
}))

async function load(path: string | null): Promise<void> {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = null
  natural.value = { w: 0, h: 0 }
  manual.value = null // a new picture arrives fitted, whatever the last one was
  if (!path) return
  const buf = await fs.readBinary(path)
  url.value = URL.createObjectURL(new Blob([buf], { type: mimeFor(path) }))
}

function onLoad(e: Event): void {
  const img = e.target as HTMLImageElement
  natural.value = { w: img.naturalWidth, h: img.naturalHeight }
  measure()
}

function measure(): void {
  const el = pane.value
  if (el) paneSize.value = { w: el.clientWidth, h: el.clientHeight }
}

let ro: ResizeObserver | null = null
watch(pane, (el) => {
  ro?.disconnect()
  ro = null
  if (!el || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(measure)
  ro.observe(el)
  measure()
})

/** Change the scale, keeping `anchor` (a point in the pane) where it is. */
async function zoomTo(next: number, anchor?: { x: number; y: number }): Promise<void> {
  const el = pane.value
  const from = scale.value
  const to = clampZoom(next)
  if (to === from) return
  const point = anchor ?? { x: paneSize.value.w / 2, y: paneSize.value.h / 2 }
  const before = { left: el?.scrollLeft ?? 0, top: el?.scrollTop ?? 0 }
  manual.value = to
  await nextTick()
  if (!el) return
  const after = anchoredScroll(from, to, before, point)
  el.scrollLeft = after.left
  el.scrollTop = after.top
}

function pointIn(e: MouseEvent | WheelEvent): { x: number; y: number } {
  const box = pane.value?.getBoundingClientRect()
  return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) }
}

function onWheel(e: WheelEvent): void {
  // A plain wheel scrolls the picture, as it does everywhere else. Only a
  // trackpad pinch (which arrives as ctrl+wheel) or a held modifier zooms.
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  void zoomTo(wheelZoom(scale.value, e.deltaY), pointIn(e))
}

function step(direction: 1 | -1): void {
  void zoomTo(stepZoom(scale.value, direction))
}

function toggleFit(): void {
  manual.value = isFit.value ? 1 : null
}

/* ── drag to pan ────────────────────────────────────────────────────────── */

let grab: { x: number; y: number; left: number; top: number } | null = null

function onDown(e: MouseEvent): void {
  if (!pannable.value || e.button !== 0) return
  const el = pane.value
  if (!el) return
  e.preventDefault() // or the browser starts dragging the image as a file
  grab = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
  dragging.value = true
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp, { once: true })
}

function onMove(e: MouseEvent): void {
  const el = pane.value
  if (!el || !grab) return
  el.scrollLeft = grab.left - (e.clientX - grab.x)
  el.scrollTop = grab.top - (e.clientY - grab.y)
}

function onUp(): void {
  dragging.value = false
  grab = null
  window.removeEventListener('mousemove', onMove)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === '+' || e.key === '=') step(1)
  else if (e.key === '-' || e.key === '_') step(-1)
  else if (e.key === '0') manual.value = null
  else if (e.key === '1') manual.value = 1
  else return
  e.preventDefault()
}

watch(() => files.currentPath, load, { immediate: true })
onBeforeUnmount(() => {
  ro?.disconnect()
  onUp()
  if (url.value) URL.revokeObjectURL(url.value)
})
</script>

<template>
  <div class="relative h-full">
    <div
      ref="pane"
      class="h-full overflow-auto panel-scroll"
      tabindex="0"
      @wheel="onWheel"
      @mousedown="onDown"
      @dblclick="toggleFit"
      @keydown="onKey"
    >
      <div class="grid min-h-full place-items-center" style="width: max-content; min-width: 100%">
        <img
          v-if="url"
          :src="url"
          :style="imgStyle"
          class="block select-none rounded"
          :class="dragging ? 'cursor-grabbing' : pannable ? 'cursor-grab' : ''"
          draggable="false"
          @load="onLoad"
        />
      </div>
    </div>

    <div
      v-if="url && natural.w"
      class="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-border bg-bg-2/95 px-1 py-1 text-xs shadow-lg"
    >
      <button class="zoom-btn" :title="$t('viewers.image.zoomOut')" @click="step(-1)">−</button>
      <button
        class="min-w-14 rounded px-1 py-0.5 text-center tabular-nums text-fg-2 hover:text-fg-1"
        :title="$t('viewers.image.actual')"
        @click="manual = 1"
      >
        {{ zoomLabel(scale) }}
      </button>
      <button class="zoom-btn" :title="$t('viewers.image.zoomIn')" @click="step(1)">+</button>
      <button
        class="zoom-btn px-2"
        :class="isFit ? 'text-accent' : ''"
        :title="$t('viewers.image.fitHint')"
        @click="manual = null"
      >
        {{ $t('viewers.image.fit') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.zoom-btn {
  @apply rounded px-1.5 py-0.5 text-fg-2 hover:bg-bg-3 hover:text-fg-1;
}
</style>
