<script setup lang="ts">
/**
 * The open conversations as tabs — the same shape as the editor's file tabs,
 * because they are the same idea and a second style for it would only be a
 * second thing to learn.
 *
 * Renders the tabs and nothing around them: docked they sit in a strip of their
 * own under the header, and in the full-window layout they sit IN the header
 * row (a title above a strip of tabs spends a row of the window saying the same
 * thing twice). The container is each caller's business; the tab is this one's.
 *
 * Tabs shrink evenly to fit rather than scrolling, so the close button of the
 * one you are looking at is never off the edge.
 */
import { useChatStore } from '@/stores/chat'

const chat = useChatStore()
</script>

<template>
  <button
    v-for="t in chat.tabs"
    :key="t.id"
    class="group flex items-center gap-1 px-2 text-xs border-r border-border whitespace-nowrap flex-1 min-w-0 max-w-[150px] overflow-hidden"
    :class="t.id === chat.currentSessionId ? 'bg-bg-0 text-fg-0' : 'text-fg-2 hover:bg-bg-2/50'"
    :title="t.title"
    @click="chat.activateTab(t.id)"
  >
    <span
      v-if="t.running"
      class="codicon codicon-sm codicon-loading codicon-modifier-spin text-accent shrink-0"
    />
    <span class="truncate flex-1 min-w-0 text-left">{{ t.title }}</span>
    <span
      class="codicon codicon-sm codicon-close text-fg-3 hover:text-fg-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 shrink-0"
      :class="{ '!opacity-100': t.id === chat.currentSessionId }"
      @click.stop="chat.closeTab(t.id)"
    />
  </button>
</template>
