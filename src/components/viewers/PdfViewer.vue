<script setup lang="ts">
/**
 * Container for all open PDFs — trace-app's pattern: one <PdfDocument> is
 * mounted per open PDF tab and kept alive; only the active one is shown
 * (v-show). Switching between tabs is a visibility toggle — no reload, page
 * position kept, annotations stay live.
 */
import { computed } from 'vue'
import { useFilesStore } from '@/stores/files'
import { fileKind } from '@/lib/filetypes'
import PdfDocument from './PdfDocument.vue'

const files = useFilesStore()

const openPdfs = computed(() => files.openTabs.filter((p) => fileKind(p) === 'pdf'))
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
