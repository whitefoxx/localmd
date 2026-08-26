<script setup lang="ts">
/**
 * Container for all open PDFs, lazily: a <PdfDocument> is mounted the first
 * time its tab comes on screen and kept alive from then
 * on; only the active one is shown (v-show). Switching back to a tab is a
 * visibility toggle — no reload, page position kept, annotations stay live.
 */
import { computed, defineAsyncComponent, h, reactive, watch } from 'vue'
import { useFilesStore } from '@/stores/files'
import { fileKind } from '@/lib/filetypes'
import { t } from '@/i18n'

/**
 * The reader is fetched on first use. It is the heaviest thing in the app —
 * the pdfium-backed engine plus pdf.js came to ~1.5MB of the main chunk — and
 * this container is the single door to it, so deferring it here costs a
 * knowledge base that never opens a PDF nothing at all.
 *
 * Safe precisely because of the `seen` set below: a <PdfDocument> is only ever
 * created for a PDF that has been on screen, so the import fires on the same
 * gesture that already pays to read and parse a file. Nothing about the
 * keep-alive behaviour changes — once mounted it stays mounted, and the chunk
 * is in the module registry (and the service worker's precache) from then on.
 *
 * The loading state is the document's own mask minus the document: the chunk
 * arriving and the file being read are one wait to the reader, so they must
 * not look like two. Vue's default 200ms delay before showing it means a
 * cached chunk produces no flash.
 */
const PdfDocument = defineAsyncComponent({
  loader: () => import('./PdfDocument.vue'),
  loadingComponent: () =>
    h('div', { class: 'absolute inset-0 z-10 bg-bg-1' }, [
      h(
        'div',
        {
          class:
            'absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-border bg-bg-2 px-3 py-1.5 text-xs text-fg-3 shadow',
        },
        [
          h('span', { class: 'codicon codicon-sm codicon-loading codicon-modifier-spin' }),
          t('viewers.pdf.loading'),
        ],
      ),
    ]),
})

const files = useFilesStore()

/**
 * Only PDFs that have been ON SCREEN at least once are mounted. Mounting is
 * expensive — a wasm engine instance, a full read of the file, a parse — and
 * restoring a window with several PDF tabs used to pay all of that at boot,
 * simultaneously, for documents nobody was looking at. A background tab now
 * costs nothing until its first activation; after that it stays mounted and
 * keeps the keep-alive behaviour described above.
 */
const seen = reactive(new Set<string>())
watch(
  () => files.currentPath,
  (p) => {
    if (p && fileKind(p) === 'pdf') seen.add(p)
  },
  { immediate: true },
)

const openPdfs = computed(() => files.openTabs.filter((p) => fileKind(p) === 'pdf' && seen.has(p)))
</script>

<template>
  <div class="h-full w-full bg-bg-0 relative">
    <div
      v-for="p in openPdfs"
      :key="p"
      v-show="p === files.currentPath"
      class="absolute inset-0"
    >
      <PdfDocument :path="p" />
    </div>
  </div>
</template>
