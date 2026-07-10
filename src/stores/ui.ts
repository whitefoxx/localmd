import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  /** Main-area view: the current file, or the wikilink graph. */
  const view = ref<'file' | 'graph'>('file')
  const searchOpen = ref(false)
  const healthOpen = ref(false)

  return { view, searchOpen, healthOpen }
})
