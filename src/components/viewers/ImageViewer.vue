<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import * as fs from '@/lib/fs'
import { mimeFor } from '@/lib/filetypes'
import { useFilesStore } from '@/stores/files'

const files = useFilesStore()
const url = ref<string | null>(null)

async function load(path: string | null): Promise<void> {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = null
  if (!path) return
  const buf = await fs.readBinary(path)
  url.value = URL.createObjectURL(new Blob([buf], { type: mimeFor(path) }))
}

watch(() => files.currentPath, load, { immediate: true })
onBeforeUnmount(() => {
  if (url.value) URL.revokeObjectURL(url.value)
})
</script>

<template>
  <div class="h-full flex items-center justify-center p-6 panel-scroll">
    <img v-if="url" :src="url" class="max-w-full max-h-full object-contain rounded" />
  </div>
</template>
