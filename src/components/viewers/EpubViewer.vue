<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import ePub, { type Book, type Rendition } from 'epubjs'
import * as fs from '@/lib/fs'
import { useFilesStore } from '@/stores/files'

const files = useFilesStore()
const host = ref<HTMLElement | null>(null)
let book: Book | null = null
let rendition: Rendition | null = null

function destroy(): void {
  rendition?.destroy()
  book?.destroy()
  rendition = null
  book = null
}

async function load(path: string | null): Promise<void> {
  destroy()
  if (!path || !host.value) return
  const buf = await fs.readBinary(path)
  book = ePub(buf)
  rendition = book.renderTo(host.value, { width: '100%', height: '100%' })
  await rendition.display()
}

watch(() => files.currentPath, load)
watch(host, () => void load(files.currentPath))
onBeforeUnmount(destroy)

function prev(): void {
  void rendition?.prev()
}
function next(): void {
  void rendition?.next()
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex-1 min-h-0 bg-white" ref="host" />
    <div class="flex items-center justify-center gap-3 h-10 border-t border-border shrink-0">
      <button class="btn text-xs" @click="prev">
        <span class="codicon codicon-sm codicon-chevron-left" /> Prev
      </button>
      <button class="btn text-xs" @click="next">
        Next <span class="codicon codicon-sm codicon-chevron-right" />
      </button>
    </div>
  </div>
</template>
