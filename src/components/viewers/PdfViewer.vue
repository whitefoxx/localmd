<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import * as fs from '@/lib/fs'
import { useFilesStore } from '@/stores/files'

// Chrome/Edge render PDFs natively inside an iframe from a blob URL — no
// wasm viewer needed for plain reading.
const files = useFilesStore()
const url = ref<string | null>(null)

async function load(path: string | null): Promise<void> {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = null
  if (!path) return
  const buf = await fs.readBinary(path)
  url.value = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
}

watch(() => files.currentPath, load, { immediate: true })
onBeforeUnmount(() => {
  if (url.value) URL.revokeObjectURL(url.value)
})
</script>

<template>
  <iframe v-if="url" :src="url" class="w-full h-full border-0" />
</template>
