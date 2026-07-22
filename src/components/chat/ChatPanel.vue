<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useChatStore, type Attachment, type UiMessage } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { usePlanStore } from '@/stores/plan'
import { useSkillsStore } from '@/stores/skillsStore'
import { useComposerStore } from '@/stores/composer'
import { useFileSelectionCapture } from '@/lib/selectionContext'
import { renderMarkdown } from '@/lib/markdown'
import { copyText, flashCopy, handleCodeCopy } from '@/lib/copyCode'
import { parseCiteSources } from '@/lib/citations'
import { classifyAnchor, createSourceCollector, type Source } from '@/lib/sources'
import { importTempFile } from '@/lib/capture'
import { mentionQueryAt, filterFiles } from '@/lib/mentions'
import { fileKind } from '@/lib/filetypes'
import * as fs from '@/lib/fs'
import KbImageThumb from './KbImageThumb.vue'
import type { MessagePart } from '@/stores/chat'
import { t } from '@/i18n'

const emit = defineEmits<{ openSettings: []; close: [] }>()

const chat = useChatStore()
const settingsStore = useSettingsStore()
const ui = useUiStore()
const files = useFilesStore()
const citations = useCitationsStore()
const plan = usePlanStore()
const skills = useSkillsStore()
const composer = useComposerStore()

// Stage text selected in the open file as removable context chips (agent-open).
useFileSelectionCapture()

/** One-line preview of a staged selection for its chip. */
function snippet(text: string): string {
  const first = text.split('\n', 1)[0].trim()
  return first.length > 60 ? `${first.slice(0, 60)}…` : first
}

const PLAN_ICONS = {
  pending: 'codicon-circle-large-outline text-fg-3',
  in_progress: 'codicon-play-circle text-accent',
  done: 'codicon-pass-filled text-added',
} as const

/** The ACTIVE session's plan — each chat tab keeps its own. */
const planItems = computed(() => plan.itemsFor(chat.currentSessionId))

const input = ref('')
/** Anything to send? Also gates steering — an interjection needs real content. */
const canSend = computed(
  () => !!input.value.trim() || attachments.value.length > 0 || composer.refs.length > 0,
)
const scroller = ref<HTMLElement | null>(null)
const textarea = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

/* ── attachments (paste / upload / drop → saved into the KB) ─────────────── */

const attachments = ref<Attachment[]>([])
const importing = ref(false)
const dragOver = ref(false)

/* Object-URL thumbnails for image attachments, keyed by KB path. Built from the
 * in-memory File (no disk re-read) and revoked on remove / send / unmount. */
const thumbs = ref<Map<string, string>>(new Map())
function thumbFor(path: string): string | undefined {
  return thumbs.value.get(path)
}
function revokeThumb(path: string): void {
  const u = thumbs.value.get(path)
  if (u) {
    URL.revokeObjectURL(u)
    thumbs.value.delete(path)
  }
}
function revokeAllThumbs(): void {
  for (const u of thumbs.value.values()) URL.revokeObjectURL(u)
  thumbs.value.clear()
}

async function addFiles(list: File[] | FileList): Promise<void> {
  const arr = Array.from(list)
  if (!arr.length) return
  importing.value = true
  try {
    for (const f of arr) {
      const path = await importTempFile(f)
      const image = fileKind(path) === 'image'
      attachments.value.push({ path, image })
      if (image) thumbs.value.set(path, URL.createObjectURL(f))
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
  const [a] = attachments.value.splice(i, 1)
  if (a) revokeThumb(a.path)
}

function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}

function fmtTokens(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** Localized tooltip for the per-session token counter. Cache read/write
 *  totals verify that prompt caching is actually landing (reads are billed at
 *  a fraction of fresh input). */
const usageTitle = computed(() => {
  const u = chat.sessionUsage
  let s = t('chat.tokenUsage', {
    input: u.input.toLocaleString(),
    output: u.output.toLocaleString(),
  })
  if (u.cacheRead) s += t('chat.tokenCacheSuffix', { cache: u.cacheRead.toLocaleString() })
  if (u.cacheWrite) s += t('chat.tokenCacheWriteSuffix', { cache: u.cacheWrite.toLocaleString() })
  return s
})

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
onUnmounted(() => {
  clearInterval(clock)
  revokeAllThumbs()
})

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
type ThinkPart = Extract<MessagePart, { type: 'thinking' }>

function toolTime(part: ToolPart): string {
  if (part.status === 'running') {
    return `${Math.floor((now.value - (part.startedAt ?? now.value)) / 1000)}s`
  }
  const ms = part.elapsedMs ?? 0
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`
}

/** Thinking duration: live-ticking while the block streams, frozen once sealed.
 *  Empty for pre-timing transcripts (no startedAt). */
function thinkTime(part: ThinkPart): string {
  if (part.elapsedMs != null) {
    const ms = part.elapsedMs
    return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`
  }
  if (part.startedAt == null) return ''
  return `${Math.floor((now.value - part.startedAt) / 1000)}s`
}

/** Per-tool glyph so the transcript reads at a glance instead of a wall of
 *  identical wrenches. While a tool runs it shows a spinner; once done, built-in
 *  tools settle back to their own glyph (below) and MCP tools show a check. */
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
  generate_image: 'codicon-file-media',
  compact: 'codicon-fold',
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
  // MCP tools have no per-name glyph, so a finished one shows a check; built-in
  // tools fall through to their own icon (spinner only shows while running).
  if (part.name.startsWith('mcp__')) return part.status === 'done' ? 'codicon-pass' : 'codicon-plug'
  return TOOL_ICONS[part.name] ?? 'codicon-tools'
}

/** Tool calls that carry non-empty args (MCP tools) render as an expandable
 *  disclosure so the full parameters can be toggled open. */
function toolHasArgs(part: ToolPart): boolean {
  return !!part.args && Object.keys(part.args).length > 0
}

/** Expandable once there's anything to inspect — the call's args and/or its
 *  result (the result arrives with tool_result, so no-arg tools gain the
 *  chevron on completion). */
function toolExpandable(part: ToolPart): boolean {
  return toolHasArgs(part) || !!part.result
}

function formatArgs(part: ToolPart): string {
  try {
    return JSON.stringify(part.args, null, 2)
  } catch {
    return String(part.args)
  }
}

/** Copy a tool call's args/result; flashes the clicked button's icon. */
async function copyBlock(e: MouseEvent, text: string): Promise<void> {
  const ok = await copyText(text)
  flashCopy(e.currentTarget as HTMLElement, ok)
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

/* ── reply citations (superscripts + Sources footer) ─────────────────────────
 * The references an agent leaves in a reply — [[wikilinks]] to KB files and
 * links to external URLs — become numbered citations: a superscript after each
 * reference, plus a Sources list under the message. Numbering is shared across
 * a message's text parts. Result is memoized per message (keyed by the reactive
 * object, invalidated by a content signature) so replies above a streaming one
 * aren't re-parsed on every delta. */
interface ReplyRender {
  html: Map<number, string>
  sources: Source[]
}
const citeCache = new WeakMap<UiMessage, { sig: string; value: ReplyRender }>()

/** Inject a numbered superscript after every citable anchor in one part's HTML,
 *  registering each source with the shared collector. */
function annotateHtml(html: string, collector: ReturnType<typeof createSourceCollector>): string {
  if (!html.includes('<a')) return html
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.body.querySelectorAll('a').forEach((a) => {
      const src = classifyAnchor({
        classes: Array.from(a.classList),
        href: a.getAttribute('href'),
        dataTarget: a.dataset.target,
        dataResolved: a.dataset.resolved,
        text: a.textContent ?? '',
      })
      if (!src) return
      const n = collector.collect(src)
      const sup = doc.createElement('sup')
      sup.className = 'src-cite'
      const ref = doc.createElement('a')
      ref.href = '#'
      ref.className = 'src-cite-ref'
      ref.textContent = String(n)
      ref.title = src.target
      if (src.kind === 'url') ref.dataset.srcUrl = src.target
      else ref.dataset.srcPath = src.target
      sup.appendChild(ref)
      // A bare URL (the link text is the URL itself) clutters the reply — drop
      // it and keep only the citation superscript. A link with a real title (or
      // a KB wikilink) keeps its clickable label. The URL stays reachable via
      // the superscript (click/hover) and the Sources list either way.
      const bareUrl = src.kind === 'url' && /^https?:\/\//i.test((a.textContent ?? '').trim())
      if (bareUrl) a.replaceWith(sup)
      else a.after(sup)
    })
    return doc.body.innerHTML
  } catch {
    return html // never let a parse hiccup drop the reply
  }
}

function annotateAssistant(m: UiMessage): ReplyRender {
  const sig =
    m.parts.map((p) => (p.type === 'text' ? p.text : ` ${p.type}`)).join('') +
    `|${[...sessionCiteSources.value.keys()].join(',')}|${files.allFiles.length}`
  const cached = citeCache.get(m)
  if (cached && cached.sig === sig) return cached.value
  const collector = createSourceCollector()
  const html = new Map<number, string>()
  m.parts.forEach((part, i) => {
    if (part.type === 'text') html.set(i, annotateHtml(renderPart(part), collector))
  })
  const value: ReplyRender = { html, sources: collector.sources }
  citeCache.set(m, { sig, value })
  return value
}

/** Open a footer/superscript source: a URL in a new tab, a KB file in the app. */
async function openSource(s: Source): Promise<void> {
  if (s.kind === 'url') {
    window.open(s.target, '_blank', 'noopener')
    return
  }
  const rel = files.resolveMarkdownLink('', s.target) ?? s.target
  if (rel) {
    await files.openFile(rel)
    revealEditor()
  }
}

/** Compact display of a URL for the Sources list (host + path, no scheme). */
function prettyUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.host + (u.pathname && u.pathname !== '/' ? u.pathname : '')
  } catch {
    return url
  }
}

function userText(m: { parts: MessagePart[] }): string {
  const p = m.parts[0]
  return p?.type === 'text' ? p.text : ''
}

/** The copyable text of a message: the reply's markdown (or the user's prompt),
 *  joining all text parts and skipping tool/thinking/artifact chrome. */
function messageText(m: UiMessage): string {
  return m.parts
    .filter((p): p is MessagePart & { type: 'text' } => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n')
    .trim()
}

/** Which message was just copied — pins its action row open and shows a
 *  "Copied" hint for a moment (survives the cursor leaving the message). */
const copiedMsg = ref<number | null>(null)
let copiedTimer: number | undefined
async function copyMessage(e: MouseEvent, m: UiMessage): Promise<void> {
  const ok = await copyText(messageText(m))
  flashCopy(e.currentTarget as HTMLElement, ok)
  if (!ok) return
  copiedMsg.value = m.id
  window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => (copiedMsg.value = null), 1500)
}

/** Save the current conversation as a KB file. The user picks the location and
 *  can rename it in the browser's save dialog; the default name is the session's
 *  own title. If saved inside the open KB, refresh the tree so it shows up. */
const sessionSaved = ref('')
async function saveSession(): Promise<void> {
  const r = chat.renderSession()
  if (!r) return
  const root = fs.getRoot()
  let handle: FileSystemFileHandle
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: r.name,
      startIn: root,
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
    })
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return // user cancelled
    throw e
  }
  const w = await handle.createWritable()
  await w.write(r.content)
  await w.close()
  if (await root.resolve(handle)) void files.refreshTree()
  sessionSaved.value = handle.name
  window.setTimeout(() => (sessionSaved.value = ''), 2500)
}

async function send(): Promise<void> {
  if (!settingsStore.isConfigured()) {
    emit('openSettings')
    return
  }
  const text = input.value
  const atts = [...attachments.value]
  const sels = [...composer.refs]
  input.value = ''
  attachments.value = []
  composer.clear()
  revokeAllThumbs()
  mentionOpen.value = false
  await chat.send(text, atts, sels)
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

/** Opening a file navigates the main editor, which sits *behind* the maximized
 *  agent overlay — restore the panel so the just-opened file is actually
 *  visible. No-op when not maximized. */
function revealEditor(): void {
  if (ui.agentMaximized) ui.agentMaximized = false
}

async function onPreviewClick(e: MouseEvent): Promise<void> {
  if (handleCodeCopy(e)) return
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  e.preventDefault()
  if (a.classList.contains('citation') || a.classList.contains('cite-source')) {
    const path = a.dataset.citePath
    if (path) await citations.openCitation(path, a.dataset.block ?? null)
    else if (a.dataset.block) await citations.openByBlock(a.dataset.block)
    revealEditor()
    return
  }
  // Injected reply-citation superscript → jump to its source.
  if (a.classList.contains('src-cite-ref')) {
    if (a.dataset.srcUrl) window.open(a.dataset.srcUrl, '_blank', 'noopener')
    else if (a.dataset.srcPath) await openSource({ kind: 'file', target: a.dataset.srcPath, n: 0, label: '' })
    return
  }
  if (a.classList.contains('wikilink') && a.dataset.resolved === '1' && a.dataset.target) {
    await files.openFile(a.dataset.target)
    revealEditor()
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
  if (rel) {
    await files.openFile(rel)
    revealEditor()
  }
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
      <button
        class="text-fg-3 hover:text-fg-0 disabled:opacity-40 disabled:hover:text-fg-3"
        :title="$t('chat.saveSession')"
        :disabled="!chat.messages.length"
        @click="saveSession"
      >
        <span class="codicon codicon-sm codicon-download" />
      </button>
      <button
        class="disabled:opacity-40 disabled:hover:!text-fg-3"
        :class="chat.currentFavorite ? 'text-yellow-500 hover:text-yellow-400' : 'text-fg-3 hover:text-fg-0'"
        :title="chat.currentFavorite ? $t('chat.unfavoriteSession') : $t('chat.favoriteSession')"
        :disabled="!chat.messages.length"
        @click="chat.currentSessionId && chat.toggleFavorite(chat.currentSessionId)"
      >
        <span
          class="codicon codicon-sm"
          :class="chat.currentFavorite ? 'codicon-star-full' : 'codicon-star-empty'"
        />
      </button>
      <button class="text-fg-3 hover:text-fg-0" :title="$t('chat.newChat')" @click="chat.newSession()">
        <span class="codicon codicon-sm codicon-add" />
      </button>
      <button
        class="text-fg-3 hover:text-fg-0"
        :class="{ '!text-accent': chat.historyOpen }"
        :title="$t('chat.history')"
        @click="chat.historyOpen = !chat.historyOpen"
      >
        <span class="codicon codicon-sm codicon-history" />
      </button>
      <button
        class="text-fg-3 hover:text-fg-0"
        :title="ui.agentMaximized ? $t('chat.restorePanel') : $t('chat.maximizePanel')"
        @click="ui.agentMaximized = !ui.agentMaximized"
      >
        <span
          class="codicon codicon-sm"
          :class="ui.agentMaximized ? 'codicon-screen-normal' : 'codicon-screen-full'"
        />
      </button>
      <!-- Double chevron » = collapse the panel away (codicons has no native
           double-chevron, so two chevrons overlap). -->
      <button
        class="text-fg-3 hover:text-fg-0 inline-flex items-center"
        :title="$t('chat.collapsePanel')"
        @click="emit('close')"
      >
        <span class="codicon codicon-sm codicon-chevron-right" />
        <span class="codicon codicon-sm codicon-chevron-right -ml-[9px]" />
      </button>
    </div>

    <!-- Session-saved toast -->
    <div
      v-if="sessionSaved"
      class="absolute top-11 left-1/2 -translate-x-1/2 z-20 rounded-md border border-border bg-bg-3 px-3 py-1.5 text-xs text-fg-1 shadow-lg"
    >
      {{ $t('chat.savedToast', { name: sessionSaved }) }}
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

    <!-- Session history overlay. An opaque, NON-scrolling backdrop covers the
         transcript; a separate inner element does the scrolling. Keeping the
         opaque background off the scrolling layer is what stops fast/momentum
         scroll from bleeding the transcript through — a composited scroll-layer
         artifact that overscroll-behavior alone can't fix. The list is centered
         at the transcript's readable width when maximized. -->
    <div v-if="chat.historyOpen" class="absolute inset-x-0 top-9 bottom-0 z-10 bg-bg-1">
      <div class="h-full panel-scroll overscroll-contain">
      <div class="w-full" :class="{ 'max-w-3xl mx-auto': ui.agentMaximized }">
      <div v-if="!chat.sessions.length" class="p-4 text-xs text-fg-3">{{ $t('chat.noPreviousChats') }}</div>
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
        <span class="text-xs text-fg-3 shrink-0">
          {{ new Date(s.updatedAt).toLocaleDateString() }}
        </span>
        <button
          class="text-fg-3 hover:text-removed opacity-0 group-hover:opacity-100 shrink-0"
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
      </div>
      </div>
    </div>

    <!-- Transcript. Maximized → center the column at a readable width so long
         lines don't stretch edge to edge. -->
    <div
      ref="scroller"
      class="flex-1 panel-scroll px-3 py-3 space-y-4 w-full"
      :class="{ 'max-w-3xl mx-auto': ui.agentMaximized }"
      @scroll.passive="onTranscriptScroll"
    >
      <div v-if="!chat.messages.length" class="text-xs text-fg-3 leading-relaxed">
        {{ $t('chat.emptyState') }}
      </div>

      <div v-for="m in chat.messages" :key="m.id" class="group/msg">
        <div
          v-if="m.role === 'user'"
          class="rounded-lg bg-accent/10 border border-accent/20 px-3 py-2 selectable text-fg-0"
        >
          <!-- Quoted passages the user attached — shown above the message. Each
               chip carries a snippet of the selected text; hovering reveals the
               full passage (the agent always received the full text). -->
          <div v-if="m.contexts?.length" class="flex flex-wrap gap-1.5" :class="{ 'mb-1.5': userText(m) }">
            <div v-for="(c, i) in m.contexts" :key="`c${i}`" class="group/ctx relative max-w-full">
              <button
                class="flex items-center gap-1 max-w-full text-xs px-1.5 py-0.5 rounded bg-bg-2 text-fg-2"
                :class="c.file ? 'hover:text-fg-0' : 'cursor-default'"
                @click="c.file && files.openFile(c.file)"
              >
                <span class="codicon codicon-sm codicon-quote shrink-0" />
                <span class="shrink-0 font-medium">{{ c.file ? baseName(c.file) : $t('chat.agentReply') }}</span>
                <span class="text-fg-3 shrink-0">·</span>
                <span class="truncate max-w-[220px] text-fg-3 italic">{{ snippet(c.text) }}</span>
              </button>
              <div
                class="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden group-hover/ctx:block w-max max-w-[320px] max-h-[360px] overflow-hidden rounded-md border border-border bg-bg-0 px-2.5 py-2 text-xs text-fg-1 shadow-lg whitespace-pre-wrap break-words"
              >
                {{ c.text }}
              </div>
            </div>
          </div>
          <div v-if="userText(m)" class="whitespace-pre-wrap">{{ userText(m) }}</div>
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
        <!-- data-reply-selection: selecting text in a reply stages it as a quote
             chip in the composer (same pin-to-keep behavior as file selections). -->
        <div v-else class="space-y-1" data-reply-selection>
          <template v-for="(part, i) in m.parts" :key="i">
            <!-- Tool call with args and/or a result: expandable disclosure. -->
            <details
              v-if="part.type === 'tool' && toolExpandable(part)"
              class="group text-xs font-mono"
              :class="part.status === 'running' ? 'text-fg-2' : part.status === 'error' ? 'text-removed' : 'text-fg-3'"
            >
              <summary
                class="flex items-center gap-1.5 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:text-fg-2"
              >
                <span
                  class="codicon codicon-sm codicon-chevron-right shrink-0 text-fg-3 transition-transform group-open:rotate-90"
                />
                <span class="codicon codicon-sm shrink-0" :class="toolIcon(part)" />
                <span class="truncate">{{ part.detail }}</span>
                <span v-if="part.status" class="shrink-0 tabular-nums text-fg-3">{{ toolTime(part) }}</span>
              </summary>
              <div class="mt-1 ml-5 space-y-1.5">
                <div v-if="toolHasArgs(part)">
                  <div class="mb-0.5 flex items-center justify-between">
                    <span class="text-[10px] uppercase tracking-wide text-fg-3">{{ $t('chat.params') }}</span>
                    <button
                      class="text-fg-3 hover:text-fg-0 [&.code-copied]:text-added"
                      :title="$t('common.copy')"
                      @click.stop.prevent="copyBlock($event, formatArgs(part))"
                    >
                      <span class="codicon codicon-sm codicon-copy" />
                    </button>
                  </div>
                  <pre
                    class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-2 px-2 py-1.5 text-fg-2 selectable"
                  >{{ formatArgs(part) }}</pre>
                </div>
                <div v-if="part.result">
                  <div class="mb-0.5 flex items-center justify-between">
                    <span class="text-[10px] uppercase tracking-wide text-fg-3">{{ $t('chat.result') }}</span>
                    <button
                      class="text-fg-3 hover:text-fg-0 [&.code-copied]:text-added"
                      :title="$t('common.copy')"
                      @click.stop.prevent="copyBlock($event, part.result ?? '')"
                    >
                      <span class="codicon codicon-sm codicon-copy" />
                    </button>
                  </div>
                  <pre
                    class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-2 px-2 py-1.5 text-fg-2 selectable"
                  >{{ part.result }}</pre>
                </div>
              </div>
            </details>
            <!-- Tool call without params: plain one-liner. -->
            <div
              v-else-if="part.type === 'tool'"
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
                <span class="codicon codicon-sm codicon-lightbulb mr-1" />{{ $t('chat.thinking') }}
                <span v-if="thinkTime(part)" class="ml-1 tabular-nums text-fg-3">· {{ thinkTime(part) }}</span>
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
                  {{ part.pending ? $t('chat.generatingArtifact') : part.title }}
                </span>
                <span class="block text-xs text-fg-3">
                  {{ part.pending ? $t('chat.artifactGenerating') : $t('chat.artifactOpen') }}
                </span>
              </span>
              <span
                v-if="!part.pending"
                class="codicon codicon-sm codicon-arrow-right text-fg-3 shrink-0"
              />
            </button>
            <KbImageThumb v-else-if="part.type === 'image'" :path="part.path" />
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div
              v-else
              class="md-preview text-sm"
              v-html="annotateAssistant(m).html.get(i) ?? ''"
              @click="onPreviewClick"
            />
          </template>
          <!-- Sources: files / URLs the reply referenced, numbered to match the
               inline superscripts. Collapsed by default; click a row to jump to
               the file or open the URL. -->
          <details
            v-if="annotateAssistant(m).sources.length"
            class="group/src mt-2 pt-2 border-t border-border/60"
          >
            <summary
              class="flex items-center gap-1 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden text-[11px] uppercase tracking-wide text-fg-3 hover:text-fg-2"
            >
              <span
                class="codicon codicon-sm codicon-chevron-right transition-transform group-open/src:rotate-90"
              />
              {{ $t('chat.sources', { n: annotateAssistant(m).sources.length }) }}
            </summary>
            <div class="flex flex-col gap-1 mt-1.5">
              <button
                v-for="s in annotateAssistant(m).sources"
                :key="s.n"
                class="group flex items-baseline gap-1.5 text-left text-xs text-fg-2 hover:text-fg-0"
                :title="s.target"
                @click="openSource(s)"
              >
                <span
                  class="shrink-0 w-4 h-4 inline-flex items-center justify-center rounded bg-accent/15 text-accent text-[10px] font-medium leading-none"
                >{{ s.n }}</span>
                <span class="min-w-0 truncate">
                  {{ s.label }}
                  <span class="text-fg-3 group-hover:text-fg-2">· {{ s.kind === 'url' ? prettyUrl(s.target) : s.target }}</span>
                </span>
                <span
                  class="codicon codicon-sm shrink-0 opacity-0 group-hover:opacity-60"
                  :class="s.kind === 'url' ? 'codicon-link-external' : 'codicon-go-to-file'"
                />
              </button>
            </div>
          </details>
          <div v-if="m.error" class="text-xs text-removed">{{ m.error }}</div>
          <div
            v-if="chat.running && m === chat.messages[chat.messages.length - 1] && !m.parts.length"
            class="text-xs text-fg-3"
          >
            {{ $t('chat.thinkingEllipsis') }}
          </div>
        </div>
        <!-- Per-message copy: reveals on hover/focus, copies the message's text
             (the reply markdown or the user's prompt), skipping tool/thinking
             chrome. Hidden while the final reply is still streaming. -->
        <div
          v-if="messageText(m) && !(chat.running && m === chat.messages[chat.messages.length - 1])"
          class="mt-1 flex items-center justify-end gap-1.5 transition-opacity"
          :class="
            copiedMsg === m.id
              ? 'opacity-100'
              : 'opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100'
          "
        >
          <span v-if="copiedMsg === m.id" class="text-xs text-added">{{ $t('common.copied') }}</span>
          <button
            class="text-fg-3 hover:text-fg-0 [&.code-copied]:text-added"
            :title="$t('common.copy')"
            @click="copyMessage($event, m)"
          >
            <span class="codicon codicon-sm codicon-copy" />
          </button>
        </div>
      </div>
    </div>

    <!-- Agent plan (update_plan tool, per session) -->
    <div
      v-if="planItems.length"
      class="mb-2 rounded-md border border-border bg-bg-2/50 px-3 py-2 shrink-0 max-h-40 overflow-y-auto"
      :class="ui.agentMaximized ? 'max-w-3xl w-full mx-auto' : 'mx-3'"
    >
      <div class="flex items-center gap-1.5 text-xs text-fg-3 uppercase tracking-wide mb-1.5">
        <span class="codicon codicon-sm codicon-checklist" />
        {{ $t('chat.plan') }}
        <span class="normal-case">
          {{ planItems.filter((i) => i.status === 'done').length }}/{{ planItems.length }}
        </span>
        <span class="flex-1" />
        <button
          class="hover:text-fg-0"
          :title="$t('common.dismiss')"
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
    <div
      v-if="!chat.messages.length"
      class="px-3 pb-2 flex gap-2 shrink-0 flex-wrap w-full"
      :class="{ 'max-w-3xl mx-auto': ui.agentMaximized }"
    >
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
      class="p-3 border-t shrink-0"
      :class="dragOver ? 'border-accent bg-accent/5' : 'border-border'"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop="onDrop"
    >
      <!-- Inner wrapper anchors the dropdowns and, when maximized, centers the
           composer at the same readable width as the transcript. -->
      <div class="relative w-full" :class="{ 'max-w-3xl mx-auto': ui.agentMaximized }">
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
           chips, the borderless textarea, and the +/model/send action row.
           data-composer marks it so focusing here (clicking the input box) never
           drops a staged quote — see useFileSelectionCapture. -->
      <div
        data-composer
        class="rounded-xl border bg-bg-0 focus-within:border-accent transition-colors"
        :class="dragOver ? 'border-accent' : 'border-border'"
      >
        <!-- Selected-text context chips (from the open file or an agent reply).
             The quote icon is a quiet toggle: gray = transient (clears when the
             selection is dropped), blue = pinned (stays until ✕). mousedown.prevent
             keeps the selection alive so a click can pin it. -->
        <div v-if="composer.refs.length" class="flex flex-wrap gap-1.5 px-3 pt-2.5">
          <div
            v-for="r in composer.refs"
            :key="r.id"
            class="group flex items-center gap-1 max-w-full text-xs pl-1 pr-1 py-1 rounded-md border"
            :class="r.pinned ? 'border-accent/40 bg-accent/5' : 'border-border bg-bg-2/60'"
            :title="r.text"
          >
            <button
              class="shrink-0 flex items-center justify-center w-5 h-5 rounded hover:bg-bg-3 transition-colors"
              :class="r.pinned ? 'text-accent' : 'text-fg-3 hover:text-fg-1'"
              @mousedown.prevent="composer.togglePin(r.id)"
            >
              <span class="codicon codicon-sm codicon-quote" />
            </button>
            <button
              v-if="r.file"
              class="shrink-0 font-medium text-fg-1 hover:text-fg-0 hover:underline"
              @click="files.openFile(r.file)"
            >
              {{ baseName(r.file) }}
            </button>
            <span v-else class="shrink-0 font-medium text-fg-1">{{ $t('chat.agentReply') }}</span>
            <span class="text-fg-3 shrink-0">·</span>
            <span class="truncate max-w-[180px] text-fg-3 italic">{{ snippet(r.text) }}</span>
            <button
              class="text-fg-3 hover:text-removed shrink-0 ml-0.5"
              :title="$t('common.remove')"
              @mousedown.prevent="composer.remove(r.id)"
            >
              <span class="codicon codicon-sm codicon-close" />
            </button>
          </div>
        </div>

        <!-- Attachment chips / image thumbnails -->
        <div v-if="attachments.length || importing" class="flex flex-wrap gap-1.5 px-3 pt-2.5">
          <template v-for="(a, i) in attachments" :key="a.path">
            <!-- image → thumbnail preview with a hover remove button -->
            <div
              v-if="a.image && thumbFor(a.path)"
              class="group relative w-14 h-14 rounded overflow-hidden border border-border bg-bg-2"
              :title="a.path"
            >
              <img :src="thumbFor(a.path)" class="w-full h-full object-cover" alt="" />
              <button
                class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center bg-bg-0/80 text-fg-2 hover:text-fg-0 opacity-0 group-hover:opacity-100 transition-opacity"
                :title="$t('common.remove')"
                @click="removeAttachment(i)"
              >
                <span class="codicon codicon-close text-[10px]" />
              </button>
            </div>
            <!-- non-image (or thumbnail not ready) → text chip -->
            <span
              v-else
              class="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-bg-2 text-fg-2"
              :title="a.path"
            >
              <span class="codicon codicon-sm" :class="a.image ? 'codicon-device-camera' : 'codicon-file'" />
              <span class="truncate max-w-[140px]">{{ baseName(a.path) }}</span>
              <button class="text-fg-3 hover:text-fg-0" @click="removeAttachment(i)">
                <span class="codicon codicon-sm codicon-close" />
              </button>
            </span>
          </template>
          <span v-if="importing" class="text-xs text-fg-3 px-1 py-0.5">{{ $t('common.saving') }}</span>
        </div>

        <textarea
          ref="textarea"
          v-model="input"
          rows="3"
          class="w-full bg-transparent border-0 outline-none resize-none font-sans text-sm text-fg-0 placeholder-fg-3 px-3 pt-2.5"
          :placeholder="$t('chat.inputPlaceholder')"
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
            :title="$t('chat.attachFiles')"
            :aria-label="$t('chat.attachFilesAria')"
            @click="fileInput?.click()"
          >
            <span class="codicon codicon-add" />
          </button>
          <span class="text-xs text-fg-3 flex-1 truncate">
            <template v-if="chat.running">
              <span class="text-accent">{{ $t('chat.agentWorking') }}</span> · {{ $t('chat.steerHint') }}
            </template>
            <template v-else>
              {{ settingsStore.primary?.model || $t('chat.notConfigured') }}
              <span v-if="settingsStore.visionAvailable" :title="$t('chat.visionAvailable')">· 👁</span>
              <span
                v-if="chat.sessionUsage.input || chat.sessionUsage.output"
                :title="usageTitle"
              >
                · ↑{{ fmtTokens(chat.sessionUsage.input) }} ↓{{ fmtTokens(chat.sessionUsage.output) }}
              </span>
            </template>
          </span>
          <!-- While running: a filled send button appears once there's text to
               interject (steer) — clicking it does NOT stop the turn; the message
               is injected into the running agent loop at its next step. -->
          <button
            v-if="!chat.running || canSend"
            class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
            :title="chat.running ? $t('chat.steerSend') : $t('chat.sendEnter')"
            :aria-label="chat.running ? $t('chat.steer') : $t('chat.send')"
            :disabled="!canSend"
            @click="send"
          >
            <span class="codicon" :class="chat.running ? 'codicon-comment-discussion' : 'codicon-arrow-up'" />
          </button>
          <button
            v-if="chat.running"
            class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center bg-bg-3 text-fg-0 hover:bg-removed/20 hover:text-removed transition-colors"
            :title="$t('chat.stop')"
            :aria-label="$t('chat.stop')"
            @click="chat.stop()"
          >
            <span class="codicon codicon-sm codicon-primitive-square" />
          </button>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>
