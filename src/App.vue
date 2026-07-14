<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'
import { useGitStore } from '@/stores/git'
import { useReviewStore } from '@/stores/review'
import { useChatStore } from '@/stores/chat'
import OpenKbScreen from '@/components/OpenKbScreen.vue'
import AppLayout from '@/components/AppLayout.vue'
import {
  newFileInteractive,
  moveInteractive,
  deleteSelectedInteractive,
} from '@/lib/fileOps'

const kb = useKbStore()
const files = useFilesStore()
const ui = useUiStore()
const git = useGitStore()
useThemeStore() // instantiate so the html[data-theme] effect runs

function onFocus(): void {
  void files.refreshOnFocus()
  void git.refresh() // terminal commits/edits while the app was unfocused
}

/** Typing surfaces where value-editing hotkeys (⌘Enter toggle) must not fire. */
function inEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function onKeydown(e: KeyboardEvent): void {
  // A component already consumed this key (e.g. CodeMirror's ⌘[ indent).
  if (e.defaultPrevented) return
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key === 's') {
    e.preventDefault()
    void files.flush()
  } else if (mod && (e.key === 'k' || e.key === 'p')) {
    e.preventDefault()
    if (kb.isOpen) ui.searchOpen = !ui.searchOpen
  } else if (mod && e.key === 'b') {
    e.preventDefault()
    if (kb.isOpen) ui.sidebarOpen = !ui.sidebarOpen
  } else if (mod && e.key === 'j') {
    e.preventDefault()
    if (kb.isOpen) ui.agentOpen = !ui.agentOpen
  } else if (mod && !e.shiftKey && e.code === 'KeyN') {
    // ⌘N is reserved by Chrome (new window) in regular tabs, so ⌥⌘N is the
    // reliable binding; plain ⌘N still works where the browser lets it
    // through (installed PWA windows). e.code because ⌥ remaps e.key on mac.
    e.preventDefault()
    if (kb.isOpen) void newFileInteractive()
  } else if (mod && !e.shiftKey && e.code === 'KeyM') {
    // ⌘M is macOS "minimize window" — ⌥⌘M / Ctrl+M are the reliable forms.
    e.preventDefault()
    if (kb.isOpen) void moveInteractive()
  } else if (mod && e.key === 'd') {
    e.preventDefault()
    if (kb.isOpen) void deleteSelectedInteractive()
  } else if (mod && e.key === 'Enter' && !inEditable(e.target)) {
    e.preventDefault()
    if (kb.isOpen) ui.agentOpen = !ui.agentOpen
  } else if (mod && (e.key === '[' || e.key === ']')) {
    e.preventDefault()
    if (kb.isOpen) void files.cycleTab(e.key === ']' ? 1 : -1)
  } else if (mod && e.code === 'Backquote') {
    // ⌘` is macOS window cycling — Ctrl+` / ⌥⌘` are the reliable forms.
    e.preventDefault()
    if (kb.isOpen) ui.sidebarOpen = !ui.sidebarOpen
  } else if (e.key === 'Escape') {
    closeTopLayer()
  }
}

/** Esc closes the top-most open layer, one per press: search → settings →
 *  git → review → health → chat history → graph. (SearchPalette also handles
 *  Esc itself while its input has focus — this is the fallback.) */
function closeTopLayer(): void {
  const review = useReviewStore()
  const chat = useChatStore()
  if (ui.searchOpen) ui.searchOpen = false
  else if (ui.settingsOpen) ui.settingsOpen = false
  else if (git.panelOpen) git.panelOpen = false
  else if (review.panelOpen) review.panelOpen = false
  else if (ui.healthOpen) ui.healthOpen = false
  else if (chat.historyOpen) chat.historyOpen = false
  else if (ui.graphOpen) ui.graphOpen = false
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
