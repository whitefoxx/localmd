<script setup lang="ts">
/**
 * Container for all open PDFs — trace-app's pattern, lazily: a <PdfDocument>
 * is mounted the first time its tab comes on screen and kept alive from then
 * on; only the active one is shown (v-show). Switching back to a tab is a
 * visibility toggle — no reload, page position kept, annotations stay live.
 */
import { computed, reactive, watch } from 'vue'
import { useFilesStore } from '@/stores/files'
import { fileKind } from '@/lib/filetypes'
import PdfDocument from './PdfDocument.vue'

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
