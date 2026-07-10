<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { OPENAI_COMPAT_PRESETS } from '@/lib/providers'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { settings } = useSettingsStore()

const preset = ref(
  OPENAI_COMPAT_PRESETS.find((p) => p.baseUrl && p.baseUrl === settings.openaiBaseUrl)?.id ??
    'custom',
)

function applyPreset(): void {
  const p = OPENAI_COMPAT_PRESETS.find((x) => x.id === preset.value)
  if (!p || p.id === 'custom') return
  settings.openaiBaseUrl = p.baseUrl
  settings.openaiModel = p.defaultModel
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      @click.self="emit('close')"
    >
      <div class="w-[460px] max-w-[90vw] rounded-lg border border-border bg-bg-1 p-5">
        <div class="flex items-center mb-4">
          <h2 class="text-lg font-semibold text-fg-0 flex-1">Settings</h2>
          <button class="text-fg-3 hover:text-fg-0" @click="emit('close')">
            <span class="codicon codicon-close" />
          </button>
        </div>

        <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Provider</label>
        <select v-model="settings.provider" class="input mb-4">
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI-compatible</option>
        </select>

        <template v-if="settings.provider === 'anthropic'">
          <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">API key</label>
          <input
            v-model="settings.anthropicApiKey"
            type="password"
            class="input mb-3"
            placeholder="sk-ant-…"
            autocomplete="off"
          />
          <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Model</label>
          <input v-model="settings.anthropicModel" class="input mb-3" placeholder="claude-opus-4-8" />
        </template>

        <template v-else>
          <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Preset</label>
          <select v-model="preset" class="input mb-3" @change="applyPreset">
            <option v-for="p in OPENAI_COMPAT_PRESETS" :key="p.id" :value="p.id">
              {{ p.label }}
            </option>
          </select>
          <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Base URL</label>
          <input
            v-model="settings.openaiBaseUrl"
            class="input mb-3"
            placeholder="https://api.openai.com/v1"
          />
          <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">API key</label>
          <input
            v-model="settings.openaiApiKey"
            type="password"
            class="input mb-3"
            placeholder="sk-…"
            autocomplete="off"
          />
          <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Model</label>
          <input
            v-model="settings.openaiModel"
            class="input mb-3"
            placeholder="e.g. gpt-4.1, deepseek-chat"
          />
          <p class="text-xs text-fg-3 mb-3">
            Works with any Chat-Completions-compatible endpoint — but it must allow browser (CORS)
            access. All presets above are verified to work; custom gateways may not.
          </p>
        </template>

        <p class="text-xs text-fg-3 border-t border-border pt-3">
          Your API key is stored only in this browser (localStorage) and sent only to the provider
          you configured. No other server is involved.
        </p>
      </div>
    </div>
  </Teleport>
</template>
