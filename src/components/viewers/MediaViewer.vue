<script setup lang="ts">
/**
 * Playback view for audio and video files. The browser's own controls do all
 * the work; we hand the element a disk-backed blob URL (`fs.getFile`, not
 * `readBinary`) so a long video streams from disk instead of being read into
 * memory first. A codec the browser can't decode (common for .mkv and some
 * .mov) surfaces as a plain message rather than a black rectangle.
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import * as fs from '@/lib/fs'
import { mimeFor, fileKind } from '@/lib/filetypes'
import { useFilesStore } from '@/stores/files'

const files = useFilesStore()
const url = ref<string | null>(null)
const kind = ref<'audio' | 'video'>('audio')
const failed = ref(false)
const name = ref('')

/** Guards against an earlier, slower load overwriting a later one. */
let loadToken = 0

async function load(path: string | null): Promise<void> {
  const token = ++loadToken
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = null
  failed.value = false
  if (!path) return
  const k = fileKind(path)
  if (k !== 'audio' && k !== 'video') return
  kind.value = k
  name.value = path.split('/').pop() ?? path
  try {
    const file = await fs.getFile(path)
    if (token !== loadToken) return
    // Re-wrap to pin the MIME type (the picked-up File often has none for the
    // rarer extensions); the new Blob references the same disk-backed bytes.
    url.value = URL.createObjectURL(new Blob([file], { type: mimeFor(path) }))
  } catch {
    if (token === loadToken) failed.value = true
  }
}

watch(() => files.currentPath, load, { immediate: true })
onBeforeUnmount(() => {
  if (url.value) URL.revokeObjectURL(url.value)
})
</script>

<template>
  <div class="h-full flex items-center justify-center p-6">
    <div v-if="failed" class="text-center text-fg-3 max-w-md">
      <span class="codicon codicon-lg codicon-warning block mb-2" />
      <p class="text-xs leading-relaxed">{{ $t('viewers.media.cantPlay', { name }) }}</p>
    </div>
    <video
      v-else-if="url && kind === 'video'"
      :src="url"
      controls
      class="max-w-full max-h-full rounded"
      @error="failed = true"
    />
    <audio v-else-if="url" :src="url" controls class="w-full max-w-xl" @error="failed = true" />
  </div>
</template>
