<script setup lang="ts">
/**
 * A gentle, one-time nudge: once a types.yaml schema exists, if new
 * directories aren't covered by it (untyped pages appear), offer to let the
 * agent /lint and update the schema. Shows only when an LLM is configured;
 * dismissal is remembered per KB and per exact set of untyped dirs, so it
 * returns only when a genuinely new directory shows up — never nags.
 */
import { ref, computed } from 'vue'
import { useKbIndexStore } from '@/stores/kbIndex'
import { useKbStore } from '@/stores/kb'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'
import { useUiStore } from '@/stores/ui'

const index = useKbIndexStore()
const kb = useKbStore()
const settings = useSettingsStore()
const chat = useChatStore()
const ui = useUiStore()

const KEY = 'bmd:typedrift-dismissed'
function load(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}
const dismissed = ref<Record<string, string>>(load())

const currentSet = computed(() => index.untypedDirs.join('\n'))
const show = computed(
  () =>
    !!settings.primary &&
    index.untypedDirs.length > 0 &&
    currentSet.value !== (dismissed.value[kb.name ?? ''] ?? ''),
)

function dismiss(): void {
  dismissed.value = { ...dismissed.value, [kb.name ?? '']: currentSet.value }
  try {
    localStorage.setItem(KEY, JSON.stringify(dismissed.value))
  } catch {
    /* ignore quota / privacy-mode failures */
  }
}

async function lint(): Promise<void> {
  dismiss()
  ui.agentOpen = true
  await chat.send('/lint')
}
</script>

<template>
  <div
    v-if="show"
    class="mx-2 my-1 shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-fg-2"
  >
    <div class="flex items-start gap-1.5">
      <span class="codicon codicon-sm codicon-lightbulb mt-px shrink-0 text-amber-500" />
      <div class="min-w-0 flex-1">
        {{ index.untypedDirs.length }} 个目录还没纳入类型 schema。
        <button class="text-accent hover:underline" @click="lint">让 agent /lint 更新</button>
      </div>
      <button class="shrink-0 text-fg-3 hover:text-fg-0" title="忽略" @click="dismiss">
        <span class="codicon codicon-sm codicon-close" />
      </button>
    </div>
  </div>
</template>
