import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { isE2eMode } from '@/lib/e2e'

const AGENT_WIDTH_KEY = 'browser-md:agentWidth'
const DEFAULT_AGENT_WIDTH = 384 // matches the old w-96

export const useUiStore = defineStore('ui', () => {
  /** Main-area view: the current file, or the wikilink graph. */
  const view = ref<'file' | 'graph'>('file')
  const sidebarOpen = ref(true)
  const agentOpen = ref(true)
  const searchOpen = ref(false)
  const healthOpen = ref(false)
  /** Show the editor tab bar. When hidden, files open via the Open Files list. */
  const editorTabsVisible = ref(true)

  /** Width of the agent panel (px), user-resizable and persisted. */
  const stored = isE2eMode() ? 0 : Number(localStorage.getItem(AGENT_WIDTH_KEY))
  const agentWidth = ref(stored > 0 ? stored : DEFAULT_AGENT_WIDTH)
  watch(agentWidth, (w) => {
    if (!isE2eMode()) localStorage.setItem(AGENT_WIDTH_KEY, String(Math.round(w)))
  })

  return {
    view,
    sidebarOpen,
    agentOpen,
    searchOpen,
    healthOpen,
    editorTabsVisible,
    agentWidth,
  }
})
