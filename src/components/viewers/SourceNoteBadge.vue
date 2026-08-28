<script setup lang="ts">
/**
 * The offer to have a source note written for the document on screen.
 *
 * Shown only while NO page in the KB declares this file with `[[pdfN:path]]`
 * — a declaration is a page claiming to have read it, which is the honest
 * test; merely naming a file in prose claims nothing. The detection is free
 * (a lookup in a set the index already computes), the writing costs tokens,
 * so a click sits between them: this drafts a request into the composer and
 * stops there. The user sends it, edits it, or ignores it.
 *
 * Disappears the moment a page cites the document — like the index badge
 * beside it, it is an offer, not a control.
 */
import { computed } from 'vue'
import { useKbIndexStore } from '@/stores/kbIndex'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'

const props = defineProps<{ path: string }>()

const index = useKbIndexStore()
const ui = useUiStore()

const show = computed(() => !!props.path && !index.hasSourceNote(props.path))

function ask(): void {
  ui.agentOpen = true
  ui.pendingPrompt = t('viewers.sourceNote.prompt', { path: props.path })
}
</script>

<template>
  <button
    v-if="show"
    class="btn text-xs shadow-sm"
    :title="$t('viewers.sourceNote.hint')"
    @click="ask"
  >
    <span class="codicon codicon-sm codicon-edit" />
    {{ $t('viewers.sourceNote.write') }}
  </button>
</template>
