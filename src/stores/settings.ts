import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'

export type Provider = 'anthropic' | 'openai'

export interface Settings {
  provider: Provider
  anthropicApiKey: string
  anthropicModel: string
  openaiApiKey: string
  openaiModel: string
  openaiBaseUrl: string
}

const STORAGE_KEY = 'browser-md:settings'

const DEFAULTS: Settings = {
  provider: 'anthropic',
  anthropicApiKey: '',
  anthropicModel: 'claude-opus-4-8',
  openaiApiKey: '',
  openaiModel: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* corrupted settings — fall back to defaults */
  }
  return { ...DEFAULTS }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = reactive<Settings>(load())

  watch(settings, () => localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)), {
    deep: true,
  })

  function isConfigured(): boolean {
    if (settings.provider === 'anthropic') {
      return !!settings.anthropicApiKey && !!settings.anthropicModel
    }
    return !!settings.openaiApiKey && !!settings.openaiModel
  }

  return { settings, isConfigured }
})
