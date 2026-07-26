<script setup lang="ts">
/** The body of a thinking block. While the model is still writing one, a long
 *  trail is clamped to its first lines so it can't push the reply off screen —
 *  the clamp carries a live "still thinking" cue and lifts for good once the
 *  user asks for the rest, or on its own when the stream moves on. From then on
 *  the only fold left is the block's own disclosure, in the parent. */
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{ text: string; streaming: boolean }>()

/** One-way: asking for the full trail retires the clamp for this block. */
const expanded = ref(false)
const clamped = computed(() => props.streaming && !expanded.value)

const body = ref<HTMLElement | null>(null)
/** Only offer the expander once the clamp actually hides something, so a short
 *  thought stays chrome-free. Thinking text only ever grows, so once it
 *  overflows it stays overflowing — measure until then, then stop. */
const overflowing = ref(false)
watch(
  () => props.text,
  async () => {
    if (!clamped.value || overflowing.value) return
    await nextTick()
    const el = body.value
    if (el) overflowing.value = el.scrollHeight - el.clientHeight > 2
  },
  { immediate: true },
)
</script>

<template>
  <div class="pl-4 pt-1">
    <div
      ref="body"
      class="whitespace-pre-wrap selectable italic leading-relaxed"
      :class="{ 'think-clamp': clamped }"
    >{{ text }}</div>
    <button
      v-if="clamped && overflowing"
      class="mt-1 flex items-center gap-1.5 text-fg-3 hover:text-fg-2"
      @click="expanded = true"
    >
      <span class="codicon codicon-sm codicon-loading codicon-modifier-spin" />
      <span>{{ $t('chat.thinkingEllipsis') }}</span>
      <span>·</span>
      <span class="underline decoration-dotted underline-offset-2">{{ $t('chat.thinkingExpand') }}</span>
    </button>
  </div>
</template>

<style scoped>
/* Lines kept while streaming: enough to follow the thought, few enough that a
   long trail doesn't own the transcript. The bottom fade marks the cut. */
.think-clamp {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 10;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, #000 62%, transparent);
  mask-image: linear-gradient(to bottom, #000 62%, transparent);
}
</style>
