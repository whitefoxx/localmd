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
import { useMcpStore } from '@/stores/mcp'
import OpenKbScreen from '@/components/OpenKbScreen.vue'
import AppLayout from '@/components/AppLayout.vue'
import NarrowScreenNotice from '@/components/NarrowScreenNotice.vue'
import TtsBar from '@/components/TtsBar.vue'
import UpdateBanner from '@/components/UpdateBanner.vue'
import { resolveHotkey, HOTKEY_BY_ID, type HotkeyId } from '@/lib/hotkeys'
import { keepsNativeMenu } from '@/lib/nativeMenu'

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
  // Coming back to the tab is when the concurrent-folder bar gets read, so it
  // is also when it has to be true: a second tab that has since been closed
  // takes the bar with it (kb.recheckOtherTab).
  void kb.recheckOtherTab()
  // Terminal commits/edits while the app was unfocused — worth catching up on,
  // not worth a spinner and a disabled Commit button on every return.
  void git.refreshQuietly()
  // A tool server that was down, or an extension that was mid-reload, often
  // came back while the user was away. Only failing rows are re-probed — and
  // only with a KB open, so the landing screen still connects to nothing.
  if (kb.isOpen) void useMcpStore().retryFailed()
}

/** What each command does. Key bindings live in the registry (@/lib/hotkeys);
 *  overrides in the settings store. See onKeydown for the KB-open guard. */
const RUN: Record<HotkeyId, () => void> = {
  search: () => (ui.searchOpen = !ui.searchOpen),
  sidebar: () => (ui.sidebarOpen = !ui.sidebarOpen),
  agent: () => (ui.agentOpen = !ui.agentOpen),
  agentMaximize: () => ui.toggleAgentMaximized(),
  zen: () => ui.toggleZen(),
  tabPrev: () => void files.cycleTab(-1),
  tabNext: () => void files.cycleTab(1),
}

function onKeydown(e: KeyboardEvent): void {
  // Runs in the capture phase (see onMounted), i.e. before any element/plugin/
  // editor handler. When a combo is one of our hotkeys we claim it outright:
  // preventDefault (kill the browser's own ⌘P print / ⌘S save) *and*
  // stopPropagation, so the event never reaches in-page listeners that would
  // double-handle it. The PDF viewer (EmbedPDF) registers a document-level
  // keydown listener mapping ⌘P to its own in-app print dialog; without
  // stopPropagation here that dialog still popped up alongside our search panel.
  // Keys the editor legitimately owns (⌘[/⌘] indent, ⌘D select-next) carry
  // notInEditable, so resolveHotkey won't match them inside an editable target,
  // we don't stop them, and they fall through to CodeMirror. Keys inside an epub
  // chapter iframe never reach here — EpubViewer forwards those onto window itself.
  if (e.defaultPrevented) return
  const id = resolveHotkey(e, settings.state.hotkeys)
  if (id) {
    e.preventDefault()
    e.stopPropagation()
    // These commands are a no-op until a KB is open (we still preventDefault so
    // the browser doesn't run its own ⌘K/⌘B/… meanwhile).
    if (HOTKEY_BY_ID[id].needsKb !== false && !kb.isOpen) return
    RUN[id]()
    return
  }
  if (e.key === 'Escape') closeTopLayer()
}

/** Esc closes the top-most open layer, one per press: help → search → settings
 *  → git → review → health → chat history → chat search → graph → restore
 *  maximized agent → leave zen. Zen is last because it is the quietest layer: anything else on
 *  screen was opened on top of it and goes first.
 *  (SearchPalette also handles Esc itself while its input has focus — this is
 *  the fallback.)
 *
 *  Help leads because it is genuinely the top-most: every modal here is z-50,
 *  so stacking falls to DOM order, and HelpPanel is mounted last in AppLayout —
 *  it draws over the others. Putting it ahead also means the chain behaves
 *  exactly as it always did whenever Help is shut, which was every state it had
 *  until now: Help was the one modal Esc did not close, while its own close
 *  button advertised "Close (Esc)". */
function closeTopLayer(): void {
  const review = useReviewStore()
  const chat = useChatStore()
  if (ui.helpOpen) ui.helpOpen = false
  else if (ui.searchOpen) ui.searchOpen = false
  // Asks rather than tells: this layer can be holding unsaved input, and it is
  // the only one that knows (see maySettingsClose). The condition stays plain
  // `settingsOpen` — folding the question into it would let a "no" fall through
  // to the next branch and close whatever is underneath instead.
  else if (ui.settingsOpen) {
    if (ui.maySettingsClose()) ui.settingsOpen = false
  }
  else if (git.panelOpen) git.panelOpen = false
  else if (review.panelOpen) review.panelOpen = false
  else if (ui.healthOpen) ui.healthOpen = false
  else if (chat.historyOpen) chat.historyOpen = false
  // A filter typed into the maximized panel's rail is a layer of its own: the
  // list is hiding rows until it is cleared, and clearing it is what Esc means
  // to someone with the caret still in that box.
  else if (chat.historyQuery) chat.historyQuery = ''
  else if (ui.graphOpen) ui.graphOpen = false
  else if (ui.agentMaximized) ui.agentMaximized = false
  else if (ui.zen) ui.zen = false
}

/**
 * The browser's own right-click menu belongs to what is being read, not to the
 * app around it. `keepsNativeMenu` holds the rule and the reasoning; this is
 * only where it meets the event.
 */
function onContextMenu(e: MouseEvent): void {
  if (keepsNativeMenu(e.target as Element | null, window.getSelection())) return
  e.preventDefault()
}

function onBeforeUnload(): void {
  // Best-effort flush; createWritable commits are async but usually complete.
  void files.flush()
}

/** Read the recents list, then reopen last session's folder if the browser
 *  still has permission — and load its tree and tabs exactly as opening it by
 *  hand would. A reload should be survivable, not a reset. */
async function boot(): Promise<void> {
  // Safety valve on the start screen being held back: IndexedDB can block
  // indefinitely (another tab mid version-upgrade), and a blank page is a
  // worse answer than the start screen. Giving up only releases the paint —
  // the restore is still allowed to land, late, if it lands at all.
  const giveUp = setTimeout(() => (kb.restoring = false), 3000)
  try {
    await kb.refreshRecents()
    if (await kb.restoreLast()) {
      await files.refreshTree()
      await files.restoreTabs()
    }
  } finally {
    clearTimeout(giveUp)
  }
}

onMounted(() => {
  void boot()
  window.addEventListener('focus', onFocus)
  // Capture phase: claim hotkeys before the PDF viewer / browser default can.
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('beforeunload', onBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocus)
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('contextmenu', onContextMenu)
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <div class="h-full bg-bg-0 text-fg-1">
    <AppLayout v-if="kb.isOpen" />
    <!-- Nothing while `restoring`: last session's folder may be about to come
         back, and showing the landing page first only to replace it is the
         flicker we would be fixing here anyway. That wait costs an IndexedDB
         read and is skipped entirely for anyone with no folder to restore —
         see `restoring` in stores/kb. -->
    <OpenKbScreen v-else-if="!kb.restoring" />
    <!-- Only over the workspace. The start screen is laid out for a phone and
         degrades correctly there on its own — it is the three-column workspace
         behind it that has no narrow form. -->
    <NarrowScreenNotice v-if="kb.isOpen" />
    <TtsBar />
    <!-- Also root-level: which screen is up decides whether a waiting build is
         offered or just applied (main.ts), not where the offer is drawn. -->
    <UpdateBanner />
  </div>
</template>
