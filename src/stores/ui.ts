import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { isE2eMode } from '@/lib/e2e'

const AGENT_WIDTH_KEY = 'browser-md:agentWidth'
const DEFAULT_AGENT_WIDTH = 384 // matches the old w-96
const SIDEBAR_WIDTH_KEY = 'browser-md:sidebarWidth'
const DEFAULT_SIDEBAR_WIDTH = 256 // matches the old w-64

function persistedWidth(key: string, fallback: number): number {
  const stored = isE2eMode() ? 0 : Number(localStorage.getItem(key))
  return stored > 0 ? stored : fallback
}

export const useUiStore = defineStore('ui', () => {
  /** The wikilink graph, shown as a full-screen overlay above the editor
   *  (which stays mounted — closing the graph never reloads a PDF). */
  const graphOpen = ref(false)
  const sidebarOpen = ref(true)
  const agentOpen = ref(true)
  /** Agent panel maximized to fill the whole window (not native fullscreen —
   *  just an overlay covering the app). Transient; not persisted. */
  const agentMaximized = ref(false)
  const searchOpen = ref(false)
  const healthOpen = ref(false)
  const settingsOpen = ref(false)
  /** Show the editor tab bar. When hidden, files open via the Open Files list. */
  const editorTabsVisible = ref(true)

  /** Text handed to the chat composer from elsewhere in the app — Settings →
   *  Tools uses it to turn "I need a tool that…" into a message the user can
   *  edit and send. The composer consumes it and clears it, so it is a one-shot
   *  handoff rather than shared state. */
  const pendingPrompt = ref('')

  /** Which Settings pane to land on when the modal is opened from elsewhere —
   *  sending someone to "Settings" and letting them hunt for the right pane is
   *  most of the reason setup feels hard. One-shot, like pendingPrompt. */
  const settingsSection = ref<string | null>(null)

  /** Open Settings on a specific pane. */
  function openSettings(section?: string): void {
    if (section) settingsSection.value = section
    settingsOpen.value = true
  }

  /** Widths (px) of the resizable panels, persisted per browser. */
  const agentWidth = ref(persistedWidth(AGENT_WIDTH_KEY, DEFAULT_AGENT_WIDTH))
  const sidebarWidth = ref(persistedWidth(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH))
  watch(agentWidth, (w) => {
    if (!isE2eMode()) localStorage.setItem(AGENT_WIDTH_KEY, String(Math.round(w)))
  })
  watch(sidebarWidth, (w) => {
    if (!isE2eMode()) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(w)))
  })

  return {
    graphOpen,
    sidebarOpen,
    agentOpen,
    agentMaximized,
    searchOpen,
    healthOpen,
    settingsOpen,
    editorTabsVisible,
    pendingPrompt,
    settingsSection,
    openSettings,
    agentWidth,
    sidebarWidth,
  }
})
