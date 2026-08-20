<script setup lang="ts">
/**
 * Reading view for Word .docx files. The same extractor the indexer uses turns
 * the document into semantic HTML, so a citation's `[[block-id]]` resolves to a
 * `data-bid` element here — no separate location map is needed. Prose styling
 * is shared with the markdown preview (`.md-preview`); `.docx-reader` only adds
 * what a Word document brings along (wide tables, embedded images, marks).
 *
 * Highlights/underlines/notes work as in the PDF and EPUB readers and land in
 * the same `<source>.annotations.json` sidecar, located by block-offset range
 * (see lib/docxMarks.ts). The rendered HTML is kept pristine in `pristineHtml`
 * and marks are drawn on top of it, so redrawing is always "clear, then draw
 * all" — no incremental DOM bookkeeping to get wrong.
 *
 * The legacy binary .doc format is not OOXML and cannot be parsed in the
 * browser; it opens here too, and says so.
 */
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { useTtsStore } from '@/stores/tts'
import { READ_ALOUD_ENABLED } from '@/lib/tts'
import * as fs from '@/lib/fs'
import { previewScroll } from '@/lib/viewMemory'
import { useMarkPopupPosition } from '@/composables/useMarkPopupPosition'
import { hasIndex, indexDocument, indexState as queryIndexState } from '@/lib/docindex'
import {
  HIGHLIGHT_COLORS,
  UNDERLINE_COLOR,
  loadDocxSidecar,
  saveDocxSidecar,
  sidecarPath,
  sidecarRevision,
  type DocxAnnotation,
} from '@/lib/annotations'
import {
  clearMarks,
  drawMark,
  formatDocxRange,
  markSpans,
  rangeFromSelection,
  type MarkStyle,
} from '@/lib/docxMarks'
import NoteDialog from '@/components/NoteDialog.vue'
import { t } from '@/i18n'

const files = useFilesStore()
const citations = useCitationsStore()
const tts = useTtsStore()

const scroller = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const loading = ref(false)
const error = ref('')
const legacy = ref(false)
const ready = ref(false)
const indexMsg = ref('')
const indexFailed = ref(false)
// Older-algorithm index: usable as is; the badge offers a rebuild.
const indexOutdated = ref(false)

/** The path currently rendered — scroll memory and jumps key off it. */
let shownPath: string | null = null
/** Guards against an earlier, slower load overwriting a later one. */
let loadToken = 0
let pristineHtml = ''
let media = new Map<string, Blob>()
let objectUrls: string[] = []
let msgTimer: number | null = null

let annotations: DocxAnnotation[] = []
/** Text of the live selection, stashed for the mark we are about to create. */
let selectedText = ''
const popup = ref<{ x: number; y: number; id: string; existing: boolean } | null>(null)
const { el: popupEl, style: popupStyle } = useMarkPopupPosition(popup, scroller)
const noteEditor = ref<{
  id: string
  excerpt: string
  note: string
  color: string
  style: MarkStyle
} | null>(null)

/* ── loading ─────────────────────────────────────────────────────────────── */

async function load(path: string | null): Promise<void> {
  saveScroll()
  const token = ++loadToken
  releaseMedia()
  resetState()
  shownPath = path
  if (!path) return

  loading.value = true
  try {
    const [{ extractDocx, LegacyDocError }, bytes] = await Promise.all([
      import('@/lib/docindex/docx/extract'),
      fs.readBinary(path),
    ])
    if (token !== loadToken) return
    try {
      const doc = await extractDocx(bytes, path.split('/').pop() ?? path)
      if (token !== loadToken) return
      pristineHtml = doc.html
      media = doc.media
      annotations = await loadDocxSidecar(path)
      if (token !== loadToken) return
      loading.value = false
      ready.value = true
      await nextTick()
      if (token !== loadToken) return
      render()
      restoreScroll(path)
      void maybeJump()
      void autoIndex(path, token)
    } catch (err) {
      if (err instanceof LegacyDocError) legacy.value = true
      else throw err
    }
  } catch (err) {
    if (token === loadToken) error.value = (err as Error).message || t('viewers.docx.loadFailed')
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function resetState(): void {
  pristineHtml = ''
  annotations = []
  media = new Map()
  error.value = ''
  legacy.value = false
  ready.value = false
  indexMsg.value = ''
  indexFailed.value = false
  indexOutdated.value = false
  popup.value = null
  noteEditor.value = null
  if (body.value) body.value.innerHTML = ''
}

/** Draw the document, then every mark on top of it. */
function render(): void {
  const host = body.value
  if (!host) return
  host.innerHTML = pristineHtml
  attachMedia()
  drawAllMarks()
}

/** Redraw marks only — the document itself is untouched. */
function drawAllMarks(): void {
  const host = body.value
  if (!host) return
  clearMarks(host)
  for (const a of annotations) {
    drawMark(host, {
      id: a.range,
      color: a.style === 'underline' ? UNDERLINE_COLOR : a.color,
      style: a.style ?? 'highlight',
      hasNote: !!a.note,
    })
  }
}

/** Point every `<img data-media>` at a blob URL for the image in the package. */
function attachMedia(): void {
  const imgs = body.value?.querySelectorAll<HTMLImageElement>('img[data-media]') ?? []
  for (const img of imgs) {
    const blob = media.get(img.dataset.media ?? '')
    if (!blob) {
      img.remove()
      continue
    }
    const url = URL.createObjectURL(blob)
    objectUrls.push(url)
    img.src = url
  }
}

function releaseMedia(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls = []
}

function saveScroll(): void {
  if (shownPath && scroller.value) previewScroll.set(shownPath, scroller.value.scrollTop)
}

function restoreScroll(path: string): void {
  if (scroller.value) scroller.value.scrollTop = previewScroll.get(path) ?? 0
}

/**
 * Index on open, like the PDF and EPUB viewers — a document the agent can't
 * cite is half-open. Silent on success; a failure says so rather than leaving
 * the user to wonder why the agent can't see the file.
 */
async function autoIndex(path: string, token: number): Promise<void> {
  if (await hasIndex(path)) {
    const state = await queryIndexState(path)
    if (token === loadToken) indexOutdated.value = state === 'outdated'
    return
  }
  if (token !== loadToken) return
  await runIndex(path, token, false)
}

/** The badge's click — rebuild the current document's index. */
function rebuildIndex(): void {
  const path = files.currentPath
  if (path) void runIndex(path, loadToken, true)
}

/** Index (or, on the badge's click, rebuild) with progress in the pill. */
async function runIndex(path: string, token: number, rebuild: boolean): Promise<void> {
  indexMsg.value = t('viewers.docx.indexing')
  try {
    const summary = await indexDocument(path, undefined, { rebuild })
    if (token !== loadToken) return
    if (!summary.cached) indexOutdated.value = false
    indexMsg.value = t('viewers.docx.indexed', { n: summary.blockCount })
    msgTimer = window.setTimeout(() => (indexMsg.value = ''), 4000)
  } catch (err) {
    if (token !== loadToken) return
    indexFailed.value = true
    indexMsg.value = (err as Error).message || t('viewers.docx.indexFailed')
  }
}

/* ── annotations ─────────────────────────────────────────────────────────── */

/** Any new gesture outside the popup dismisses it; the mouseup may reopen it. */
function onDocumentPointerDown(e: MouseEvent): void {
  if ((e.target as HTMLElement | null)?.closest('.bm-popup')) return
  popup.value = null
}

/**
 * Work out what the finished gesture meant, one tick late: clicking inside an
 * existing selection only collapses it *after* mouseup, so reading the
 * selection synchronously would re-open the popup the mousedown just closed.
 */
function onPointerUp(e: MouseEvent): void {
  const span = (e.target as HTMLElement | null)?.closest<HTMLElement>('.docx-mark') ?? null
  window.setTimeout(() => settleGesture(span), 0)
}

function settleGesture(span: HTMLElement | null): void {
  const host = body.value
  if (!host) return

  // A live selection wins: offer to mark it.
  const hit = rangeFromSelection(host, window.getSelection())
  if (hit) {
    const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect()
    if (!rect || rect.width === 0) return
    selectedText = hit.text
    const id = formatDocxRange(hit.range)
    popup.value = {
      x: rect.left + rect.width / 2,
      y: rect.bottom,
      id,
      existing: annotations.some((a) => a.range === id),
    }
    return
  }

  // Otherwise a plain click on an existing mark reopens it — a mark carrying a
  // note goes straight to the note, like the PDF and EPUB readers.
  if (!span) return
  const id = span.dataset.anno ?? ''
  const existing = annotations.find((a) => a.range === id)
  if (existing?.note) {
    openNoteEditor(id)
    return
  }
  const rect = span.getBoundingClientRect()
  selectedText = existing?.text ?? ''
  popup.value = { x: rect.left + rect.width / 2, y: rect.bottom, id, existing: true }
}

/** Create or restyle a mark, then persist. */
async function applyMark(id: string, color: string, style: MarkStyle): Promise<void> {
  if (!shownPath) return
  const existing = annotations.find((a) => a.range === id)
  if (existing) {
    existing.color = color
    existing.style = style
  } else {
    annotations.push({
      range: id,
      color,
      text: selectedText,
      createdAt: new Date().toISOString(),
      style,
    })
  }
  drawAllMarks()
  window.getSelection()?.removeAllRanges()
  popup.value = null
  await saveDocxSidecar(shownPath, annotations)
}

function pickColor(color: string): void {
  if (popup.value) void applyMark(popup.value.id, color, 'highlight')
}

/** The "U" button always underlines in red — no color choice for underlines. */
function underlineSelection(): void {
  if (popup.value) void applyMark(popup.value.id, UNDERLINE_COLOR, 'underline')
}

function speakSelection(): void {
  const text = selectedText || window.getSelection()?.toString().trim()
  if (text) tts.speak(text, t('viewers.selection'))
  popup.value = null
}

async function deleteAnnot(): Promise<void> {
  const id = popup.value?.id
  if (!id || !shownPath) return
  annotations = annotations.filter((a) => a.range !== id)
  popup.value = null
  drawAllMarks()
  await saveDocxSidecar(shownPath, annotations)
}

/** The mark exists while the note dialog is open (created now for a fresh
 *  selection), so color/underline act live; only the text is saved explicitly. */
function openNoteEditor(id: string): void {
  popup.value = null
  const existing = annotations.find((a) => a.range === id)
  if (!existing) void applyMark(id, HIGHLIGHT_COLORS[0].value, 'highlight')
  noteEditor.value = {
    id,
    excerpt: existing?.text ?? selectedText,
    note: existing?.note ?? '',
    color: existing && existing.style !== 'underline' ? existing.color : HIGHLIGHT_COLORS[0].value,
    style: existing?.style ?? 'highlight',
  }
}

function readNoteExcerpt(): void {
  if (noteEditor.value?.excerpt) tts.speak(noteEditor.value.excerpt, t('viewers.selection'))
}

function noteRecolor(color: string): void {
  const ed = noteEditor.value
  if (!ed) return
  void applyMark(ed.id, color, 'highlight')
  noteEditor.value = { ...ed, color, style: 'highlight' }
}

function noteUnderline(): void {
  const ed = noteEditor.value
  if (!ed) return
  void applyMark(ed.id, ed.color, 'underline')
  noteEditor.value = { ...ed, style: 'underline' }
}

function saveNoteText(note: string): void {
  const ed = noteEditor.value
  if (!ed || !shownPath) return
  const a = annotations.find((x) => x.range === ed.id)
  if (!a) return
  if (note) a.note = note
  else delete a.note
  drawAllMarks()
  void saveDocxSidecar(shownPath, annotations)
}

async function deleteNote(): Promise<void> {
  const ed = noteEditor.value
  if (!ed || !shownPath) return
  noteEditor.value = null
  annotations = annotations.filter((a) => a.range !== ed.id)
  drawAllMarks()
  await saveDocxSidecar(shownPath, annotations)
}

function viewAnnotations(): void {
  if (shownPath) void files.openFile(sidecarPath(shownPath))
}

/* ── jumps ───────────────────────────────────────────────────────────────── */

/** Scroll to and flash a cited block, or a mark reached from the annotations page. */
async function maybeJump(): Promise<void> {
  const pending = citations.pending
  if (!pending || pending.path !== shownPath) return
  // Not rendered yet — leave the jump pending; load() calls back once it is.
  const host = body.value
  if (!ready.value || !host) return
  await nextTick()
  const target = pending.annotation?.range
    ? markSpans(host, pending.annotation.range)[0]
    : pending.blockId
      ? host.querySelector<HTMLElement>(`[data-bid="${CSS.escape(pending.blockId)}"]`)
      : null
  if (target) {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    target.classList.remove('docx-flash')
    void target.offsetWidth // restart the animation on a repeat jump
    target.classList.add('docx-flash')
  }
  citations.clear()
}

watch(() => files.currentPath, load)
watch(() => citations.pending, () => void maybeJump())
// The annotations page (or a hand-edit of the sidecar) saved while we were
// showing this document — reload the marks from disk.
watch(sidecarRevision, async (rev) => {
  if (!rev || !shownPath || rev.source !== shownPath) return
  annotations = await loadDocxSidecar(shownPath)
  drawAllMarks()
})
onMounted(() => {
  document.addEventListener('mousedown', onDocumentPointerDown)
  void load(files.currentPath)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPointerDown)
  saveScroll()
  releaseMedia()
  if (msgTimer !== null) window.clearTimeout(msgTimer)
})
</script>

<template>
  <div class="h-full relative">
    <div class="absolute top-2 right-4 z-10 flex items-center gap-2">
      <div
        v-if="indexMsg"
        class="px-2 py-1 rounded border border-border bg-bg-2 text-xs shadow-sm"
        :class="indexFailed ? 'text-removed' : 'text-fg-3'"
      >
        {{ indexMsg }}
      </div>
      <button
        v-if="indexOutdated"
        class="btn text-xs shadow-sm"
        :title="$t('viewers.index.updateHint')"
        @click="rebuildIndex"
      >
        <span class="codicon codicon-sm codicon-refresh" />
        {{ $t('viewers.index.updateAvailable') }}
      </button>
      <button
        v-if="ready"
        class="btn text-xs shadow-sm"
        :title="$t('viewers.docx.viewAnnotations')"
        @click="viewAnnotations"
      >
        <span class="codicon codicon-sm codicon-list-selection" />
      </button>
    </div>

    <div ref="scroller" class="h-full panel-scroll" @scroll="saveScroll">
      <div v-if="loading" class="flex items-center justify-center h-full gap-2 text-sm text-fg-3">
        <span class="codicon codicon-sm codicon-loading codicon-modifier-spin" />
        {{ $t('viewers.docx.loading') }}
      </div>

      <div v-else-if="legacy" class="flex items-center justify-center h-full text-fg-3">
        <div class="text-center max-w-md px-6">
          <span class="codicon codicon-lg codicon-file block mb-2" />
          <div class="text-fg-1 mb-1">{{ $t('viewers.docx.legacyTitle') }}</div>
          <p class="text-xs leading-relaxed">{{ $t('viewers.docx.legacyHint') }}</p>
        </div>
      </div>

      <div v-else-if="error" class="flex items-center justify-center h-full text-fg-3">
        <div class="text-center max-w-md px-6">
          <span class="codicon codicon-lg codicon-warning block mb-2" />
          <p class="text-xs leading-relaxed">{{ error }}</p>
        </div>
      </div>

      <!-- Content is written imperatively (see render()) so marks can be drawn
           on top of it without Vue reclaiming the subtree. -->
      <div
        v-show="ready"
        ref="body"
        class="md-preview docx-reader max-w-3xl mx-auto px-8 py-8 selectable"
        @mouseup="onPointerUp"
      />
    </div>

    <!-- Mark popup: color swatches + read aloud + underline + note + delete -->
    <Teleport to="body">
      <div
        v-if="popup"
        ref="popupEl"
        class="bm-popup fixed z-50 flex items-center gap-1.5 px-2 py-1.5 rounded border border-border bg-bg-1 shadow-lg"
        :style="popupStyle"
        @mousedown.prevent
      >
        <button
          v-for="c in HIGHLIGHT_COLORS"
          :key="c.value"
          class="w-5 h-5 rounded-full border border-border transition-transform hover:scale-110"
          :style="{ backgroundColor: c.value }"
          :title="$t('viewers.docx.highlightColor', { name: c.name })"
          @click="pickColor(c.value)"
        />
        <span class="w-px h-4 bg-border mx-0.5" />
        <button
          v-if="READ_ALOUD_ENABLED"
          class="w-6 h-5 rounded flex items-center justify-center text-fg-3 hover:text-fg-1"
          :title="$t('viewers.docx.readSelection')"
          @click="speakSelection"
        >
          <span class="codicon codicon-sm codicon-unmute" />
        </button>
        <button
          class="w-6 h-5 rounded flex items-center justify-center leading-none text-fg-3 hover:text-fg-1"
          :title="$t('viewers.docx.underlineRed')"
          @click="underlineSelection"
        >
          <span
            class="text-xs font-semibold underline underline-offset-2"
            :style="{ color: UNDERLINE_COLOR }"
            >U</span
          >
        </button>
        <button
          class="w-6 h-5 rounded flex items-center justify-center text-fg-3 hover:text-fg-1"
          :title="$t('viewers.docx.note')"
          @click="openNoteEditor(popup.id)"
        >
          <span class="codicon codicon-sm codicon-note" />
        </button>
        <button
          v-if="popup.existing"
          class="text-fg-3 hover:text-removed ml-0.5"
          :title="$t('viewers.docx.deleteMark')"
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
