<script setup lang="ts">
/**
 * The box that filters the list of conversations.
 *
 * Two homes, one query (`chat.historyQuery`): the rail opens it in place of its
 * Search chats row, and the history overlay carries it along its top. Both are
 * "find the conversation I mean", so both type into the same field.
 *
 * It takes focus on arrival because it is never on screen unasked — you either
 * clicked Search chats or opened the history, and in both cases the next thing
 * you meant to do was type. And having typed, you should not have to reach for
 * the mouse to act on what you see: the arrows walk the list below and Enter
 * opens the row they are on, which is what every other search box in this app
 * (and every one outside it) does. Which row that is belongs to whoever owns
 * the list, so this only says which way you pressed.
 */
import { onMounted, ref } from 'vue'
import { useChatStore } from '@/stores/chat'

const emit = defineEmits<{ blur: []; move: [delta: number]; choose: [] }>()

const chat = useChatStore()
const input = ref<HTMLInputElement>()

onMounted(() => input.value?.focus())
</script>

<template>
  <!-- Two things put the magnifier off-centre, and it needs both fixed. It is
       positioned against the input itself rather than a padded box around it —
       half of a padding is exactly how far a top-1/2 on the outer element
       misses by — and it is centred by moving the glyph's own box, not by
       stretching a flex container: codicon.css sets `display: inline-block` at
       a specificity a `flex` utility cannot reach, so a stretched span leaves
       the glyph sitting at its top. The left padding is a row's own 8 + icon +
       8 measured out, so the caret starts where the word "Search" was standing. -->
  <div class="relative">
    <span
      class="codicon codicon-sm codicon-search pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-3"
    />
    <input
      ref="input"
      v-model="chat.historyQuery"
      type="text"
      class="w-full rounded-md bg-bg-2 pl-8 pr-2 py-1.5 text-sm text-fg-0 placeholder-fg-3 outline-none"
      :placeholder="$t('chat.searchChats')"
      @blur="emit('blur')"
      @keydown.esc="input?.blur()"
      @keydown.down.prevent="emit('move', 1)"
      @keydown.up.prevent="emit('move', -1)"
      @keydown.enter.prevent="emit('choose')"
    />
  </div>
</template>
