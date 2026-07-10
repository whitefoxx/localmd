<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import ePub, { type Book, type Rendition } from 'epubjs'
import * as fs from '@/lib/fs'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { hasIndex, indexDocument } from '@/lib/docindex'
import { loadEpubLocations } from '@/lib/docindex/epub'

const files = useFilesStore()
const citations = useCitationsStore()

const host = ref<HTMLElement | null>(null)
const indexState = ref<'none' | 'indexing' | 'indexed'>('none')
const indexDetail = ref('')

let book: Book | null = null
let rendition: Rendition | null = null
let docPath: string | null = null
let lastHighlight: string | null = null

function destroy(): void {
  rendition?.destroy()
  book?.destroy()
  rendition = null
  book = null
  lastHighlight = null
}

async function load(path: string | null): Promise<void> {
  destroy()
  docPath = path
  if (!path || !host.value) return
  indexState.value = (await hasIndex(path)) ? 'indexed' : 'none'
  indexDetail.value = ''
  const buf = await fs.readBinary(path)
  book = ePub(buf)
  rendition = book.renderTo(host.value, { width: '100%', height: '100%' })
  await rendition.display()
  await maybeJump()
}

async function maybeJump(): Promise<void> {
  const pend = citations.pending
  if (!pend || pend.path !== docPath || !rendition) return
  if (pend.blockId) {
    const locs = await loadEpubLocations(pend.path)
    const cfi = locs?.blocks[pend.blockId]?.cfi
    if (cfi) {
      await rendition.display(cfi)
      if (lastHighlight) {
        try {
          rendition.annotations.remove(lastHighlight, 'highlight')
        } catch {
          /* already gone */
        }
      }
      rendition.annotations.highlight(cfi, {}, undefined, 'epub-hl', {
        fill: 'rgb(88 166 255)',
        'fill-opacity': '0.35',
      })
      lastHighlight = cfi
    }
  }
  citations.clear()
}

async function runIndex(): Promise<void> {
  if (!docPath || indexState.value === 'indexing') return
  indexState.value = 'indexing'
  try {
    const s = await indexDocument(docPath, (c, t) => {
      indexDetail.value = `${c}/${t}`
    })
    indexState.value = 'indexed'
    indexDetail.value = `${s.blockCount} blocks`
  } catch (err) {
    indexState.value = 'none'
    indexDetail.value = (err as Error).message
  }
}

watch(() => files.currentPath, load)
watch(host, () => void load(files.currentPath))
watch(
  () => citations.pending,
  () => void maybeJump(),
)
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
    <div class="flex items-center gap-3 h-10 px-3 border-t border-border shrink-0">
      <span class="text-xs text-fg-3 flex-1 truncate">{{ indexDetail }}</span>
      <button class="btn text-xs" @click="prev">
        <span class="codicon codicon-sm codicon-chevron-left" /> Prev
      </button>
      <button class="btn text-xs" @click="next">
        Next <span class="codicon codicon-sm codicon-chevron-right" />
      </button>
      <button class="btn text-xs" :disabled="indexState === 'indexing'" @click="runIndex">
        <span
          class="codicon codicon-sm mr-1"
          :class="{
            'codicon-sparkle': indexState === 'none',
            'codicon-loading codicon-modifier-spin': indexState === 'indexing',
            'codicon-check': indexState === 'indexed',
          }"
        />
        {{ indexState === 'indexed' ? 'Indexed' : indexState === 'indexing' ? 'Indexing…' : 'Index for AI' }}
      </button>
    </div>
  </div>
</template>
