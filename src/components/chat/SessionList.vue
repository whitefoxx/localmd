<script setup lang="ts">
/**
 * The list of saved conversations — one row each, with its star, its status and
 * its delete.
 *
 * It has two homes: the history overlay the docked panel opens over its
 * transcript, and the rail the maximized panel keeps permanently on the left.
 * One component rather than two copies because they are the same list: a row
 * that learns something in one place should not have to be taught it twice.
 *
 * `compact` is the rail's difference — a 264px column has no room for a date
 * beside the title, and the rail's job is picking a conversation, not auditing
 * when it was last touched.
 *
 * No rules between rows in either home: a list is already read as a list, and a
 * line under every title is one more thing on screen that says nothing.
 *
 * `selected` is the row the search box's Enter would open — an outline rather
 * than a background, because the row it lands on may already be the current
 * conversation or an open tab, and those have backgrounds of their own that it
 * must not be mistaken for. -1 means nobody is steering by keyboard.
 */
import { nextTick, watch, type ComponentPublicInstance } from 'vue'
import { useChatStore, type SessionSummary } from '@/stores/chat'

const props = withDefaults(defineProps<{
  sessions: SessionSummary[]
  compact?: boolean
  selected?: number
}>(), { selected: -1 })

const chat = useChatStore()

/** Row elements by index, so the selected one can be kept in view — walking
 *  the list with the keyboard is useless if it walks off the bottom of it. */
const rows = new Map<number, HTMLElement>()

function setRow(i: number, el: Element | ComponentPublicInstance | null): void {
  if (el instanceof HTMLElement) rows.set(i, el)
  else rows.delete(i)
}

watch(
  () => props.selected,
  (i) => {
    if (i < 0) return
    void nextTick(() => rows.get(i)?.scrollIntoView({ block: 'nearest' }))
  },
)
</script>

<template>
  <!-- active = the one on screen (unique); open = loaded in a tab (many). -->
  <div
    v-for="(s, i) in sessions"
    :key="s.id"
    :ref="(el) => setRow(i, el)"
    class="group relative flex items-center gap-2 px-3 py-2 cursor-pointer"
    :class="[
      s.id === chat.currentSessionId
        ? 'bg-accent/15'
        : chat.tabs.some((t) => t.id === s.id)
          ? 'bg-bg-2 hover:bg-bg-3'
          : 'hover:bg-bg-2/60',
      i === selected ? 'ring-1 ring-inset ring-accent/60' : '',
    ]"
    @click="chat.openSession(s.id)"
  >
    <span
      v-if="s.id === chat.currentSessionId"
      class="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-accent"
    />
    <!-- Left slot: chat/open status icon by default; on row hover a star
         toggle replaces it. A favorited session shows the lit star in place
         of the status icon entirely. -->
    <div class="relative w-4 h-4 shrink-0">
      <span
        v-if="!s.favorite"
        class="codicon codicon-sm absolute inset-0 flex items-center justify-center group-hover:hidden"
        :class="
          chat.tabs.some((t) => t.id === s.id)
            ? `codicon-circle-filled ${s.id === chat.currentSessionId ? 'text-accent' : 'text-fg-2'}`
            : 'codicon-comment-discussion text-fg-3'
        "
      />
      <button
        class="absolute inset-0 items-center justify-center"
        :class="
          s.favorite
            ? 'flex text-yellow-500 hover:text-yellow-400'
            : 'hidden group-hover:flex text-fg-3 hover:text-fg-1'
        "
        :title="s.favorite ? $t('chat.unfavorite') : $t('chat.favorite')"
        @click.stop="chat.toggleFavorite(s.id)"
      >
        <span
          class="codicon codicon-sm"
          :class="s.favorite ? 'codicon-star-full' : 'codicon-star-empty'"
        />
      </button>
    </div>
    <span
      class="flex-1 truncate text-sm"
      :class="s.id === chat.currentSessionId ? 'text-fg-0 font-medium' : 'text-fg-1'"
    >{{ s.title }}</span>
    <span
      v-if="s.id === chat.currentSessionId"
      class="text-[10px] px-1 rounded bg-accent/20 text-accent shrink-0"
    >{{ $t('chat.currentBadge') }}</span>
    <span
      v-else-if="chat.tabs.some((t) => t.id === s.id)"
      class="text-[10px] px-1 rounded bg-bg-3 text-fg-3 shrink-0"
    >{{ $t('chat.openBadge') }}</span>
    <span v-if="!compact" class="text-xs text-fg-3 shrink-0">
      {{ new Date(s.updatedAt).toLocaleDateString() }}
    </span>
    <button
      class="text-fg-3 hover:text-removed opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 shrink-0"
      :title="$t('common.delete')"
      @click.stop="chat.removeSession(s.id)"
    >
      <span class="codicon codicon-sm codicon-trash" />
    </button>
    <!-- Full title on hover — row titles truncate. pointer-events-none so it
         never intercepts the row's click. -->
    <div
      class="pointer-events-none absolute left-9 top-full -mt-1 z-30 hidden max-w-[280px] break-words rounded-md border border-border bg-bg-0 px-2 py-1 text-xs text-fg-0 shadow-lg group-hover:block"
    >{{ s.title }}</div>
  </div>
</template>
