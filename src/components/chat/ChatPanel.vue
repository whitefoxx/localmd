<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useChatStore, type Attachment, type UiMessage } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useSetupStore } from '@/stores/setup'
import SetupCard from '@/components/chat/SetupCard.vue'
import { useFilesStore } from '@/stores/files'
import { usePlanStore } from '@/stores/plan'
import { useSkillsStore } from '@/stores/skillsStore'
import { useComposerStore } from '@/stores/composer'
import { useFileSelectionCapture } from '@/lib/selectionContext'
import { parseCiteSources, type CiteSource } from '@/lib/citations'
import { importTempFile } from '@/lib/capture'
import { mentionQueryAt, filterFiles } from '@/lib/mentions'
import {
  LIST_TABS_TOOL,
  excludeSelf,
  filterTabs,
  parseTabs,
  type TabRef,
} from '@/lib/connectTabs'
import { useMcpStore } from '@/stores/mcp'
import { BUILTIN_DIR } from '@/lib/skills'
import { fileKind } from '@/lib/filetypes'
import * as fs from '@/lib/fs'
import MessageRow from './MessageRow.vue'
import type { MessagePart } from '@/stores/chat'
import { baseName, openAttachment, runClock, snippet, stopClock } from './shared'
import { t } from '@/i18n'

const emit = defineEmits<{ openSettings: []; close: [] }>()

const chat = useChatStore()
const settingsStore = useSettingsStore()
const ui = useUiStore()
const files = useFilesStore()
const plan = usePlanStore()
const skills = useSkillsStore()
const composer = useComposerStore()
const mcp = useMcpStore()

// Stage text selected in the open file as removable context chips (agent-open).
useFileSelectionCapture()

/** The empty panel's three rows: what it reads, what it writes, how to hand it
 *  something. Computed rather than a constant so switching the interface
 *  language re-renders them — t() is read at build time in a plain array. */
const emptyRows = computed(() => [
  { icon: 'codicon-search', text: t('chat.emptyRead') },
  { icon: 'codicon-edit', text: t('chat.emptyWrite') },
  // Browser tabs are only namable when something can actually reach them —
  // promising them where localmd Connect isn't installed is a lie the user
  // discovers by typing @ and finding files only.
  {
    icon: 'codicon-mention',
    text: tabsAvailable.value ? t('chat.emptyInputTabs') : t('chat.emptyInput'),
  },
])

/** Nothing to run the agent with yet — the demo lends one, so it is the only
 *  place it can be tried before configuring anything. Replaces the open KB;
 *  enterDemo puts that one away properly first. */
async function tryDemo(): Promise<void> {
  const { enterDemo } = await import('@/demo/bootstrap')
  await enterDemo()
}

/** Just the site, for the right-hand hint on a tab row. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const PLAN_ICONS = {
  pending: 'codicon-circle-large-outline text-fg-3',
  in_progress: 'codicon-play-circle text-accent',
  done: 'codicon-pass-filled text-added',
} as const

/** The ACTIVE session's plan — each chat tab keeps its own. */
const planItems = computed(() => plan.itemsFor(chat.currentSessionId))

const setup = useSetupStore()
/** The live setup request for THIS chat tab (sessions block independently). */
const setupRequest = computed(() =>
  chat.currentSessionId ? setup.pendingFor(chat.currentSessionId) : undefined,
)

const input = ref('')

/** Put a draft in the composer and leave the caret at the end. Never clobbers
 *  what the user already typed — an unsent draft is theirs, so anything handed
 *  over lands on a new line below it. */
function fillComposer(text: string): void {
  input.value = input.value ? `${input.value.trimEnd()}\n${text}` : text
  void nextTick(() => {
    textarea.value?.focus()
    const end = input.value.length
    textarea.value?.setSelectionRange(end, end)
  })
}

/** A request handed over from elsewhere (Settings → Tools). It lands in the
 *  composer as an editable draft rather than being sent: the user should see —
 *  and be able to change — what the agent is about to be asked. */
watch(
  () => ui.pendingPrompt,
  (prompt) => {
    if (!prompt) return
    ui.pendingPrompt = ''
    fillComposer(prompt)
  },
)

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

function fmtTokens(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** Localized tooltip for the per-session token counter. Cache read/write
 *  verify that prompt caching is actually landing (reads are billed at a
 *  fraction of fresh input).
 *
 *  Hits are a SHARE of input, not a count: the number that says whether the
 *  prefix is stable is "how much of what we sent was already cached", and a
 *  raw token figure can only answer that against a total the reader has to
 *  divide by themselves. Providers report input inclusive of cached reads (see
 *  agent/run.ts), so that total is the right denominator. */
const usageTitle = computed(() => {
  const u = chat.sessionUsage
  let s = t('chat.tokenUsage', {
    input: u.input.toLocaleString(),
    output: u.output.toLocaleString(),
  })
  if (u.cacheRead && u.input) {
    s += t('chat.tokenCacheSuffix', { pct: Math.round((u.cacheRead / u.input) * 100) })
  }
  if (u.cacheWrite) s += t('chat.tokenCacheWriteSuffix', { cache: u.cacheWrite.toLocaleString() })
  return s
})

/* ── tool call loading + timer ──────────────────────────────────────────────
 * External MCP tool calls carry a status/timer; a shared clock ticks once a
 * second while a turn is running so in-flight timers advance without churning
 * the transcript when idle. The clock itself lives in ./shared, where the rows
 * read it directly — see the note there for why it is not a prop. */
watch(() => chat.running, runClock, { immediate: true })
onUnmounted(() => {
  stopClock()
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

/** Coming back to this tab is both when the browser's tab list is most likely
 *  to have changed and the cheapest moment to spend five seconds on it — long
 *  before anyone types `@`. Throttled like every other refresh. */
function refreshTabsOnReturn(): void {
  if (document.visibilityState === 'visible') void loadOpenTabs()
}
onMounted(() => document.addEventListener('visibilitychange', refreshTabsOnReturn))
onUnmounted(() => document.removeEventListener('visibilitychange', refreshTabsOnReturn))

/* ── @-mention autocomplete ──────────────────────────────────────────────── */

const caret = ref(0)
const mentionOpen = ref(false)
const mentionSel = ref(0)

function syncCaret(): void {
  caret.value = textarea.value?.selectionStart ?? input.value.length
}

const mention = computed(() => (mentionOpen.value ? mentionQueryAt(input.value, caret.value) : null))

/* ── open browser tabs in the @ menu (any server offering list_tabs) ─────── */

/**
 * The browser's tabs, as of the last time we asked.
 *
 * Module scope, deliberately: asking is expensive — the extension walks every
 * tab, which measures at ~0.5s each, so a nine-tab browser answers in five
 * seconds — and the panel is mounted and unmounted as the user shows and hides
 * it. A cache that died with the component would make the menu start empty
 * exactly as often as a user toggles the panel.
 *
 * Everything below is stale-while-revalidate around this: the menu paints from
 * it the moment it opens, and a refresh lands underneath when it arrives.
 */
const openTabs = ref<TabRef[]>([])
const tabsLoading = ref(false)
let lastTabLoad = 0

/** Servers that can list the browser's tabs. Matched on the tool rather than on
 *  localmd Connect by name: anything providing it gets the same treatment. */
const tabServers = computed(() =>
  mcp.allTools
    .filter((t) => t.def.name === LIST_TABS_TOOL)
    .map((t) => t.serverId)
    .filter((id, i, arr) => arr.indexOf(id) === i),
)

const tabsAvailable = computed(() => tabServers.value.length > 0)

/** A list this new is not worth five seconds to fetch again. */
const TAB_FRESH_MS = 10_000
/** …but with nothing to show, asking again soon is the whole point: the relay
 *  can be a moment behind the extension right after a reconnect, and a menu
 *  that stays empty looks like the feature is missing rather than late. */
const TAB_RETRY_MS = 2000

async function fetchTabs(args: Record<string, unknown>): Promise<TabRef[]> {
  const found: TabRef[] = []
  for (const serverId of tabServers.value) {
    // A browser that cannot be reached is not an error worth a dialog: the menu
    // simply has no tabs in it, and the files are still there.
    const out = await mcp.callTool(serverId, LIST_TABS_TOOL, args).catch(() => '')
    for (const tab of parseTabs(out)) found.push({ ...tab, serverId })
  }
  return excludeSelf(found, window.location.href)
}

/**
 * Refresh the list, in two passes, because the cost is per tab and the first
 * answer is the one that matters: this window alone comes back in about a
 * second, and it holds the tab the user means most of the time. The sweep of
 * every window follows and replaces it — including dropping whatever has been
 * closed since, which only an authoritative answer may do.
 */
async function loadOpenTabs(): Promise<void> {
  if (!tabsAvailable.value || tabsLoading.value) return
  const stale = openTabs.value.length ? TAB_FRESH_MS : TAB_RETRY_MS
  if (Date.now() - lastTabLoad < stale) return
  lastTabLoad = Date.now()
  tabsLoading.value = true
  try {
    const near = await fetchTabs({ current_window: true })
    // Merge rather than replace: a partial answer must not make the tabs the
    // user could see a moment ago disappear and come back.
    if (near.length) {
      const rest = openTabs.value.filter((t) => !near.some((n) => n.tabId === t.tabId))
      openTabs.value = [...near, ...rest]
    }
    const all = await fetchTabs({})
    // An empty answer is far more likely a call that failed than a browser with
    // no tabs open — this app is itself one — so keep what we had.
    if (all.length) openTabs.value = all
  } finally {
    tabsLoading.value = false
    lastTabLoad = Date.now()
  }
}

/** What the user is working on, best guess first: the file on screen, then the
 *  rest of the open tabs. A bare `@` should offer these before it offers the
 *  shortest paths in the folder. */
const workingFiles = computed(() => {
  const open = [...files.openTabs]
  const current = files.currentPath
  return current ? [current, ...open.filter((p) => p !== current)] : open
})

const mentionFiles = computed(() =>
  mention.value ? filterFiles(files.allFiles, mention.value.query, 8, workingFiles.value) : [],
)
const mentionTabs = computed(() =>
  mention.value ? filterTabs(openTabs.value, mention.value.query) : [],
)
/** Both groups as one list, because that is what the arrow keys move through. */
const mentionMatches = computed<Array<{ path: string } | { tab: TabRef }>>(() => [
  ...mentionFiles.value.map((path) => ({ path })),
  ...mentionTabs.value.map((tab) => ({ tab })),
])
/** The tabs group is on screen while it has rows OR while it is still fetching
 *  them — an empty menu that is merely slow must not read as a broken one. */
const tabsGroupShown = computed(
  () => tabsAvailable.value && (mentionTabs.value.length > 0 || tabsLoading.value),
)
/** Headers earn their space only when there is more than one kind to tell apart. */
const mentionGrouped = computed(() => !!mentionFiles.value.length && tabsGroupShown.value)

watch([input, caret], () => {
  const q = mentionQueryAt(input.value, caret.value)
  const opening = !!q && !mentionOpen.value
  mentionOpen.value = !!q
  mentionSel.value = 0
  // Opening the menu refreshes the tabs behind whatever is already on screen;
  // typing on with none of them asks again, throttled, so a call that missed is
  // not stuck being missed.
  if (opening || (mentionOpen.value && !openTabs.value.length)) void loadOpenTabs()
})

/** Drop the `@…` the user typed to open the menu. A tab is not a path, so it
 *  leaves no token behind in the text — it becomes a chip instead. */
function dropMentionToken(): void {
  const m = mention.value
  if (!m) return
  const before = input.value.slice(0, m.start)
  const after = input.value.slice(caret.value)
  input.value = before + after
  mentionOpen.value = false
  void nextTick(() => {
    textarea.value?.focus()
    textarea.value?.setSelectionRange(m.start, m.start)
    caret.value = m.start
  })
}

function pickMentionItem(item: { path: string } | { tab: TabRef }): void {
  if ('tab' in item) {
    composer.attachTab(item.tab)
    dropMentionToken()
    return
  }
  pickMention(item.path)
}

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
    : skills.forUser.filter((s) => s.name.toLowerCase().startsWith(slashQuery.value!.toLowerCase())),
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

/* ── Skill chips above the composer ──────────────────────────────────────── */

/** Only the FOLDER's own skills get chips. The app's built-ins are plumbing the
 *  agent reaches for when the conversation calls for it — a button offering to
 *  connect a service is noise above an empty composer. They stay in the / menu
 *  for anyone who wants to force one. */
const kbSkills = computed(() => skills.forUser.filter((s) => s.dir !== BUILTIN_DIR))

/** How many skills get a chip of their own. The rest are one ▲ away: a folder
 *  with twenty skills should not bury the composer under rows of buttons. */
const SKILL_CHIPS = 4
const chipSkills = computed(() => kbSkills.value.slice(0, SKILL_CHIPS))
const skillMenuOpen = ref(false)

function toggleSkillMenu(): void {
  skillMenuOpen.value = !skillMenuOpen.value
  if (skillMenuOpen.value) void skills.refresh() // lazy re-scan, like the / menu
}

function runSkill(name: string): void {
  skillMenuOpen.value = false
  preset(`/${name} `)
}

/* ── sending ─────────────────────────────────────────────────────────────── */

/**
 * Citation declarations across the WHOLE transcript: messages render part by
 * part, so [[1:bxx]] often sits in a different part (or message) than its
 * [[pdf1:…]] declaration. First declaration of a number wins.
 *
 * Parsed per message and merged, rather than by scanning the joined transcript,
 * because this is read while a reply streams: joining every message's text on
 * every delta is work proportional to the conversation, tens of times a second.
 * Per message, a delta re-parses the one message that changed — and during a
 * thinking phase (which appends to no text part) not even that.
 *
 * The result is identity-stable while the declarations are unchanged, which is
 * what lets `MessageRow` treat it as a prop that a delta does not disturb. A
 * fresh Map each time would invalidate every row's rendered HTML and put the
 * whole-transcript cost straight back.
 */
const citeMemo = new WeakMap<UiMessage, { len: number; map: Map<string, CiteSource> }>()

function sameSources(a: Map<string, CiteSource>, b: Map<string, CiteSource>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) {
    const other = b.get(k)
    if (!other || other.kind !== v.kind || other.path !== v.path) return false
  }
  return true
}

/** One message's declarations. Keyed on the total length of its text parts —
 *  sound because a message's text only ever grows, by append, as it streams. */
function citeSourcesOf(m: UiMessage): Map<string, CiteSource> {
  let len = 0
  for (const p of m.parts) if (p.type === 'text') len += p.text.length
  const hit = citeMemo.get(m)
  if (hit && hit.len === len) return hit.map
  const parsed = parseCiteSources(
    m.parts
      .filter((p): p is MessagePart & { type: 'text' } => p.type === 'text')
      .map((p) => p.text)
      .join('\n'),
  )
  // Same declarations as last time → keep the old object, so nothing that
  // depends on this identity re-renders for a reply that merely got longer.
  const map = hit && sameSources(hit.map, parsed) ? hit.map : parsed
  citeMemo.set(m, { len, map })
  return map
}

let mergedFrom: Array<Map<string, CiteSource>> = []
let merged = new Map<string, CiteSource>()
const sessionCiteSources = computed(() => {
  const per = chat.messages.map(citeSourcesOf)
  if (per.length === mergedFrom.length && per.every((m, i) => m === mergedFrom[i])) return merged
  const out = new Map<string, CiteSource>()
  for (const m of per) for (const [k, v] of m) if (!out.has(k)) out.set(k, v)
  mergedFrom = per
  merged = out
  return out
})

/** Exact KB paths, as a set — the agent names files far more often than the
 *  tree changes, and a per-code-span scan of `allFiles` would be quadratic on
 *  a long reply. */
const kbPaths = computed(() => new Set(files.allFiles))

/** Which message is the newest — the one a running turn is streaming into.
 *  Derived here so a row can be told, rather than each row reading the whole
 *  message list to work it out for itself. */
const lastId = computed(() => chat.messages[chat.messages.length - 1]?.id)

/** The user's own words in a message — the re-ask chip's label. */
function userText(m: { parts: MessagePart[] }): string {
  const p = m.parts[0]
  return p?.type === 'text' ? p.text : ''
}

/* ── re-asking an earlier message ────────────────────────────────────────── */

/** Version counts for the user messages on screen, computed once per render
 *  rather than per button. */
const versions = computed(() => {
  const out = new Map<number, { index: number; total: number }>()
  for (const m of chat.messages) if (m.role === 'user') out.set(m.id, chat.versionsOf(m.id))
  return out
})

/** One re-asked count. Kept identity-stable for a message whose versions did
 *  not change, so handing it to a row does not re-render that row. */
const ONE_VERSION = { index: 1, total: 1 }
function ver(m: UiMessage): { index: number; total: number } {
  return versions.value.get(m.id) ?? ONE_VERSION
}

/** Re-ask one of your earlier messages: its text and attachments come back to
 *  the composer, and sending it forks the conversation there. Nothing moves
 *  until you send — the reply this message already got stays on its own branch
 *  either way.
 *
 *  Clicking the same message again is a no-op on the composer (the store says
 *  so), so a second click never duplicates the text or overwrites the edit
 *  under way; pointing at a DIFFERENT message appends it below what is already
 *  typed, same as anything else handed to the composer. */
function reAsk(m: UiMessage): void {
  const recovered = chat.startEdit(m.id)
  if (recovered) {
    fillComposer(recovered.text)
    for (const a of recovered.attachments) {
      if (!attachments.value.some((x) => x.path === a.path)) attachments.value.push(a)
    }
  }
  void nextTick(() => textarea.value?.focus())
}

/** Jump the transcript to the message being re-asked — clicking the chip should
 *  answer "which message was that?" without scrolling around for it. */
function scrollToEditing(): void {
  const id = chat.editing?.id
  if (id == null) return
  scroller.value
    ?.querySelector(`[data-msg="${id}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** Which message was just copied — pins its action row open and shows a
 *  "Copied" hint for a moment (survives the cursor leaving the message). One
 *  at a time: copying another message moves the hint rather than leaving two. */
const copiedMsg = ref<number | null>(null)
let copiedTimer: number | undefined
function markCopied(id: number): void {
  copiedMsg.value = id
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

/** Pick the interrupted work back up. Goes through the composer so it is a
 *  normal message the user can see and the history stays honest. */
async function continueTurn(): Promise<void> {
  if (chat.running) return
  input.value = t('chat.continueWord')
  await send()
}

async function send(): Promise<void> {
  if (!settingsStore.isConfigured()) {
    // Land on the pane that fixes it, not on whichever one was last open.
    ui.openSettings('models')
    return
  }
  const text = input.value
  const atts = [...attachments.value]
  const sels = [...composer.refs]
  // Staged for this message and let go with it, like the quote chips: a chip
  // left above an empty box claims the NEXT message is about that page too. The
  // address is in the message that just went, and stays in the wire history, so
  // a follow-up still has the tab_id.
  const tabs = [...composer.tabs]
  input.value = ''
  attachments.value = []
  composer.clear()
  composer.clearTabs()
  revokeAllThumbs()
  mentionOpen.value = false
  await chat.send(text, atts, sels, tabs)
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
      pickMentionItem(mentionMatches.value[mentionSel.value])
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

// Keep the transcript pinned to the bottom while streaming — but ONLY while
// the user is already there. Scrolling up detaches (so they can read during
// a stream); scrolling back near the bottom re-attaches.
const autoFollow = ref(true)

function onTranscriptScroll(): void {
  const el = scroller.value
  if (!el) return
  autoFollow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 60
}

/** What the transcript's height follows, in one small string: how far the
 *  newest message has got. Only the newest one is measured because only it
 *  grows — and this runs on every delta, so measuring every message would put
 *  a whole-conversation walk in the hot path (see MessageRow's note). */
const streamTail = computed(() => {
  const m = chat.messages[chat.messages.length - 1]
  if (!m) return ''
  const last = m.parts[m.parts.length - 1]
  const tail = last && (last.type === 'text' || last.type === 'thinking') ? last.text.length : 0
  return `${chat.messages.length}:${m.parts.length}:${tail}`
})

/** Scroll to the bottom, at most once a frame. Reading `scrollHeight` right
 *  after a DOM patch forces a layout, and a stream lands many deltas per frame
 *  — the transcript cannot scroll more often than it is painted, so paying for
 *  each of them buys nothing. A frame later is also strictly after Vue has
 *  patched, which is what `nextTick` was here for.
 *
 *  `force` is the user's own jump to the bottom (they just sent something) and
 *  overrides a detached follow; everything else defers to `autoFollow` AS OF
 *  THE FRAME, not as of the moment it was queued. Scrolling up mid-stream must
 *  cancel the scroll already in flight, or the transcript yanks itself back one
 *  last time — which is the whole thing detaching exists to prevent. */
let followFrame = 0
let followForced = false
function followBottom(force = false): void {
  followForced ||= force
  if (followFrame) return
  followFrame = requestAnimationFrame(() => {
    followFrame = 0
    const forced = followForced
    followForced = false
    const el = scroller.value
    if (el && (forced || autoFollow.value)) el.scrollTo({ top: el.scrollHeight })
  })
}
onUnmounted(() => cancelAnimationFrame(followFrame))

watch(streamTail, () => {
  if (autoFollow.value) followBottom()
})

// A new user message always jumps to the bottom (they just sent it).
watch(
  () => chat.messages.length,
  () => {
    autoFollow.value = true
    followBottom(true)
  },
)
</script>

<template>
  <div class="h-full flex flex-col bg-bg-1 relative">
    <!-- Header. Maximized, the panel is the whole window and everything else in
         it (transcript, composer) already narrows to max-w-3xl — a header still
         pinned to the window edges left the title and the buttons a screen
         apart, framing a column they do not belong to. The rule stays full
         width; only the row inside it narrows. -->
    <div class="border-b border-border shrink-0">
      <div
        class="flex items-center gap-2 px-3 h-9"
        :class="{ 'max-w-3xl mx-auto': ui.agentMaximized }"
      >
        <span class="codicon codicon-sm codicon-sparkle text-accent" />
        <span class="text-xs uppercase tracking-wide text-fg-3">Agent</span>
        <!-- Starting over is the most-reached-for thing in this header, so it
             sits next to the title with a shape of its own rather than as the
             third identical icon in the row on the right. -->
        <button
          class="flex shrink-0 items-center gap-1 rounded-md border border-border bg-bg-2/60 px-1.5 py-0.5 text-[11px] text-fg-2 transition-colors hover:border-accent/40 hover:bg-bg-2 hover:text-fg-0"
          :title="$t('chat.newChat')"
          @click="chat.newSession()"
        >
          <span class="codicon codicon-sm codicon-add" />
          <span>{{ $t('chat.newChatShort') }}</span>
        </button>
        <span class="flex-1" />
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
    <div v-if="chat.tabs.length > 1" class="border-b border-border bg-bg-1 shrink-0">
      <div class="flex items-stretch h-8" :class="{ 'max-w-3xl mx-auto': ui.agentMaximized }">
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
      </div>
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
      </div>
      </div>
    </div>

    <!-- Transcript. Maximized → center each message at a readable width so long
         lines don't stretch edge to edge. The constraint is on the CHILDREN,
         never on the scroller: narrowing the scroll container would move the
         scrollbar (and the wheel's target area) into the middle of the window,
         so scrolling would only work with the cursor over the column. -->
    <div
      ref="scroller"
      class="flex-1 panel-scroll px-3 py-3 space-y-4 w-full"
      :class="{ '[&>*]:max-w-3xl [&>*]:mx-auto': ui.agentMaximized }"
      @scroll.passive="onTranscriptScroll"
    >
      <!-- Empty panel: a centred greeting, then the three things worth knowing
           as rows. One child of the scroller, so the transcript's own spacing is
           untouched the moment a message exists. -->
      <div v-if="!chat.messages.length">
        <p class="text-center text-base font-medium text-fg-1 leading-relaxed">
          {{ $t('chat.emptyLead') }}
        </p>
        <ul class="mt-4 space-y-2">
          <li
            v-for="row in emptyRows"
            :key="row.icon"
            class="flex gap-2.5 text-xs text-fg-3 leading-relaxed"
          >
            <span class="codicon codicon-sm shrink-0 mt-0.5" :class="row.icon" />
            <span>{{ row.text }}</span>
          </li>
        </ul>
      </div>

      <MessageRow
        v-for="m in chat.messages"
        :key="m.id"
        :m="m"
        :last="m.id === lastId"
        :cite-sources="sessionCiteSources"
        :kb-paths="kbPaths"
        :version="ver(m)"
        :editing="chat.editing?.id === m.id"
        :copied="copiedMsg === m.id"
        @copied="markCopied(m.id)"
        @re-ask="reAsk(m)"
        @continue-turn="continueTurn"
      />
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
          @click="chat.currentSessionId && chat.dismissPlan(chat.currentSessionId)"
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
      class="relative px-3 pb-2 flex items-center gap-2 shrink-0 flex-wrap w-full"
      :class="{ 'max-w-3xl mx-auto': ui.agentMaximized }"
    >
      <template v-if="kbSkills.length">
        <button
          v-for="s in chipSkills"
          :key="s.name"
          class="btn text-xs"
          :title="s.description"
          @click="preset(`/${s.name} `)"
        >
          /{{ s.name }}
        </button>
        <button
          v-if="kbSkills.length > chipSkills.length"
          class="btn text-xs px-1.5"
          :title="$t('chat.allSkills')"
          @click="toggleSkillMenu"
        >
          <span
            class="codicon codicon-sm"
            :class="skillMenuOpen ? 'codicon-chevron-down' : 'codicon-chevron-up'"
          />
        </button>
        <!-- The full list, opening upward over the transcript. Capped height so
             a hundred skills scroll instead of covering the conversation. -->
        <template v-if="skillMenuOpen">
          <div class="fixed inset-0 z-10" @click="skillMenuOpen = false" />
          <div
            class="absolute bottom-full left-3 right-3 mb-1 z-20 max-h-64 overflow-y-auto rounded-md border border-border bg-bg-1 shadow-lg"
          >
            <button
              v-for="s in kbSkills"
              :key="s.name"
              class="w-full flex items-baseline gap-2 px-2 py-1.5 text-left text-xs text-fg-2 hover:bg-bg-2"
              @click="runSkill(s.name)"
            >
              <span class="font-mono shrink-0">/{{ s.name }}</span>
              <span class="truncate text-fg-3">{{ s.description }}</span>
            </button>
          </div>
        </template>
      </template>
      <template v-else>
        <button
          class="btn text-xs"
          @click="preset('Ingest the un-processed sources under raw/: read each one, then create or update wiki pages for them following the KB schema. Link new pages from the index.')"
        >
          {{ $t('chat.presetIngest') }}
        </button>
        <button
          class="btn text-xs"
          @click="preset('Check this knowledge base for problems: orphan pages, broken wikilinks, missing index entries, contradictions. Report what you find; only fix things after listing them.')"
        >
          {{ $t('chat.presetLint') }}
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
        v-if="mentionOpen && (mentionMatches.length || tabsGroupShown) && !slashMatches.length"
        class="absolute bottom-full left-3 right-3 mb-1 z-20 rounded-md border border-border bg-bg-1 shadow-lg overflow-hidden"
      >
        <div
          v-if="mentionGrouped"
          class="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-fg-3"
        >
          {{ $t('chat.mentionFiles') }}
        </div>
        <button
          v-for="(p, i) in mentionFiles"
          :key="p"
          class="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs"
          :class="i === mentionSel ? 'bg-accent/15 text-fg-0' : 'text-fg-2 hover:bg-bg-2'"
          @mousedown.prevent="pickMention(p)"
          @mousemove="mentionSel = i"
        >
          <span class="codicon codicon-sm codicon-file shrink-0" />
          <span class="truncate">{{ p }}</span>
        </button>
        <!-- Open browser tabs, when a connected server can list them. Picking
             one attaches it to the conversation instead of typing a token. -->
        <div
          v-if="tabsGroupShown"
          class="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-fg-3"
        >
          {{ $t('chat.mentionTabs') }}
          <!-- Listing tabs takes seconds (the extension walks every one), so say
               that it is happening rather than showing a gap. -->
          <span
            v-if="tabsLoading"
            class="codicon codicon-loading codicon-modifier-spin !text-[11px]"
          />
        </div>
        <div
          v-if="tabsLoading && !mentionTabs.length"
          class="px-2 py-1.5 text-xs text-fg-3"
        >
          {{ $t('chat.tabsLoading') }}
        </div>
        <button
          v-for="(tab, i) in mentionTabs"
          :key="`t${tab.tabId}`"
          class="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs"
          :class="
            mentionFiles.length + i === mentionSel
              ? 'bg-accent/15 text-fg-0'
              : 'text-fg-2 hover:bg-bg-2'
          "
          :title="tab.url"
          @mousedown.prevent="pickMentionItem({ tab })"
          @mousemove="mentionSel = mentionFiles.length + i"
        >
          <span class="codicon codicon-sm codicon-globe shrink-0" />
          <span class="truncate min-w-0">{{ tab.title }}</span>
          <span class="ml-auto shrink-0 text-fg-3 truncate max-w-[40%]">{{ hostOf(tab.url) }}</span>
        </button>
      </div>

      <!-- The agent is blocked waiting on the user: a key, an extension, a
           choice. Sits above the composer because that is where they are
           already looking. -->
      <SetupCard v-if="setupRequest" :request="setupRequest" />

      <!-- Nothing works without a model, so say that here rather than letting
           the first message silently pop the Settings modal. -->
      <div
        v-if="!settingsStore.isConfigured()"
        class="mb-2 rounded-xl border border-accent/40 bg-accent/5 px-3 py-2.5"
      >
        <div class="text-sm text-fg-1">{{ $t('chat.noModelTitle') }}</div>
        <p class="mt-0.5 text-xs text-fg-3 leading-relaxed">{{ $t('chat.noModelDesc') }}</p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <button class="btn text-xs" @click="ui.openSettings('models')">
            {{ $t('chat.noModelAction') }}
          </button>
          <!-- The one way to see the agent work before owning a key: the demo
               borrows a model. Second, because someone who has a key wants the
               first button. -->
          <button class="btn text-xs" @click="tryDemo()">{{ $t('chat.noModelDemo') }}</button>
        </div>
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
        <!-- A re-ask waiting to be sent. Sending forks the conversation at that
             message instead of continuing from the end, which is too large a
             difference to leave implicit — the chip says so and ✕ calls it off. -->
        <div v-if="chat.editing" class="px-3 pt-2.5">
          <div
            class="flex items-center gap-1 text-xs pl-1.5 pr-1 py-1 rounded-md border border-accent/40 bg-accent/5"
          >
            <span class="codicon codicon-sm codicon-edit text-accent shrink-0" />
            <!-- The label is the way back to the message: clicking it scrolls
                 the transcript to the one being re-asked, which is also the one
                 outlined up there. Takes the whole width so ✕ sits hard right. -->
            <button
              class="flex items-center gap-1 min-w-0 flex-1 text-left"
              :title="userText(chat.editing)"
              @click="scrollToEditing()"
            >
              <span class="shrink-0 font-medium text-fg-1">{{ $t('chat.reAsking') }}</span>
              <span class="text-fg-3 shrink-0">·</span>
              <span class="truncate text-fg-3 italic">{{ snippet(userText(chat.editing)) }}</span>
            </button>
            <button
              class="text-fg-3 hover:text-removed shrink-0"
              :title="$t('common.cancel')"
              @click="chat.cancelEdit()"
            >
              <span class="codicon codicon-sm codicon-close" />
            </button>
          </div>
        </div>

        <!-- Browser tabs staged for the next message (localmd Connect). They go
             with it — see composer.tabs — so this row is empty again the moment
             it is sent. -->
        <div v-if="composer.tabs.length" class="flex flex-wrap gap-1.5 px-3 pt-2.5">
          <div
            v-for="tab in composer.tabs"
            :key="tab.tabId"
            class="group flex items-center gap-1 max-w-full text-xs pl-1.5 pr-1 py-1 rounded-md border border-border bg-bg-2/60"
            :title="`${tab.title}\n${tab.url}\n\n${$t('chat.tabAttached')}`"
          >
            <span class="codicon codicon-sm codicon-globe shrink-0 text-fg-3" />
            <span class="truncate min-w-0 text-fg-1">{{ tab.title }}</span>
            <button
              class="text-fg-3 hover:text-removed shrink-0 ml-0.5"
              :title="$t('chat.removeTab')"
              @click="composer.detachTab(tab.tabId)"
            >
              <span class="codicon codicon-sm codicon-close" />
            </button>
          </div>
        </div>

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
            <!-- Downloaded files carry long names; the chip is capped at the
                 composer width, so the name truncates rather than spilling. -->
            <button
              v-if="r.file"
              class="truncate min-w-0 font-medium text-fg-1 hover:text-fg-0 hover:underline"
              :title="r.file"
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
              class="group relative w-14 h-14 rounded overflow-hidden border border-border bg-bg-2 cursor-pointer"
              :title="a.path"
              @click="openAttachment(a.path)"
            >
              <img :src="thumbFor(a.path)" class="w-full h-full object-cover" alt="" />
              <button
                class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center bg-bg-0/80 text-fg-2 hover:text-fg-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                :title="$t('common.remove')"
                @click.stop="removeAttachment(i)"
              >
                <span class="codicon codicon-close text-[10px]" />
              </button>
            </div>
            <!-- non-image (or thumbnail not ready) → text chip -->
            <span
              v-else
              class="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-bg-2 text-fg-2 cursor-pointer hover:text-fg-0"
              :title="a.path"
              @click="openAttachment(a.path)"
            >
              <span class="codicon codicon-sm" :class="a.image ? 'codicon-device-camera' : 'codicon-file'" />
              <span class="truncate max-w-[140px]">{{ baseName(a.path) }}</span>
              <button class="text-fg-3 hover:text-fg-0" @click.stop="removeAttachment(i)">
                <span class="codicon codicon-sm codicon-close" />
              </button>
            </span>
          </template>
          <!-- Saving sits among the attachment chips, so it says so the way the
               rest of the app does: the spinner turns, and the word is only the
               caption on it. A still "Saving…" next to a row that has not
               changed yet is indistinguishable from one that is stuck. -->
          <span v-if="importing" class="flex items-center gap-1 text-xs text-fg-3 px-1 py-0.5">
            <span class="codicon codicon-sm codicon-loading codicon-modifier-spin" />
            {{ $t('common.saving') }}
          </span>
        </div>

        <textarea
          ref="textarea"
          v-model="input"
          rows="3"
          class="w-full bg-transparent border-0 outline-none resize-none font-sans text-sm text-fg-0 placeholder-fg-3 px-3 pt-2.5"
          :placeholder="
            tabsAvailable ? $t('chat.inputPlaceholderTabs') : $t('chat.inputPlaceholder')
          "
          @keydown="onKeydown"
          @focus="loadOpenTabs()"
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
              <span class="text-accent agent-working">{{ $t('chat.agentWorking') }}</span> · {{ $t('chat.steerHint') }}
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
