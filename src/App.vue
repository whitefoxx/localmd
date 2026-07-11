<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'
import { useGitStore } from '@/stores/git'
import OpenKbScreen from '@/components/OpenKbScreen.vue'
import AppLayout from '@/components/AppLayout.vue'

const kb = useKbStore()
const files = useFilesStore()
const ui = useUiStore()
const git = useGitStore()
useThemeStore() // instantiate so the html[data-theme] effect runs

function onFocus(): void {
  void files.refreshOnFocus()
  void git.refresh() // terminal commits/edits while the app was unfocused
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    void files.flush()
  } else if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'p')) {
    e.preventDefault()
    if (kb.isOpen) ui.searchOpen = !ui.searchOpen
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
    e.preventDefault()
    if (kb.isOpen) ui.sidebarOpen = !ui.sidebarOpen
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
    e.preventDefault()
    if (kb.isOpen) ui.agentOpen = !ui.agentOpen
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
