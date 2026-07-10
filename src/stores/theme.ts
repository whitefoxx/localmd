import { defineStore } from 'pinia'
import { ref, computed, watchEffect } from 'vue'

export type ThemePref = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'browser-md:theme'

export const useThemeStore = defineStore('theme', () => {
  const pref = ref<ThemePref>((localStorage.getItem(STORAGE_KEY) as ThemePref) || 'system')
  const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)

  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (e) => (systemDark.value = e.matches))

  const isDark = computed(() => (pref.value === 'system' ? systemDark.value : pref.value === 'dark'))

  watchEffect(() => {
    const el = document.documentElement
    el.dataset.theme = isDark.value ? 'dark' : 'light'
    el.classList.toggle('dark', isDark.value)
  })

  function cycle(): void {
    const order: ThemePref[] = ['system', 'light', 'dark']
    pref.value = order[(order.indexOf(pref.value) + 1) % order.length]
    localStorage.setItem(STORAGE_KEY, pref.value)
  }

  return { pref, isDark, cycle }
})
