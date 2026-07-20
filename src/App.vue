<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'
import { useGitStore } from '@/stores/git'
import { useReviewStore } from '@/stores/review'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useTtsStore } from '@/stores/tts'
import OpenKbScreen from '@/components/OpenKbScreen.vue'
import AppLayout from '@/components/AppLayout.vue'
import TtsBar from '@/components/TtsBar.vue'
import {
  newFileInteractive,
  moveInteractive,
  deleteSelectedInteractive,
} from '@/lib/fileOps'
import { resolveHotkey, HOTKEY_BY_ID, type HotkeyId } from '@/lib/hotkeys'

const kb = useKbStore()
const files = useFilesStore()
const ui = useUiStore()
const git = useGitStore()
const settings = useSettingsStore()
const tts = useTtsStore()
useThemeStore() // instantiate so the html[data-theme] effect runs

// Switching the open file stops any read-aloud in progress (it was reading the
// previous document).
watch(() => files.currentPath, () => tts.stop())

function onFocus(): void {
  void files.refreshOnFocus()
  void git.refresh() // terminal commits/edits while the app was unfocused
}

/** What each command does. Key bindings live in the registry (@/lib/hotkeys);
 *  overrides in the settings store. See onKeydown for the KB-open / save guard. */
const RUN: Record<HotkeyId, () => void> = {
  save: () => void files.flush(),
  search: () => (ui.searchOpen = !ui.searchOpen),
  sidebar: () => (ui.sidebarOpen = !ui.sidebarOpen),
  agent: () => (ui.agentOpen = !ui.agentOpen),
  newFile: () => void newFileInteractive(),
  move: () => void moveInteractive(),
  delete: () => void deleteSelectedInteractive(),
  tabPrev: () => void files.cycleTab(-1),
  tabNext: () => void files.cycleTab(1),
}

function onKeydown(e: KeyboardEvent): void {
  // A component already consumed this key (e.g. CodeMirror's ⌘[ indent).
  if (e.defaultPrevented) return
  const id = resolveHotkey(e, settings.state.hotkeys)
  if (id) {
    e.preventDefault()
    // Every command except save is a no-op until a KB is open (we still
    // preventDefault so the browser doesn't run its own ⌘K/⌘N/… meanwhile).
    if (HOTKEY_BY_ID[id].needsKb !== false && !kb.isOpen) return
    RUN[id]()
    return
  }
  if (e.key === 'Escape') closeTopLayer()
}

/** Esc closes the top-most open layer, one per press: search → settings →
 *  git → review → health → chat history → graph → restore maximized agent.
 *  (SearchPalette also handles Esc itself while its input has focus — this is
 *  the fallback.) */
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
  else if (ui.agentMaximized) ui.agentMaximized = false
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
    <TtsBar />
  </div>
</template>
