<script setup lang="ts">
/**
 * The control the agent asked for, rendered above the composer while the turn
 * is blocked on it.
 *
 * For a key the input writes into settings directly and the agent is told only
 * that a value arrived — the one path by which a secret can reach the app
 * during a conversation without passing through the model.
 */
import { ref } from 'vue'
import { useToolsStore } from '@/stores/tools'
import { useSetupStore, type SetupRequest } from '@/stores/setup'
import { useMcpStore } from '@/stores/mcp'

const props = defineProps<{ request: SetupRequest }>()

const setup = useSetupStore()
const tools = useToolsStore()
const mcp = useMcpStore()

const value = ref('')
const checking = ref(false)
const checkFailed = ref(false)

function saveKey(): void {
  const v = value.value.trim()
  if (!v || !props.request.secretId) return
  tools.setSecret(props.request.secretId, v)
  value.value = ''
  setup.settle(props.request.id, 'provided')
}

/** Install the entry if it isn't yet, reconnect, then report what we see. */
async function checkExtension(): Promise<void> {
  const entryId = props.request.entryId
  checking.value = true
  checkFailed.value = false
  try {
    if (entryId && !tools.isInstalled(entryId)) tools.install(entryId)
    await mcp.refresh()
    if (tools.webcliConnected) setup.settle(props.request.id, 'connected')
    else checkFailed.value = true
  } finally {
    checking.value = false
  }
}
</script>

<template>
  <div class="mb-2 rounded-xl border border-accent/40 bg-accent/5 px-3 py-2.5">
    <div class="flex items-center gap-1.5">
      <span
        class="codicon codicon-sm text-accent"
        :class="request.kind === 'key' ? 'codicon-key' : request.kind === 'extension' ? 'codicon-plug' : 'codicon-question'"
      />
      <span class="text-sm text-fg-1">{{ request.label }}</span>
    </div>
    <p v-if="request.help" class="mt-0.5 text-xs text-fg-3 leading-relaxed">{{ request.help }}</p>

    <!-- A key: straight into settings, never back to the model. -->
    <div v-if="request.kind === 'key'" class="mt-2 flex items-center gap-2">
      <input
        v-model="value"
        type="password"
        class="input text-xs flex-1"
        autocomplete="off"
        :placeholder="request.secretId"
        @keydown.enter.prevent="saveKey"
      />
      <button class="btn text-xs shrink-0" :disabled="!value.trim()" @click="saveKey">
        {{ $t('chat.setupSave') }}
      </button>
    </div>

    <!-- An extension: install, then re-check. -->
    <div v-else-if="request.kind === 'extension'" class="mt-2 flex items-center gap-2 flex-wrap">
      <a v-if="request.url" :href="request.url" target="_blank" rel="noopener" class="btn text-xs">
        {{ $t('chat.setupInstall') }}
      </a>
      <button class="btn text-xs" :disabled="checking" @click="checkExtension">
        {{ checking ? $t('chat.setupChecking') : $t('chat.setupRecheck') }}
      </button>
    </div>

    <!-- A choice the agent could not make on the user's behalf. -->
    <div v-else class="mt-2 flex items-center gap-2 flex-wrap">
      <button
        v-for="o in request.options ?? []"
        :key="o"
        class="btn text-xs"
        @click="setup.settle(request.id, `chose:${o}`)"
      >{{ o }}</button>
    </div>

    <p v-if="checkFailed" class="mt-1.5 text-xs text-removed">{{ $t('chat.setupNotDetected') }}</p>

    <div class="mt-2 flex items-center gap-3">
      <a
        v-if="request.url && request.kind !== 'extension'"
        :href="request.url"
        target="_blank"
        rel="noopener"
        class="text-xs text-accent hover:underline"
      >{{ $t('chat.setupWhere') }}</a>
      <button class="text-xs text-fg-3 hover:text-fg-1" @click="setup.settle(request.id, 'skipped')">
        {{ $t('chat.setupSkip') }}
      </button>
    </div>
  </div>
</template>
