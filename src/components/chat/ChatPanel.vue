<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { renderMarkdown } from '@/lib/markdown'
import type { MessagePart } from '@/stores/chat'

const emit = defineEmits<{ openSettings: [] }>()

const chat = useChatStore()
const settingsStore = useSettingsStore()
const files = useFilesStore()
const citations = useCitationsStore()

const input = ref('')
const scroller = ref<HTMLElement | null>(null)

function renderPart(part: MessagePart & { type: 'text' }): string {
  return renderMarkdown(part.text, { resolve: (t) => files.resolveWikilink(t) })
}

function userText(m: { parts: MessagePart[] }): string {
  const p = m.parts[0]
  return p?.type === 'text' ? p.text : ''
}

async function send(): Promise<void> {
  if (!settingsStore.isConfigured()) {
    emit('openSettings')
    return
  }
  const text = input.value
  input.value = ''
  await chat.send(text)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send()
  }
}

function preset(text: string): void {
  input.value = text
}

async function onPreviewClick(e: MouseEvent): Promise<void> {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  e.preventDefault()
  if (a.classList.contains('citation') || a.classList.contains('cite-source')) {
    const path = a.dataset.citePath
    if (path) await citations.openCitation(path, a.dataset.block ?? null)
    return
  }
  if (a.classList.contains('wikilink') && a.dataset.resolved === '1' && a.dataset.target) {
    await files.openFile(a.dataset.target)
    return
  }
  const href = a.getAttribute('href') ?? ''
  if (/^https?:\/\//.test(href)) {
    window.open(href, '_blank', 'noopener')
    return
  }
  // Relative markdown links ([label](wiki/entities/foo.md)) open the KB file.
  const rel = files.resolveRelativeLink(href)
  if (rel) await files.openFile(rel)
}

// Keep the transcript pinned to the bottom while streaming.
watch(
  () =>
    chat.messages
      .map((m) => {
        const last = m.parts[m.parts.length - 1]
        return m.parts.length + (last?.type === 'text' ? last.text.length : 0)
      })
      .join(),
  async () => {
    await nextTick()
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
  },
)
</script>

<template>
  <div class="h-full flex flex-col bg-bg-1">
    <!-- Header -->
    <div class="flex items-center gap-2 px-3 h-9 border-b border-border shrink-0">
      <span class="codicon codicon-sm codicon-sparkle text-accent" />
      <span class="text-xs uppercase tracking-wide text-fg-3 flex-1">Agent</span>
      <button class="text-fg-3 hover:text-fg-0" title="Clear conversation" @click="chat.clear()">
        <span class="codicon codicon-sm codicon-clear-all" />
      </button>
      <button class="text-fg-3 hover:text-fg-0" title="Settings" @click="emit('openSettings')">
        <span class="codicon codicon-sm codicon-gear" />
      </button>
    </div>

    <!-- Transcript -->
    <div ref="scroller" class="flex-1 panel-scroll px-3 py-3 space-y-4">
      <div v-if="!chat.messages.length" class="text-xs text-fg-3 leading-relaxed">
        Ask questions about your knowledge base, or let the agent maintain it. It can list, read,
        search and write files in the opened folder — writes appear in the review panel.
      </div>

      <div v-for="m in chat.messages" :key="m.id">
        <div v-if="m.role === 'user'" class="rounded-lg bg-accent/10 border border-accent/20 px-3 py-2 selectable whitespace-pre-wrap text-fg-0">
          {{ userText(m) }}
        </div>
        <div v-else class="space-y-1">
          <template v-for="(part, i) in m.parts" :key="i">
            <div
              v-if="part.type === 'tool'"
              class="flex items-center gap-1.5 text-xs text-fg-3 font-mono"
            >
              <span class="codicon codicon-sm codicon-tools" />
              <span class="truncate">{{ part.detail }}</span>
            </div>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-else class="md-preview text-sm" v-html="renderPart(part)" @click="onPreviewClick" />
          </template>
          <div v-if="m.error" class="text-xs text-removed">{{ m.error }}</div>
          <div v-if="chat.running && m === chat.messages[chat.messages.length - 1] && !m.parts.length" class="text-xs text-fg-3">
            Thinking…
          </div>
        </div>
      </div>
    </div>

    <!-- Presets -->
    <div v-if="!chat.messages.length" class="px-3 pb-2 flex gap-2 shrink-0">
      <button
        class="btn text-xs"
        @click="preset('Ingest the un-processed sources under raw/: read each one, then create or update wiki pages for them following the KB schema. Link new pages from the index.')"
      >
        Ingest
      </button>
      <button
        class="btn text-xs"
        @click="preset('Check this knowledge base for problems: orphan pages, broken wikilinks, missing index entries, contradictions. Report what you find; only fix things after listing them.')"
      >
        Lint
      </button>
    </div>

    <!-- Input -->
    <div class="p-3 border-t border-border shrink-0">
      <textarea
        v-model="input"
        rows="3"
        class="input resize-none font-sans"
        placeholder="Ask or instruct the agent… (Enter to send)"
        @keydown="onKeydown"
      />
      <div class="flex items-center mt-2 gap-2">
        <span class="text-xs text-fg-3 flex-1 truncate">
          {{ settingsStore.settings.provider === 'anthropic' ? settingsStore.settings.anthropicModel : settingsStore.settings.openaiModel || 'not configured' }}
        </span>
        <button v-if="chat.running" class="btn text-xs" @click="chat.stop()">
          <span class="codicon codicon-sm codicon-stop-circle mr-1" />Stop
        </button>
        <button v-else class="btn-primary text-xs" :disabled="!input.trim()" @click="send">
          <span class="codicon codicon-sm codicon-send mr-1" />Send
        </button>
      </div>
    </div>
  </div>
</template>
