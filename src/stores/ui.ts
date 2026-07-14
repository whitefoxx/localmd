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
  /** Main-area view: the current file, or the wikilink graph. */
  const view = ref<'file' | 'graph'>('file')
  const sidebarOpen = ref(true)
  const agentOpen = ref(true)
  const searchOpen = ref(false)
  const healthOpen = ref(false)
  /** Show the editor tab bar. When hidden, files open via the Open Files list. */
  const editorTabsVisible = ref(true)

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
    view,
    sidebarOpen,
    agentOpen,
    searchOpen,
    healthOpen,
    editorTabsVisible,
    agentWidth,
    sidebarWidth,
  }
})
