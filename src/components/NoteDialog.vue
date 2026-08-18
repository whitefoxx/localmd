<script setup lang="ts">
/**
 * Shared note editor for the EPUB and PDF viewers. The mark already exists while
 * this is open, so colour / underline / read act live (no confirm). Only the note
 * TEXT has an explicit save — a check button that appears in the textarea corner
 * once the text changes. Closing with unsaved text asks first. Delete removes the
 * whole mark.
 */
import { ref, watch, computed, nextTick } from 'vue'
import { READ_ALOUD_ENABLED } from '@/lib/tts'

type MarkStyle = 'highlight' | 'underline'

const props = defineProps<{
  open: boolean
  /** The marked passage, shown quoted above the input. */
  excerpt: string
  /** Existing note text. */
  initialNote?: string
  /** Highlight palette (name + hex). */
  colors: Array<{ name: string; value: string }>
  underlineColor: string
  /** The mark's current colour / style, to preselect the controls. */
  color: string
  markStyle: MarkStyle
}>()
const emit = defineEmits<{
  pickColor: [string]
  setUnderline: []
  read: []
  saveText: [string]
  delete: []
  close: []
}>()

const draft = ref('')
const savedNote = ref('')
const localColor = ref('')
const localStyle = ref<MarkStyle>('highlight')
const confirming = ref(false)
const textarea = ref<HTMLTextAreaElement | null>(null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    draft.value = props.initialNote ?? ''
    savedNote.value = props.initialNote ?? ''
    localColor.value = props.color
    localStyle.value = props.markStyle
    confirming.value = false
    void nextTick(() => textarea.value?.focus())
  },
  { immediate: true },
)

const dirty = computed(() => draft.value.trim() !== savedNote.value.trim())

function pick(c: string): void {
  localColor.value = c
  localStyle.value = 'highlight'
  emit('pickColor', c)
}
function chooseUnderline(): void {
  localStyle.value = 'underline'
  emit('setUnderline')
}
function saveText(): void {
  emit('saveText', draft.value.trim())
  savedNote.value = draft.value
}
function tryClose(): void {
  if (dirty.value) confirming.value = true
  else emit('close')
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    tryClose()
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
      @click.self="tryClose"
      @keydown="onKey"
    >
      <div
        class="relative w-[460px] max-w-[95vw] rounded-xl border border-border bg-bg-1 shadow-2xl flex flex-col overflow-hidden"
      >
        <button
          class="absolute top-2.5 right-2.5 w-6 h-6 rounded flex items-center justify-center text-fg-3 hover:text-fg-1 hover:bg-bg-2"
          :title="$t('common.close')"
          @click="tryClose"
        >
          <span class="codicon codicon-sm codicon-close" />
        </button>
        <div class="flex items-center gap-2 px-4 py-3 border-b border-border">
          <span class="codicon codicon-sm codicon-note text-fg-3" />
          <span class="text-sm font-medium text-fg-1">{{ $t('note.title') }}</span>
        </div>

        <div class="p-4 flex flex-col gap-3">
          <blockquote
            class="max-h-28 overflow-auto text-sm text-fg-2 border-l-2 border-accent/60 bg-bg-2 rounded-r px-3 py-2 whitespace-pre-line"
          >{{ excerpt }}</blockquote>

          <!-- Note text — the only thing with an explicit save (the ✓ appears once
               the text changes). -->
          <div class="relative">
            <textarea
              ref="textarea"
              v-model="draft"
              rows="4"
              class="w-full text-sm bg-bg-2 rounded px-2 py-1.5 pr-10 outline-none focus:ring-1 focus:ring-accent resize-y"
              :placeholder="$t('note.placeholder')"
              @keydown.enter.meta.prevent="saveText"
              @keydown.enter.ctrl.prevent="saveText"
            />
            <button
              v-if="dirty"
              class="absolute bottom-2.5 right-2 w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center shadow hover:opacity-90"
              :title="$t('note.saveNote')"
              @click="saveText"
            >
              <span class="codicon codicon-sm codicon-check" />
            </button>
          </div>

          <!-- Appearance + actions — all live, no confirm. Delete on the far right. -->
          <div class="flex items-center gap-1.5">
            <button
              v-for="c in colors"
              :key="c.value"
              class="w-5 h-5 rounded-full border transition-transform hover:scale-110"
              :class="
                localStyle === 'highlight' && localColor.toLowerCase() === c.value.toLowerCase()
                  ? 'border-fg-1'
                  : 'border-border'
              "
              :style="{ backgroundColor: c.value }"
              :title="$t('note.highlight', { name: c.name })"
              @click="pick(c.value)"
            />
            <span class="w-px h-4 bg-border mx-0.5" />
            <button
              v-if="READ_ALOUD_ENABLED"
              class="w-6 h-5 rounded flex items-center justify-center text-fg-3 hover:text-fg-1"
              :title="$t('note.readSelection')"
              @click="emit('read')"
            >
              <span class="codicon codicon-sm codicon-unmute" />
            </button>
            <button
              class="w-6 h-5 rounded flex items-center justify-center leading-none hover:text-fg-1"
              :class="localStyle === 'underline' ? 'text-fg-1' : 'text-fg-3'"
              :title="$t('note.underline')"
              @click="chooseUnderline"
            >
              <span
                class="text-xs font-semibold underline underline-offset-2"
                :style="{ color: underlineColor }"
              >U</span>
            </button>
            <span class="flex-1" />
            <button
              class="w-6 h-5 rounded flex items-center justify-center text-fg-3 hover:!text-removed"
              :title="$t('note.deleteMark')"
              @click="emit('delete')"
            >
              <span class="codicon codicon-sm codicon-trash" />
            </button>
          </div>

          <!-- Unsaved-close guard -->
          <div
            v-if="confirming"
            class="flex items-center gap-2 text-xs text-fg-2 border-t border-border pt-3"
          >
            <span class="flex-1">{{ $t('note.unsavedPrompt') }}</span>
            <button class="btn text-xs" @click="emit('close')">{{ $t('note.discard') }}</button>
            <button class="btn-primary text-xs" @click="confirming = false">{{ $t('note.keepEditing') }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
