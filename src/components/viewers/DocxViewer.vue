<script setup lang="ts">
/**
 * Reading view for Word .docx files. The same extractor the indexer uses turns
 * the document into semantic HTML, so a citation's `[[block-id]]` resolves to a
 * `data-bid` element here — no separate location map is needed. Prose styling
 * is shared with the markdown preview (`.md-preview`); `.docx-reader` only adds
 * what a Word document brings along (wide tables, embedded images).
 *
 * The legacy binary .doc format is not OOXML and cannot be parsed in the
 * browser; it opens here too, and says so.
 */
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import * as fs from '@/lib/fs'
import { previewScroll } from '@/lib/viewMemory'
import { hasIndex, indexDocument } from '@/lib/docindex'
import { t } from '@/i18n'

const files = useFilesStore()
const citations = useCitationsStore()

const scroller = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const html = ref('')
const loading = ref(false)
const error = ref('')
const legacy = ref(false)
const indexMsg = ref('')
const indexFailed = ref(false)

/** The path currently rendered — scroll memory and citation jumps key off it. */
let shownPath: string | null = null
/** Guards against an earlier, slower load overwriting a later one. */
let loadToken = 0
let objectUrls: string[] = []
let msgTimer: number | null = null

function releaseMedia(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls = []
}

function saveScroll(): void {
  if (shownPath && scroller.value) previewScroll.set(shownPath, scroller.value.scrollTop)
}

async function load(path: string | null): Promise<void> {
  saveScroll()
  const token = ++loadToken
  releaseMedia()
  html.value = ''
  error.value = ''
  legacy.value = false
  indexMsg.value = ''
  indexFailed.value = false
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
      html.value = doc.html
      await nextTick()
      if (token !== loadToken) return
      attachMedia(doc.media)
      restoreScroll(path)
      void maybeReveal()
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

/** Point every `<img data-media>` at a blob URL for the image in the package. */
function attachMedia(media: Map<string, Blob>): void {
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

function restoreScroll(path: string): void {
  if (scroller.value) scroller.value.scrollTop = previewScroll.get(path) ?? 0
}

/**
 * Index on open, like the PDF and EPUB viewers — a document the agent can't
 * cite is half-open. Silent on success; a failure says so rather than leaving
 * the user to wonder why the agent can't see the file.
 */
async function autoIndex(path: string, token: number): Promise<void> {
  if (await hasIndex(path)) return
  if (token !== loadToken) return
  indexMsg.value = t('viewers.docx.indexing')
  try {
    const summary = await indexDocument(path)
    if (token !== loadToken) return
    indexMsg.value = t('viewers.docx.indexed', { n: summary.blockCount })
    msgTimer = window.setTimeout(() => (indexMsg.value = ''), 4000)
  } catch (err) {
    if (token !== loadToken) return
    indexFailed.value = true
    indexMsg.value = (err as Error).message || t('viewers.docx.indexFailed')
  }
}

/** Scroll to and flash the block a citation chip points at. */
async function maybeReveal(): Promise<void> {
  const pending = citations.pending
  if (!pending || pending.path !== shownPath) return
  if (pending.blockId) {
    await nextTick()
    const el = body.value?.querySelector<HTMLElement>(
      `[data-bid="${CSS.escape(pending.blockId)}"]`,
    )
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.remove('docx-flash')
      void el.offsetWidth // restart the animation on a repeat jump
      el.classList.add('docx-flash')
    }
  }
  citations.clear()
}

watch(() => files.currentPath, load)
watch(() => citations.pending, () => void maybeReveal())
onMounted(() => void load(files.currentPath))
onBeforeUnmount(() => {
  saveScroll()
  releaseMedia()
  if (msgTimer !== null) window.clearTimeout(msgTimer)
})
</script>

<template>
  <div class="h-full relative">
    <div
      v-if="indexMsg"
      class="absolute top-2 right-4 z-10 px-2 py-1 rounded border border-border bg-bg-2 text-xs shadow-sm"
      :class="indexFailed ? 'text-removed' : 'text-fg-3'"
    >
      {{ indexMsg }}
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

      <!-- eslint-disable-next-line vue/no-v-html — extractor-escaped, no raw docx text reaches the DOM -->
      <div
        v-else
        ref="body"
        class="md-preview docx-reader max-w-3xl mx-auto px-8 py-8 selectable"
        v-html="html"
      />
    </div>
  </div>
</template>
