import { defineStore } from 'pinia'
import { ref, computed, watchEffect } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { isE2eMode } from '@/lib/e2e'

export type ThemePref = 'light' | 'dark' | 'system'

/** Where the preference lived before it joined the rest of the settings. Read
 *  once, to carry an existing choice over, then retired. */
const LEGACY_KEY = 'browser-md:theme'

export const useThemeStore = defineStore('theme', () => {
  const settings = useSettingsStore()

  if (!isE2eMode()) {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy === 'light' || legacy === 'dark' || legacy === 'system') {
      if (settings.state.theme === 'system') settings.state.theme = legacy
      localStorage.removeItem(LEGACY_KEY)
    }
  }

  /** Settings owns the value; this is the handle everything else writes through. */
  const pref = computed<ThemePref>({
    get: () => settings.state.theme,
    set: (v) => {
      settings.state.theme = v
    },
  })

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
  }

  return { pref, isDark, cycle }
})
