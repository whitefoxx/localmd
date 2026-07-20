<script setup lang="ts">
/**
 * Reading view for plain-text (.txt) files: the raw text in a comfortable serif
 * reading column, whitespace preserved and author line breaks kept (no reflow —
 * many .txt files are pre-wrapped). NO markdown parsing: `#`, `*`, `[[…]]` stay
 * literal, because a .txt is not markdown. Editing happens via the CodeMirror
 * pane (Edit/Preview toggle in the toolbar); this reading view is the default.
 */
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useFilesStore } from '@/stores/files'
import { previewScroll } from '@/lib/viewMemory'

const files = useFilesStore()
const scroller = ref<HTMLElement | null>(null)
let shownPath: string | null = null

function saveScroll(): void {
  if (shownPath && scroller.value) previewScroll.set(shownPath, scroller.value.scrollTop)
}

async function restoreScroll(): Promise<void> {
  await nextTick()
  if (scroller.value) {
    scroller.value.scrollTop = files.currentPath ? (previewScroll.get(files.currentPath) ?? 0) : 0
  }
  shownPath = files.currentPath
}

watch(
  () => files.currentPath,
  () => {
    saveScroll()
    void restoreScroll()
  },
)
onMounted(() => void restoreScroll())
onBeforeUnmount(saveScroll)
</script>

<template>
  <div ref="scroller" class="h-full panel-scroll">
    <pre class="txt-reader max-w-2xl mx-auto px-8 py-8 selectable">{{ files.content }}</pre>
  </div>
</template>
