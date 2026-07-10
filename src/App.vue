<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useThemeStore } from '@/stores/theme'
import OpenKbScreen from '@/components/OpenKbScreen.vue'
import AppLayout from '@/components/AppLayout.vue'

const kb = useKbStore()
const files = useFilesStore()
useThemeStore() // instantiate so the html[data-theme] effect runs

function onFocus(): void {
  void files.refreshOnFocus()
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    void files.flush()
  }
}

function onBeforeUnload(): void {
  // Best-effort flush; createWritable commits are async but usually complete.
  void files.flush()
}

onMounted(() => {
  void kb.refreshRecents()
  window.addEventListener('focus', onFocus)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocus)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <div class="h-full bg-bg-0 text-fg-1">
    <AppLayout v-if="kb.isOpen" />
    <OpenKbScreen v-else />
  </div>
</template>
