<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useChatStore, type Attachment } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { usePlanStore } from '@/stores/plan'
import { renderMarkdown } from '@/lib/markdown'
import { importFile } from '@/lib/capture'
import { mentionQueryAt, filterFiles } from '@/lib/mentions'
import { fileKind } from '@/lib/filetypes'
import type { MessagePart } from '@/stores/chat'

const emit = defineEmits<{ openSettings: [] }>()

const chat = useChatStore()
const settingsStore = useSettingsStore()
const files = useFilesStore()
const citations = useCitationsStore()
const plan = usePlanStore()

const PLAN_ICONS = {
  pending: 'codicon-circle-large-outline text-fg-3',
  in_progress: 'codicon-play-circle text-accent',
  done: 'codicon-pass-filled text-added',
} as const

const input = ref('')
const scroller = ref<HTMLElement | null>(null)
const textarea = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

/* ── attachments (paste / upload / drop → saved into the KB) ─────────────── */

const attachments = ref<Attachment[]>([])
const importing = ref(false)
const dragOver = ref(false)

async function addFiles(list: File[] | FileList): Promise<void> {
  const arr = Array.from(list)
  if (!arr.length) return
  importing.value = true
  try {
    for (const f of arr) {
      const path = await importFile(f)
      attachments.value.push({ path, image: fileKind(path) === 'image' })
    }
    await files.refreshTree()
  } finally {
    importing.value = false
  }
}

function onPaste(e: ClipboardEvent): void {
  const items = e.clipboardData?.items
  if (!items) return
  const incoming: File[] = []
  for (const item of items) {
    if (item.kind !== 'file') continue
    const f = item.getAsFile()
    if (f) incoming.push(f)
  }
  if (incoming.length) {
    e.preventDefault() // don't paste the filename as text
    void addFiles(incoming)
  }
}

function onDrop(e: DragEvent): void {
  dragOver.value = false
  if (e.dataTransfer?.files.length) {
    e.preventDefault()
    e.stopPropagation()
    void addFiles(e.dataTransfer.files)
  }
}

function onPickFiles(e: Event): void {
  const el = e.target as HTMLInputElement
  if (el.files) void addFiles(el.files)
  el.value = ''
}

function removeAttachment(i: number): void {
  attachments.value.splice(i, 1)
}

function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}

/* ── @-mention autocomplete ──────────────────────────────────────────────── */

const caret = ref(0)
const mentionOpen = ref(false)
const mentionSel = ref(0)

function syncCaret(): void {
  caret.value = textarea.value?.selectionStart ?? input.value.length
}

const mention = computed(() => (mentionOpen.value ? mentionQueryAt(input.value, caret.value) : null))
const mentionMatches = computed(() =>
  mention.value ? filterFiles(files.allFiles, mention.value.query) : [],
)

watch([input, caret], () => {
  const q = mentionQueryAt(input.value, caret.value)
  mentionOpen.value = !!q
  mentionSel.value = 0
})

function pickMention(path: string): void {
  const m = mention.value
  if (!m) return
  const before = input.value.slice(0, m.start)
  const after = input.value.slice(caret.value)
  input.value = `${before}@${path} ${after}`
  mentionOpen.value = false
  void nextTick(() => {
    const pos = m.start + path.length + 2
    textarea.value?.focus()
    textarea.value?.setSelectionRange(pos, pos)
    caret.value = pos
  })
}

/* ── sending ─────────────────────────────────────────────────────────────── */

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
  const atts = [...attachments.value]
  input.value = ''
  attachments.value = []
  mentionOpen.value = false
  await chat.send(text, atts)
}

function onKeydown(e: KeyboardEvent): void {
  if (mentionOpen.value && mentionMatches.value.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      mentionSel.value = (mentionSel.value + 1) % mentionMatches.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      mentionSel.value = (mentionSel.value - 1 + mentionMatches.value.length) % mentionMatches.value.length
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      pickMention(mentionMatches.value[mentionSel.value])
      return
    }
    if (e.key === 'Escape') {
      mentionOpen.value = false
      return
    }
  }
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
        return m.parts.length + (last?.type !== 'tool' ? (last?.text.length ?? 0) : 0)
      })
      .join(),
  async () => {
    await nextTick()
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
  },
)
</script>

<template>
  <div class="h-full flex flex-col bg-bg-1 relative">
    <!-- Header -->
    <div class="flex items-center gap-2 px-3 h-9 border-b border-border shrink-0">
      <span class="codicon codicon-sm codicon-sparkle text-accent" />
      <span class="text-xs uppercase tracking-wide text-fg-3 flex-1">Agent</span>
      <button class="text-fg-3 hover:text-fg-0" title="New chat" @click="chat.newSession()">
        <span class="codicon codicon-sm codicon-add" />
      </button>
      <button
        class="text-fg-3 hover:text-fg-0"
        :class="{ '!text-accent': chat.historyOpen }"
        title="Chat history"
        @click="chat.historyOpen = !chat.historyOpen"
      >
        <span class="codicon codicon-sm codicon-history" />
      </button>
      <button class="text-fg-3 hover:text-fg-0" title="Settings" @click="emit('openSettings')">
        <span class="codicon codicon-sm codicon-gear" />
      </button>
    </div>

    <!-- Session history overlay -->
    <div v-if="chat.historyOpen" class="absolute inset-x-0 top-9 bottom-0 z-10 bg-bg-1 panel-scroll">
      <div v-if="!chat.sessions.length" class="p-4 text-xs text-fg-3">No previous chats</div>
      <div
        v-for="s in chat.sessions"
        :key="s.id"
        class="group flex items-center gap-2 px-3 py-2 hover:bg-bg-2 cursor-pointer border-b border-border/50"
        :class="{ 'bg-bg-2': s.id === chat.currentSessionId }"
        @click="chat.openSession(s.id)"
      >
        <span class="codicon codicon-sm codicon-comment-discussion text-fg-3 shrink-0" />
        <span class="flex-1 truncate text-sm text-fg-1">{{ s.title }}</span>
        <span class="text-xs text-fg-3 shrink-0">
          {{ new Date(s.updatedAt).toLocaleDateString() }}
        </span>
        <button
          class="text-fg-3 hover:text-removed opacity-0 group-hover:opacity-100"
          title="Delete"
          @click.stop="chat.removeSession(s.id)"
        >
          <span class="codicon codicon-sm codicon-trash" />
        </button>
      </div>
    </div>

    <!-- Transcript -->
    <div ref="scroller" class="flex-1 panel-scroll px-3 py-3 space-y-4">
      <div v-if="!chat.messages.length" class="text-xs text-fg-3 leading-relaxed">
        Ask questions about your knowledge base, or let the agent maintain it. It can list, read,
        search, index and write files in the opened folder — writes appear in the review panel.
        Paste screenshots or drop files here to add them; type @ to reference a file.
      </div>

      <div v-for="m in chat.messages" :key="m.id">
        <div
          v-if="m.role === 'user'"
          class="rounded-lg bg-accent/10 border border-accent/20 px-3 py-2 selectable text-fg-0"
        >
          <div class="whitespace-pre-wrap">{{ userText(m) }}</div>
          <div v-if="m.attachments?.length" class="flex flex-wrap gap-1.5 mt-1.5">
            <button
              v-for="(a, i) in m.attachments"
              :key="i"
              class="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-bg-2 text-fg-2 hover:text-fg-0"
              :title="a.path"
              @click="files.openFile(a.path)"
            >
              <span class="codicon codicon-sm" :class="a.image ? 'codicon-device-camera' : 'codicon-file'" />
              <span class="truncate max-w-[160px]">{{ baseName(a.path) }}</span>
            </button>
          </div>
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
            <details v-else-if="part.type === 'thinking'" class="text-xs text-fg-3">
              <summary class="cursor-pointer select-none hover:text-fg-2">
                <span class="codicon codicon-sm codicon-lightbulb mr-1" />Thinking
              </summary>
              <div class="pl-4 pt-1 whitespace-pre-wrap selectable italic leading-relaxed">
                {{ part.text }}
              </div>
            </details>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-else class="md-preview text-sm" v-html="renderPart(part)" @click="onPreviewClick" />
          </template>
          <div v-if="m.error" class="text-xs text-removed">{{ m.error }}</div>
          <div
            v-if="chat.running && m === chat.messages[chat.messages.length - 1] && !m.parts.length"
            class="text-xs text-fg-3"
          >
            Thinking…
          </div>
        </div>
      </div>
    </div>

    <!-- Agent plan (update_plan tool) -->
    <div
      v-if="plan.items.length"
      class="mx-3 mb-2 rounded-md border border-border bg-bg-2/50 px-3 py-2 shrink-0 max-h-40 overflow-y-auto"
    >
      <div class="flex items-center gap-1.5 text-xs text-fg-3 uppercase tracking-wide mb-1.5">
        <span class="codicon codicon-sm codicon-checklist" />
        Plan
        <span class="normal-case">
          {{ plan.items.filter((i) => i.status === 'done').length }}/{{ plan.items.length }}
        </span>
        <span class="flex-1" />
        <button class="hover:text-fg-0" title="Dismiss" @click="plan.clear()">
          <span class="codicon codicon-sm codicon-close" />
        </button>
      </div>
      <div
        v-for="(item, i) in plan.items"
        :key="i"
        class="flex items-start gap-1.5 text-xs py-0.5"
        :class="item.status === 'done' ? 'text-fg-3 line-through' : 'text-fg-1'"
      >
        <span class="codicon codicon-sm shrink-0 mt-px" :class="PLAN_ICONS[item.status]" />
        <span>{{ item.text }}</span>
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
    <div
      class="p-3 border-t shrink-0 relative"
      :class="dragOver ? 'border-accent bg-accent/5' : 'border-border'"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop="onDrop"
    >
      <!-- @-mention dropdown -->
      <div
        v-if="mentionOpen && mentionMatches.length"
        class="absolute bottom-full left-3 right-3 mb-1 z-20 rounded-md border border-border bg-bg-1 shadow-lg overflow-hidden"
      >
        <button
          v-for="(p, i) in mentionMatches"
          :key="p"
          class="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs"
          :class="i === mentionSel ? 'bg-accent/15 text-fg-0' : 'text-fg-2 hover:bg-bg-2'"
          @mousedown.prevent="pickMention(p)"
          @mousemove="mentionSel = i"
        >
          <span class="codicon codicon-sm codicon-file shrink-0" />
          <span class="truncate">{{ p }}</span>
        </button>
      </div>

      <!-- Attachment chips -->
      <div v-if="attachments.length || importing" class="flex flex-wrap gap-1.5 mb-2">
        <span
          v-for="(a, i) in attachments"
          :key="a.path"
          class="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-bg-2 text-fg-2"
          :title="a.path"
        >
          <span class="codicon codicon-sm" :class="a.image ? 'codicon-device-camera' : 'codicon-file'" />
          <span class="truncate max-w-[140px]">{{ baseName(a.path) }}</span>
          <button class="text-fg-3 hover:text-fg-0" @click="removeAttachment(i)">
            <span class="codicon codicon-sm codicon-close" />
          </button>
        </span>
        <span v-if="importing" class="text-xs text-fg-3 px-1 py-0.5">saving…</span>
      </div>

      <textarea
        ref="textarea"
        v-model="input"
        rows="3"
        class="input resize-none font-sans"
        placeholder="Ask or instruct the agent… (@ 引用文件,可粘贴截图)"
        @keydown="onKeydown"
        @paste="onPaste"
        @input="syncCaret"
        @click="syncCaret"
        @keyup="syncCaret"
      />
      <input ref="fileInput" type="file" multiple class="hidden" @change="onPickFiles" />
      <div class="flex items-center mt-2 gap-2">
        <button
          class="text-fg-3 hover:text-fg-0 shrink-0"
          title="Attach files (saved into the KB)"
          @click="fileInput?.click()"
        >
          <span class="codicon codicon-sm codicon-attach" />
        </button>
        <span class="text-xs text-fg-3 flex-1 truncate">
          {{ settingsStore.primary?.model || 'not configured' }}
          <span v-if="settingsStore.visionAvailable" title="视觉理解可用">· 👁</span>
        </span>
        <button v-if="chat.running" class="btn text-xs" @click="chat.stop()">
          <span class="codicon codicon-sm codicon-stop-circle mr-1" />Stop
        </button>
        <button
          v-else
          class="btn-primary text-xs"
          :disabled="!input.trim() && !attachments.length"
          @click="send"
        >
          <span class="codicon codicon-sm codicon-send mr-1" />Send
        </button>
      </div>
    </div>
  </div>
</template>
