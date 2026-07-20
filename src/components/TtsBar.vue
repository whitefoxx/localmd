<script setup lang="ts">
/**
 * Floating read-aloud control bar. Shown only while TTS is active (any viewer
 * starts a read via the tts store). Voice/speed changes apply to the next
 * sentence chunk, so they feel near-live. Voice + rate persist via settings.
 */
import { useTtsStore } from '@/stores/tts'
import { useSettingsStore } from '@/stores/settings'

const tts = useTtsStore()
const settings = useSettingsStore()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="tts.playing"
      class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg border border-border bg-bg-1 px-3 py-2 shadow-xl"
    >
      <button class="btn text-xs" :title="tts.paused ? '继续' : '暂停'" @click="tts.toggle()">
        <span class="codicon codicon-sm" :class="tts.paused ? 'codicon-play' : 'codicon-debug-pause'" />
      </button>
      <button class="btn text-xs" title="停止朗读" @click="tts.stop()">
        <span class="codicon codicon-sm codicon-debug-stop" />
      </button>
      <span v-if="tts.title" class="text-xs text-fg-2 max-w-[160px] truncate" :title="tts.title">
        {{ tts.title }}
      </span>
      <select
        v-model="settings.state.ttsVoice"
        class="input text-xs !w-auto py-0.5"
        title="音色（Google）"
      >
        <option value="">默认音色</option>
        <option v-for="v in tts.googleVoices" :key="v.name" :value="v.name">
          {{ v.name.replace(/^Google\s*/, '') }} · {{ v.lang }}
        </option>
      </select>
      <select
        v-model.number="settings.state.ttsRate"
        class="input text-xs !w-auto py-0.5"
        title="语速"
      >
        <option :value="0.75">0.75×</option>
        <option :value="1">1×</option>
        <option :value="1.25">1.25×</option>
        <option :value="1.5">1.5×</option>
        <option :value="2">2×</option>
      </select>
    </div>
  </Teleport>
</template>
