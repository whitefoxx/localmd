<script setup lang="ts">
/** Renders a KB image inline (loads its bytes as an object URL); click opens it
 *  full in the viewer. Used for generate_image results in the chat transcript. */
import { ref, watch, onUnmounted } from 'vue'
import * as fs from '@/lib/fs'
import { mimeFor } from '@/lib/filetypes'
import { useFilesStore } from '@/stores/files'

const props = defineProps<{ path: string }>()
const files = useFilesStore()
const url = ref('')
const failed = ref(false)

function revoke(): void {
  if (url.value) {
    URL.revokeObjectURL(url.value)
    url.value = ''
  }
}

async function load(path: string): Promise<void> {
  revoke()
  failed.value = false
  try {
    const buf = await fs.readBinary(path)
    url.value = URL.createObjectURL(new Blob([buf], { type: mimeFor(path) }))
  } catch {
    failed.value = true
  }
}

watch(() => props.path, (p) => void load(p), { immediate: true })
onUnmounted(revoke)
</script>

<template>
  <button
    v-if="url"
    class="block my-2 max-w-[320px] overflow-hidden rounded-lg border border-border hover:border-accent/50 transition-colors"
    :title="`${path} · ${$t('chat.openImage')}`"
    @click="files.openFile(path)"
  >
    <img :src="url" :alt="path" class="block w-full h-auto" />
  </button>
  <div v-else-if="failed" class="my-2 text-xs text-fg-3">{{ $t('chat.imageMissing') }}: {{ path }}</div>
</template>
