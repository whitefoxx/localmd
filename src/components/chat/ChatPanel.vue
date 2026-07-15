<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useChatStore, type Attachment, type UiMessage } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { usePlanStore } from '@/stores/plan'
import { useSkillsStore } from '@/stores/skillsStore'
import { renderMarkdown } from '@/lib/markdown'
import { parseCiteSources } from '@/lib/citations'
import { importFile } from '@/lib/capture'
import { mentionQueryAt, filterFiles } from '@/lib/mentions'
import { fileKind } from '@/lib/filetypes'
import type { MessagePart } from '@/stores/chat'

const emit = defineEmits<{ openSettings: []; close: [] }>()

const chat = useChatStore()
const settingsStore = useSettingsStore()
const ui = useUiStore()
const files = useFilesStore()
const citations = useCitationsStore()
const plan = usePlanStore()
const skills = useSkillsStore()

const PLAN_ICONS = {
  pending: 'codicon-circle-large-outline text-fg-3',
  in_progress: 'codicon-play-circle text-accent',
  done: 'codicon-pass-filled text-added',
} as const

/** The ACTIVE session's plan — each chat tab keeps its own. */
const planItems = computed(() => plan.itemsFor(chat.currentSessionId))

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

function fmtTokens(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/* ── tool call loading + timer ──────────────────────────────────────────────
 * External MCP tool calls carry a status/timer; a shared clock ticks once a
 * second while a turn is running so in-flight timers advance without churning
 * the transcript when idle. */
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
watch(
  () => chat.running,
  (r) => {
    clearInterval(clock)
    clock = undefined
    if (r) {
      now.value = Date.now()
      clock = setInterval(() => (now.value = Date.now()), 1000)
    }
  },
  { immediate: true },
)
onUnmounted(() => clearInterval(clock))

/* ⌘↑/⌘↓ scroll the transcript to top/bottom while the panel is open — even
 * from the input (jumping the conversation beats moving the caret there).
 * Reaching the bottom re-arms auto-follow via the scroll handler itself. */
function onScrollHotkey(e: KeyboardEvent): void {
  if (!ui.agentOpen || e.defaultPrevented) return
  if (!(e.metaKey || e.ctrlKey) || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
  const el = scroller.value
  if (!el) return
  e.preventDefault()
  el.scrollTo({ top: e.key === 'ArrowDown' ? el.scrollHeight : 0, behavior: 'smooth' })
}
onMounted(() => window.addEventListener('keydown', onScrollHotkey))
onUnmounted(() => window.removeEventListener('keydown', onScrollHotkey))

type ToolPart = Extract<MessagePart, { type: 'tool' }>

function toolTime(part: ToolPart): string {
  if (part.status === 'running') {
    return `${Math.floor((now.value - (part.startedAt ?? now.value)) / 1000)}s`
  }
  const ms = part.elapsedMs ?? 0
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`
}

/** Per-tool glyph so the transcript reads at a glance instead of a wall of
 *  identical wrenches. External MCP tools carry a status, so they keep the
 *  spinner/check/error markers; built-in (status-less) tools map by name. */
const TOOL_ICONS: Record<string, string> = {
  list_files: 'codicon-list-tree',
  read_file: 'codicon-file',
  write_file: 'codicon-edit',
  edit_file: 'codicon-edit',
  search_files: 'codicon-search',
  index_document: 'codicon-book',
  create_artifact: 'codicon-file-code',
  update_plan: 'codicon-checklist',
  use_skill: 'codicon-lightbulb',
  enable_tools: 'codicon-plug',
  run_subagent: 'codicon-run-all',
  view_image: 'codicon-device-camera',
  compact: 'codicon-fold',
  checkpoint: 'codicon-git-commit',
  git_status: 'codicon-source-control',
  git_diff: 'codicon-diff',
  git_log: 'codicon-history',
  git_commit: 'codicon-git-commit',
  git_push: 'codicon-repo-push',
  git_pull: 'codicon-repo-pull',
}

function toolIcon(part: ToolPart): string {
  if (part.status === 'running') return 'codicon-loading codicon-modifier-spin'
  if (part.status === 'error') return 'codicon-error'
  if (part.status === 'done') return 'codicon-pass'
  if (part.name.startsWith('mcp__')) return 'codicon-plug'
  return TOOL_ICONS[part.name] ?? 'codicon-tools'
}

/* A thinking block auto-expands while it is actively streaming (the tail of the
 * live assistant message), then STAYS open — the user collapses it by hand, and
 * that choice sticks (tracked in `collapsedThinking`, keyed by message+part). */
function thinkingStreaming(m: UiMessage, i: number): boolean {
  return (
    chat.running &&
    m === chat.messages[chat.messages.length - 1] &&
    i === m.parts.length - 1
  )
}

const collapsedThinking = ref<Set<string>>(new Set())
function thinkKey(m: UiMessage, i: number): string {
  return `${m.id}:${i}`
}
function thinkingOpen(m: UiMessage, i: number): boolean {
  return thinkingStreaming(m, i) || !collapsedThinking.value.has(thinkKey(m, i))
}
function onThinkingToggle(m: UiMessage, i: number, e: Event): void {
  // Ignore programmatic toggles while streaming forces it open; only record the
  // user's own collapse/expand once the block is settled.
  if (thinkingStreaming(m, i)) return
  const open = (e.target as HTMLDetailsElement).open
  const key = thinkKey(m, i)
  const next = new Set(collapsedThinking.value)
  if (open) next.delete(key)
  else next.add(key)
  collapsedThinking.value = next
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

/* ── /skill autocomplete (input must START with the slash token) ─────────── */

const slashSel = ref(0)

const slashQuery = computed(() => {
  const upto = input.value.slice(0, caret.value)
  const m = /^\/([\w-]*)$/.exec(upto)
  return m ? m[1] : null
})
const slashMatches = computed(() =>
  slashQuery.value === null
    ? []
    : skills.all.filter((s) => s.name.toLowerCase().startsWith(slashQuery.value!.toLowerCase())),
)

watch(slashQuery, (q) => {
  slashSel.value = 0
  if (q !== null) void skills.refresh() // lazy re-scan when the menu opens
})

function pickSkill(name: string): void {
  const after = input.value.slice(caret.value)
  input.value = `/${name} ${after}`
  void nextTick(() => {
    const pos = name.length + 2
    textarea.value?.focus()
    textarea.value?.setSelectionRange(pos, pos)
    caret.value = pos
  })
}

/* ── sending ─────────────────────────────────────────────────────────────── */

/** Citation declarations across the WHOLE transcript: messages render part by
 *  part, so [[1:bxx]] often sits in a different part (or message) than its
 *  [[pdf1:…]] declaration. First declaration of a number wins. */
const sessionCiteSources = computed(() => {
  const all = chat.messages
    .flatMap((m) => m.parts)
    .filter((p): p is MessagePart & { type: 'text' } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
  return parseCiteSources(all)
})

function renderPart(part: MessagePart & { type: 'text' }): string {
  return renderMarkdown(
    part.text,
    { resolve: (t) => files.resolveWikilink(t) },
    { citeSources: sessionCiteSources.value },
  )
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
  if (slashMatches.value.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      slashSel.value = (slashSel.value + 1) % slashMatches.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      slashSel.value = (slashSel.value - 1 + slashMatches.value.length) % slashMatches.value.length
      return
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && slashQuery.value !== slashMatches.value[slashSel.value].name)) {
      e.preventDefault()
      pickSkill(slashMatches.value[slashSel.value].name)
      return
    }
  }
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
    else if (a.dataset.block) await citations.openByBlock(a.dataset.block)
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
  // Standard markdown links open the KB file. Chat isn't anchored to a file,
  // so resolve against the KB (bundle) root — absolute /… and bare paths both
  // land correctly there.
  const rel = files.resolveMarkdownLink('', href)
  if (rel) await files.openFile(rel)
}

// Keep the transcript pinned to the bottom while streaming — but ONLY while
// the user is already there. Scrolling up detaches (so they can read during
// a stream); scrolling back near the bottom re-attaches.
const autoFollow = ref(true)

function onTranscriptScroll(): void {
  const el = scroller.value
  if (!el) return
  autoFollow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 60
}

watch(
  () =>
    chat.messages
      .map((m) => {
        const last = m.parts[m.parts.length - 1]
        const tail = last && (last.type === 'text' || last.type === 'thinking') ? last.text.length : 0
        return m.parts.length + tail
      })
      .join(),
  async () => {
    if (!autoFollow.value) return
    await nextTick()
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
  },
)

// A new user message always jumps to the bottom (they just sent it).
watch(
  () => chat.messages.length,
  async () => {
    autoFollow.value = true
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
      <button class="text-fg-3 hover:text-fg-0" title="Close agent panel (⌘J)" @click="emit('close')">
        <span class="codicon codicon-sm codicon-close" />
      </button>
    </div>

    <!-- Session tabs (concurrent chats). Tabs shrink evenly to fit the panel
         width (VS Code style) so the close button never scrolls out of view. -->
    <div v-if="chat.tabs.length > 1" class="flex items-stretch h-8 border-b border-border bg-bg-1 shrink-0">
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
          class="codicon codicon-sm codicon-close text-fg-3 hover:text-fg-0 opacity-0 group-hover:opacity-100 shrink-0"
          :class="{ '!opacity-100': t.id === chat.currentSessionId }"
          @click.stop="chat.closeTab(t.id)"
        />
      </button>
    </div>
    <div
      v-if="chat.limitMsg"
      class="px-3 py-1 text-[11px] text-yellow-700 dark:text-yellow-300 bg-yellow-500/10 border-b border-border shrink-0"
    >
      {{ chat.limitMsg }}
    </div>

    <!-- Session history overlay -->
    <div v-if="chat.historyOpen" class="absolute inset-x-0 top-9 bottom-0 z-10 bg-bg-1 panel-scroll">
      <div v-if="!chat.sessions.length" class="p-4 text-xs text-fg-3">No previous chats</div>
      <!-- active = the one on screen (unique); open = loaded in a tab (many). -->
      <div
        v-for="s in chat.sessions"
        :key="s.id"
        class="group relative flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-border/50"
        :class="
          s.id === chat.currentSessionId
            ? 'bg-accent/15'
            : chat.tabs.some((t) => t.id === s.id)
              ? 'bg-bg-2 hover:bg-bg-3'
              : 'hover:bg-bg-2/60'
        "
        @click="chat.openSession(s.id)"
      >
        <span
          v-if="s.id === chat.currentSessionId"
          class="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-accent"
        />
        <span
          class="codicon codicon-sm shrink-0"
          :class="
            chat.tabs.some((t) => t.id === s.id)
              ? `codicon-circle-filled ${s.id === chat.currentSessionId ? 'text-accent' : 'text-fg-2'}`
              : 'codicon-comment-discussion text-fg-3'
          "
        />
        <span
          class="flex-1 truncate text-sm"
          :class="s.id === chat.currentSessionId ? 'text-fg-0 font-medium' : 'text-fg-1'"
        >{{ s.title }}</span>
        <span
          v-if="s.id === chat.currentSessionId"
          class="text-[10px] px-1 rounded bg-accent/20 text-accent shrink-0"
        >当前</span>
        <span
          v-else-if="chat.tabs.some((t) => t.id === s.id)"
          class="text-[10px] px-1 rounded bg-bg-3 text-fg-3 shrink-0"
        >已打开</span>
        <span class="text-xs text-fg-3 shrink-0">
          {{ new Date(s.updatedAt).toLocaleDateString() }}
        </span>
        <button
          class="text-fg-3 hover:text-removed opacity-0 group-hover:opacity-100 shrink-0"
          title="Delete"
          @click.stop="chat.removeSession(s.id)"
        >
          <span class="codicon codicon-sm codicon-trash" />
        </button>
      </div>
    </div>

    <!-- Transcript -->
    <div ref="scroller" class="flex-1 panel-scroll px-3 py-3 space-y-4" @scroll.passive="onTranscriptScroll">
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
              class="flex items-center gap-1.5 text-xs font-mono"
              :class="part.status === 'running' ? 'text-fg-2' : part.status === 'error' ? 'text-removed' : 'text-fg-3'"
            >
              <span class="codicon codicon-sm shrink-0" :class="toolIcon(part)" />
              <span class="truncate">{{ part.detail }}</span>
              <span v-if="part.status" class="shrink-0 tabular-nums text-fg-3">{{ toolTime(part) }}</span>
            </div>
            <details
              v-else-if="part.type === 'thinking'"
              class="text-xs text-fg-3"
              :open="thinkingOpen(m, i)"
              @toggle="onThinkingToggle(m, i, $event)"
            >
              <summary class="cursor-pointer select-none hover:text-fg-2">
                <span class="codicon codicon-sm codicon-lightbulb mr-1" />Thinking
              </summary>
              <div class="pl-4 pt-1 whitespace-pre-wrap selectable italic leading-relaxed">
                {{ part.text }}
              </div>
            </details>
            <button
              v-else-if="part.type === 'artifact'"
              class="w-full flex items-center gap-2.5 my-2.5 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5 text-left transition-colors"
              :class="part.pending ? 'cursor-default' : 'hover:bg-accent/10'"
              :disabled="part.pending"
              :title="part.pending ? '' : part.path"
              @click="!part.pending && files.openFile(part.path)"
            >
              <span
                class="codicon shrink-0 text-accent"
                :class="part.pending ? 'codicon-loading codicon-modifier-spin' : 'codicon-file-code'"
              />
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-medium text-fg-0 truncate">
                  {{ part.pending ? '正在生成 artifact…' : part.title }}
                </span>
                <span class="block text-xs text-fg-3">
                  {{ part.pending ? '请稍候,HTML 生成中' : 'HTML artifact · 点击打开' }}
                </span>
              </span>
              <span
                v-if="!part.pending"
                class="codicon codicon-sm codicon-arrow-right text-fg-3 shrink-0"
              />
            </button>
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

    <!-- Agent plan (update_plan tool, per session) -->
    <div
      v-if="planItems.length"
      class="mx-3 mb-2 rounded-md border border-border bg-bg-2/50 px-3 py-2 shrink-0 max-h-40 overflow-y-auto"
    >
      <div class="flex items-center gap-1.5 text-xs text-fg-3 uppercase tracking-wide mb-1.5">
        <span class="codicon codicon-sm codicon-checklist" />
        Plan
        <span class="normal-case">
          {{ planItems.filter((i) => i.status === 'done').length }}/{{ planItems.length }}
        </span>
        <span class="flex-1" />
        <button
          class="hover:text-fg-0"
          title="Dismiss"
          @click="chat.currentSessionId && plan.clear(chat.currentSessionId)"
        >
          <span class="codicon codicon-sm codicon-close" />
        </button>
      </div>
      <div
        v-for="(item, i) in planItems"
        :key="i"
        class="flex items-start gap-1.5 text-xs py-0.5"
        :class="item.status === 'done' ? 'text-fg-3 line-through' : 'text-fg-1'"
      >
        <span class="codicon codicon-sm shrink-0 mt-px" :class="PLAN_ICONS[item.status]" />
        <span>{{ item.text }}</span>
      </div>
    </div>

    <!-- Presets: KB skills when present, built-in prompts otherwise -->
    <div v-if="!chat.messages.length" class="px-3 pb-2 flex gap-2 shrink-0 flex-wrap">
      <template v-if="skills.all.length">
        <button
          v-for="s in skills.all.slice(0, 4)"
          :key="s.name"
          class="btn text-xs"
          :title="s.description"
          @click="preset(`/${s.name} `)"
        >
          /{{ s.name }}
        </button>
      </template>
      <template v-else>
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
      </template>
    </div>

    <!-- Input -->
    <div
      class="p-3 border-t shrink-0 relative"
      :class="dragOver ? 'border-accent bg-accent/5' : 'border-border'"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop="onDrop"
    >
      <!-- /skill dropdown -->
      <div
        v-if="slashMatches.length"
        class="absolute bottom-full left-3 right-3 mb-1 z-20 rounded-md border border-border bg-bg-1 shadow-lg overflow-hidden"
      >
        <button
          v-for="(s, i) in slashMatches"
          :key="s.name"
          class="w-full flex items-baseline gap-2 px-2 py-1.5 text-left text-xs"
          :class="i === slashSel ? 'bg-accent/15 text-fg-0' : 'text-fg-2 hover:bg-bg-2'"
          @mousedown.prevent="pickSkill(s.name)"
          @mousemove="slashSel = i"
        >
          <span class="font-mono shrink-0">/{{ s.name }}</span>
          <span class="truncate text-fg-3">{{ s.description }}</span>
        </button>
      </div>

      <!-- @-mention dropdown -->
      <div
        v-if="mentionOpen && mentionMatches.length && !slashMatches.length"
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

      <!-- ChatGPT-style composer: one rounded frame holding the attachment
           chips, the borderless textarea, and the +/model/send action row. -->
      <div
        class="rounded-xl border bg-bg-0 focus-within:border-accent transition-colors"
        :class="dragOver ? 'border-accent' : 'border-border'"
      >
        <!-- Attachment chips -->
        <div v-if="attachments.length || importing" class="flex flex-wrap gap-1.5 px-3 pt-2.5">
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
          class="w-full bg-transparent border-0 outline-none resize-none font-sans text-sm text-fg-0 placeholder-fg-3 px-3 pt-2.5"
          placeholder="Ask or instruct the agent… (@ 引用文件 / 技能,可粘贴截图)"
          @keydown="onKeydown"
          @paste="onPaste"
          @input="syncCaret"
          @click="syncCaret"
          @keyup="syncCaret"
        />
        <input ref="fileInput" type="file" multiple class="hidden" @change="onPickFiles" />

        <!-- Action row (inside the frame) -->
        <div class="flex items-center gap-2 px-2 pb-2">
          <button
            class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-fg-2 hover:text-fg-0 hover:bg-bg-2 transition-colors"
            title="Attach files (saved into the KB)"
            aria-label="Attach files"
            @click="fileInput?.click()"
          >
            <span class="codicon codicon-add" />
          </button>
          <span class="text-xs text-fg-3 flex-1 truncate">
            {{ settingsStore.primary?.model || 'not configured' }}
            <span v-if="settingsStore.visionAvailable" title="视觉理解可用">· 👁</span>
            <span
              v-if="chat.sessionUsage.input || chat.sessionUsage.output"
              :title="`本会话 token:输入 ${chat.sessionUsage.input.toLocaleString()},输出 ${chat.sessionUsage.output.toLocaleString()}${chat.sessionUsage.cacheRead ? `,缓存命中 ${chat.sessionUsage.cacheRead.toLocaleString()}` : ''}`"
            >
              · ↑{{ fmtTokens(chat.sessionUsage.input) }} ↓{{ fmtTokens(chat.sessionUsage.output) }}
            </span>
          </span>
          <button
            v-if="chat.running"
            class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center bg-bg-3 text-fg-0 hover:bg-removed/20 hover:text-removed transition-colors"
            title="Stop"
            aria-label="Stop"
            @click="chat.stop()"
          >
            <span class="codicon codicon-sm codicon-primitive-square" />
          </button>
          <button
            v-else
            class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
            title="Send (Enter)"
            aria-label="Send"
            :disabled="!input.trim() && !attachments.length"
            @click="send"
          >
            <span class="codicon codicon-arrow-up" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
