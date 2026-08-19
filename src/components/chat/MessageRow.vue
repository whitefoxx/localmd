<script setup lang="ts">
/**
 * One message in the transcript — the user's bubble, or the agent's reply with
 * its tool rows, thoughts, cards and sources.
 *
 * A component rather than a stretch of ChatPanel's template, for a reason that
 * is entirely about responsiveness. A streamed delta mutates one part of one
 * message, and Vue re-runs whichever render function read it. While all of this
 * lived in the panel, that function was the WHOLE transcript: every delta of
 * every turn rebuilt every message on screen — work proportional to the length
 * of the conversation, tens of times a second, on the same thread that has to
 * answer clicks. A long thinking phase in a long session froze the app outright.
 * Behind a component boundary the same delta re-renders one row.
 *
 * The rule that keeps it that way: **nothing here may read session-wide
 * reactive state that a delta changes.** What the row needs about the
 * conversation arrives as props the panel derives once (`citeSources`,
 * `kbPaths`, `version`, `last`), and the live clock is imported rather than
 * passed, so only rows with a running timer track its tick. Adding a
 * `chat.messages` read to this file undoes the fix silently — the app still
 * works, it just goes back to freezing.
 */
import { computed, ref } from 'vue'
import { useChatStore, type MessagePart, type UiMessage } from '@/stores/chat'
import { useCitationsStore } from '@/stores/citations'
import { useFilesStore } from '@/stores/files'
import { renderMarkdown } from '@/lib/markdown'
import { copyText, flashCopy, handleCodeCopy } from '@/lib/copyCode'
import type { CiteSource } from '@/lib/citations'
import { classifyAnchor, createSourceCollector, type Source } from '@/lib/sources'
import {
  presentCall,
  presentResult,
  hasArgs,
  formatDuration,
  type CallTone,
} from '@/lib/present'
import { t } from '@/i18n'
import KbImageThumb from './KbImageThumb.vue'
import ApprovalCard from './ApprovalCard.vue'
import { baseName, now, openAttachment, revealEditor, snippet } from './shared'

const props = defineProps<{
  m: UiMessage
  /** Newest message on the branch. Drives the streaming affordances (the live
   *  thinking tail, the "thinking…" placeholder, the withheld copy button) —
   *  passed in rather than derived here, because deriving it means reading
   *  `chat.messages` on every render of every row. */
  last: boolean
  /** Session-wide `[[pdf1:…]]` declarations. Identity-stable while they don't
   *  change, so a delta elsewhere does not invalidate this row's render. */
  citeSources: Map<string, CiteSource>
  /** Exact KB paths, for the file-path links in a reply. */
  kbPaths: Set<string>
  /** Which re-asked version of this message is showing. */
  version: { index: number; total: number }
  /** This message's text is in the composer, waiting to be re-asked. */
  editing: boolean
  /** Just copied — pins the action row open and shows the hint. */
  copied: boolean
}>()

const emit = defineEmits<{ copied: []; reAsk: []; continueTurn: [] }>()

const chat = useChatStore()
const files = useFilesStore()
const citations = useCitationsStore()

type ToolPart = Extract<MessagePart, { type: 'tool' }>
type ThinkPart = Extract<MessagePart, { type: 'thinking' }>

/* ── tool rows ───────────────────────────────────────────────────────────── */

/** Glyph, label, tone and expandability all come from lib/present, which the
 *  markdown export reads too — one description of a tool row, two renderers. */
const TOOL_TONE: Record<CallTone, string> = {
  running: 'text-fg-2',
  failed: 'text-removed',
  stopped: 'text-fg-3',
  plain: 'text-fg-3',
}

function toolTime(part: ToolPart): string {
  if (part.status === 'running') {
    return `${Math.floor((now.value - (part.startedAt ?? now.value)) / 1000)}s`
  }
  return formatDuration(part.elapsedMs ?? 0)
}

/** What the call returned, in the few words that fit on the collapsed row: a
 *  failure's own message, or our own wording for the outcomes that have none.
 *  Silent on success — the row already says what was asked. */
function toolOutcome(part: ToolPart): string {
  const r = presentResult(part)
  if (r.kind === 'failed') return r.message ?? t('chat.toolFailed')
  if (r.kind === 'stopped') return t('chat.toolStopped')
  if (r.kind === 'empty') return t('chat.toolNoOutput')
  return ''
}

function formatArgs(part: ToolPart): string {
  try {
    return JSON.stringify(part.args, null, 2)
  } catch {
    return String(part.args)
  }
}

/** Copy a tool call's args/result; flashes the clicked button's icon.
 *
 *  The button is read BEFORE the await: `currentTarget` is only live for the
 *  duration of the dispatch, and the first await ends that — reading it after
 *  gives null, and the flash throws instead of confirming anything. */
async function copyBlock(e: MouseEvent, text: string): Promise<void> {
  const btn = e.currentTarget as HTMLElement
  flashCopy(btn, await copyText(text))
}

/* ── thinking blocks ─────────────────────────────────────────────────────── */

/** Thinking duration: live-ticking while the block streams, frozen once sealed.
 *  Empty for pre-timing transcripts (no startedAt). */
function thinkTime(part: ThinkPart): string {
  if (part.elapsedMs != null) return formatDuration(part.elapsedMs)
  if (part.startedAt == null) return ''
  return `${Math.floor((now.value - part.startedAt) / 1000)}s`
}

/* A thinking block stays folded — while it streams and after — unless the user
 * opens it (`thinkingChoice`, keyed by part index). It used to unfold itself
 * for the duration of the stream, which meant every turn shoved the reply down
 * the panel behind a wall of thought nobody asked to read, and then yanked it
 * back. What streams instead is the tail, on the summary's own line (see the
 * template): the thought is visible as it happens, at the size of one line. */
function thinkingStreaming(i: number): boolean {
  return props.last && chat.running && i === props.m.parts.length - 1
}

const thinkingChoice = ref<Map<number, boolean>>(new Map())
function thinkingOpen(i: number): boolean {
  return thinkingChoice.value.get(i) ?? false
}
/** The summary's own click, with the native toggle suppressed: `open` is bound
 *  to our state, so the user's choice has to live there to survive a re-render. */
function toggleThinking(i: number): void {
  const next = new Map(thinkingChoice.value)
  next.set(i, !thinkingOpen(i))
  thinkingChoice.value = next
}

/** The last stretch of a streaming thought, on one line. Capped because the
 *  line can only show a fraction of it anyway and re-rendering the whole
 *  thought on every delta is work nobody sees. */
const THINK_TAIL_CHARS = 200
function thinkTail(text: string): string {
  return text.slice(-THINK_TAIL_CHARS).replace(/\s+/g, ' ')
}

/* ── the reply itself: markdown, citations, sources ──────────────────────── */

function renderPart(part: MessagePart & { type: 'text' }): string {
  return renderMarkdown(
    part.text,
    { resolve: (target) => files.resolveWikilink(target) },
    {
      citeSources: props.citeSources,
      resolvePath: (target) => (props.kbPaths.has(target) ? target : null),
    },
  )
}

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

/**
 * The reply's rendered HTML per text part, plus the numbered sources under it.
 *
 * A plain computed does the memoizing that used to need a hand-rolled cache and
 * a content signature: it re-runs when this message's own text changes and at
 * no other time, because the only reactive things it reads are this message's
 * parts and two props the panel keeps identity-stable.
 */
const rendered = computed(() => {
  const collector = createSourceCollector()
  const html = new Map<number, string>()
  props.m.parts.forEach((part, i) => {
    if (part.type === 'text') html.set(i, annotateHtml(renderPart(part), collector))
  })
  return { html, sources: collector.sources }
})

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
  // A `path` the agent named, resolved to a real file at render time.
  if (a.classList.contains('file-path') && a.dataset.path) {
    await files.openFile(a.dataset.path)
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

/* ── the message as a whole ──────────────────────────────────────────────── */

function userText(m: { parts: MessagePart[] }): string {
  const p = m.parts[0]
  return p?.type === 'text' ? p.text : ''
}

/** The copyable text of a message: the reply's markdown (or the user's prompt),
 *  joining all text parts and skipping tool/thinking/artifact chrome. */
const messageText = computed(() =>
  props.m.parts
    .filter((p): p is MessagePart & { type: 'text' } => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n')
    .trim(),
)

/** Whether the copy button belongs on a message: it has text to copy, and it
 *  is not the reply still being streamed. */
const canCopy = computed(() => !!messageText.value && !(chat.running && props.last))

/** Copy the whole message. `currentTarget` is captured before the await for the
 *  reason `copyBlock` explains — and here the dead flash took the "Copied" hint
 *  with it, because the throw landed before the emit. */
async function copyMessage(e: MouseEvent): Promise<void> {
  const btn = e.currentTarget as HTMLElement
  const ok = await copyText(messageText.value)
  flashCopy(btn, ok)
  if (ok) emit('copied')
}
</script>

<template>
  <!-- data-msg: the anchor the composer's re-ask chip scrolls back to. -->
  <div class="group/msg" :data-msg="m.id">
    <div
      v-if="m.role === 'user'"
      class="rounded-lg bg-accent/10 border px-3 py-2 selectable text-fg-0 transition-colors"
      :class="editing ? 'border-accent reask-target' : 'border-accent/20'"
    >
      <!-- Browser tabs this message was pointed at. Above the text, where
           they sat in the composer, and kept here because the composer lets
           them go on send: a bare "summarize this" is unreadable later
           without the record of what "this" was. Not a link — the tab is a
           live page, and re-opening its address is a different page (see
           connectTabs); the address is in the tooltip for the eye only. -->
      <div v-if="m.tabs?.length" class="flex flex-wrap gap-1.5" :class="{ 'mb-1.5': userText(m) || m.contexts?.length }">
        <div
          v-for="t in m.tabs"
          :key="`t${t.tabId}`"
          class="flex items-center gap-1 max-w-full text-xs px-1.5 py-0.5 rounded bg-bg-2 text-fg-2"
          :title="`${t.title}\n${t.url}`"
        >
          <span class="codicon codicon-sm codicon-globe shrink-0" />
          <span class="truncate min-w-0">{{ t.title }}</span>
        </div>
      </div>
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
            <span class="truncate min-w-0 font-medium">{{
              c.file ? baseName(c.file) : $t('chat.agentReply')
            }}</span>
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
          @click="openAttachment(a.path)"
        >
          <span class="codicon codicon-sm" :class="a.image ? 'codicon-device-camera' : 'codicon-file'" />
          <span class="truncate max-w-[160px]">{{ baseName(a.path) }}</span>
        </button>
      </div>
    </div>
    <!-- data-reply-selection: selecting text in a reply stages it as a quote
         chip in the composer (same pin-to-keep behavior as file selections).
         data-msg-id records WHICH reply, so the agent is told how far back
         the quoted passage came from — see lib/quoteContext. -->
    <div v-else class="space-y-1" data-reply-selection :data-msg-id="m.id">
      <template v-for="(part, i) in m.parts" :key="i">
        <!-- Tool call with args and/or a result: expandable disclosure. -->
        <details
          v-if="part.type === 'tool' && presentCall(part).expandable"
          class="group text-xs font-mono"
          :class="TOOL_TONE[presentCall(part).tone]"
        >
          <summary
            class="flex items-center gap-1.5 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:text-fg-2"
          >
            <span
              class="codicon codicon-sm codicon-chevron-right shrink-0 text-fg-3 transition-transform group-open:rotate-90"
            />
            <span class="codicon codicon-sm shrink-0" :class="presentCall(part).icon" />
            <span class="truncate">{{ presentCall(part).label }}</span>
            <!-- Gives up width long before the label does: which file was
                 touched matters more than the whole message, which is one
                 click away either way. -->
            <span
              v-if="toolOutcome(part)"
              class="truncate min-w-0 [flex-shrink:20] text-fg-3"
            >· {{ toolOutcome(part) }}</span>
            <span v-if="part.status" class="shrink-0 tabular-nums text-fg-3">{{ toolTime(part) }}</span>
          </summary>
          <div class="mt-1 ml-5 space-y-1.5">
            <div v-if="hasArgs(part)">
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
          :class="TOOL_TONE[presentCall(part).tone]"
        >
          <span class="codicon codicon-sm shrink-0" :class="presentCall(part).icon" />
          <span class="truncate">{{ presentCall(part).label }}</span>
          <span
            v-if="toolOutcome(part)"
            class="truncate min-w-0 [flex-shrink:20] text-fg-3"
          >· {{ toolOutcome(part) }}</span>
          <span v-if="part.status" class="shrink-0 tabular-nums text-fg-3">{{ toolTime(part) }}</span>
        </div>
        <details
          v-else-if="part.type === 'thinking'"
          class="group text-xs text-fg-3"
          :open="thinkingOpen(i)"
        >
          <summary
            class="flex items-center gap-1.5 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:text-fg-2"
            @click.prevent="toggleThinking(i)"
          >
            <span
              class="codicon codicon-sm codicon-chevron-right shrink-0 transition-transform group-open:rotate-90"
            />
            <span class="codicon codicon-sm codicon-lightbulb shrink-0" />
            <span class="shrink-0">{{ $t('chat.thinking') }}</span>
            <span v-if="thinkTime(part)" class="shrink-0 tabular-nums">· {{ thinkTime(part) }}</span>
            <!-- The thought as it arrives, on this line. Right-aligned in a
                 clipped box so the newest words sit at the edge and the
                 older ones slide out under the fade. -->
            <span
              v-if="thinkingStreaming(i) && !thinkingOpen(i) && part.text"
              class="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-right italic opacity-70 [mask-image:linear-gradient(to_right,transparent,#000_3rem)]"
            >{{ thinkTail(part.text) }}</span>
          </summary>
          <div class="pl-4 pt-1 whitespace-pre-wrap selectable italic leading-relaxed">{{ part.text }}</div>
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
        <!-- An ask-first write paused on the user: decided right here. -->
        <ApprovalCard v-else-if="part.type === 'approval'" :part="part" />
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div
          v-else
          class="md-preview text-sm"
          v-html="rendered.html.get(i) ?? ''"
          @click="onPreviewClick"
        />
      </template>
      <!-- Sources: files / URLs the reply referenced, numbered to match the
           inline superscripts. Collapsed by default; click a row to jump to
           the file or open the URL. -->
      <details
        v-if="rendered.sources.length"
        class="group/src mt-2 pt-2 border-t border-border/60"
      >
        <summary
          class="flex items-center gap-1 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden text-[11px] uppercase tracking-wide text-fg-3 hover:text-fg-2"
        >
          <span
            class="codicon codicon-sm codicon-chevron-right transition-transform group-open/src:rotate-90"
          />
          {{ $t('chat.sources', { n: rendered.sources.length }) }}
        </summary>
        <div class="flex flex-col gap-1 mt-1.5">
          <button
            v-for="s in rendered.sources"
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
      <!-- Ran out of steps, not out of work. Say so and offer the obvious
           next move, rather than letting it read as a finished answer. -->
      <div
        v-if="m.stoppedAtLimit && !m.error"
        class="flex items-center gap-2 flex-wrap text-xs text-fg-3 mt-1"
      >
        <span class="codicon codicon-sm codicon-debug-pause" />
        <span>{{ $t('chat.stoppedAtLimit') }}</span>
        <button
          class="text-accent hover:underline"
          :disabled="chat.running"
          @click="emit('continueTurn')"
        >{{ $t('chat.continueRun') }}</button>
      </div>
      <div v-if="chat.running && last && !m.parts.length" class="text-xs text-fg-3">
        {{ $t('chat.thinkingEllipsis') }}
      </div>
    </div>
    <!-- Per-message actions. Copy and re-ask reveal on hover/focus; the
         version switcher does not, because it is information rather than an
         action — a message that has been asked more than one way must look
         different from one that never was, without hunting for it. -->
    <div
      v-if="canCopy || version.total > 1 || chat.branchable.has(m.id)"
      class="mt-1 flex items-center justify-end gap-1.5"
    >
      <span v-if="copied" class="text-xs text-added">{{ $t('common.copied') }}</span>
      <!-- Copies the message's text (reply markdown or the user's prompt),
           skipping tool/thinking chrome. -->
      <button
        v-if="canCopy"
        class="text-fg-3 hover:text-fg-0 transition-opacity [&.code-copied]:text-added"
        :class="copied ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100 focus:opacity-100'"
        :title="$t('common.copy')"
        @click="copyMessage($event)"
      >
        <span class="codicon codicon-sm codicon-copy" />
      </button>
      <!-- Ask this again: the text returns to the composer and sending it
           forks here, leaving the reply it already got on its own branch. -->
      <button
        v-if="chat.branchable.has(m.id)"
        class="text-fg-3 hover:text-fg-0 transition-opacity opacity-0 group-hover/msg:opacity-100 focus:opacity-100 disabled:opacity-30"
        :title="$t('chat.reAsk')"
        :disabled="chat.running"
        @click="emit('reAsk')"
      >
        <span class="codicon codicon-sm codicon-edit" />
      </button>
      <!-- Which version of a re-asked message is showing. Both branches are
           kept — ‹ › walks between them, landing where each left off. -->
      <div v-if="version.total > 1" class="flex items-center gap-0.5 text-[11px] text-fg-3">
        <button
          class="p-0.5 rounded hover:bg-bg-2 hover:text-fg-1 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-3"
          :title="$t('chat.versionPrev')"
          :disabled="chat.running || version.index <= 1"
          @click="chat.switchVersion(m.id, -1)"
        >
          <span class="codicon codicon-sm codicon-chevron-left" />
        </button>
        <span class="tabular-nums select-none">{{ version.index }}/{{ version.total }}</span>
        <button
          class="p-0.5 rounded hover:bg-bg-2 hover:text-fg-1 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-3"
          :title="$t('chat.versionNext')"
          :disabled="chat.running || version.index >= version.total"
          @click="chat.switchVersion(m.id, 1)"
        >
          <span class="codicon codicon-sm codicon-chevron-right" />
        </button>
      </div>
    </div>
  </div>
</template>
