import { defineStore } from 'pinia'
import { ref, computed, reactive, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useSetupStore } from '@/stores/setup'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useApprovalsStore, type ApprovalDecision } from '@/stores/approvals'
import { usePlanStore } from '@/stores/plan'
import { useMcpStore } from '@/stores/mcp'
import { buildSystemPrompt } from '@/agent/prompt'
import { runTurn } from '@/agent/run'
import { runMockTurn } from '@/agent/mock'
import { loadKbImage, toDataUrl } from '@/agent/vision'
import { extractMentions } from '@/lib/mentions'
import {
  trimHistory,
  estimateChars,
  TRIM_AT_CHARS,
  COMPACT_AT_CHARS,
  splitForCompaction,
  renderTranscript,
  compactedPrefix,
} from '@/lib/history'
import { summarize as summarizeHistory, generateTitle } from '@/agent/summarize'
import { loadSkill } from '@/lib/skills'
import { renderTranscript as renderTranscriptFile, sessionFileName } from '@/lib/transcript'
import { pdfPage } from '@/lib/viewMemory'
import { fileKind } from '@/lib/filetypes'
import { isAnnotationsPath, renderAnnotationsDigest } from '@/lib/annotations'
import { describeQuote } from '@/lib/quoteContext'
import * as fs from '@/lib/fs'
import * as idb from '@/lib/idb'
import type { AgentEvent } from '@/agent/types'
import type { HunkLine } from '@/lib/diff'
import type { SelectionRef } from '@/stores/composer'
import type { ModelMessage } from 'ai'

/** A user message's model-facing content: plain enriched text, or that text
 *  plus inline image parts (multimodal primary). Kept minimal to avoid Vue's
 *  reactive unwrap recursing the deep ModelMessage union (TS2589). */
type UserContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image'; image: string; mediaType?: string }
    >

/** Ambient "now" stamp appended to each user message so the agent knows the
 *  current moment — dating notes, resolving "today"/"recent", frontmatter
 *  dates — without a tool round-trip. It lives on the message (not the system
 *  prompt) so the cached prompt prefix stays byte-stable across turns, and is
 *  baked in once at send time so history never mutates. Local wall clock, in
 *  the user's own timezone. */
function currentTimeNote(): string {
  const now = new Date()
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const date = now.toLocaleDateString('en-CA') // YYYY-MM-DD
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `[Current date & time: ${date} (${weekday}) ${time}${tz ? ` ${tz}` : ''}]`
}

export type MessagePart =
  | { type: 'text'; text: string }
  /** `startedAt`/`elapsedMs` let the UI show how long the model thought.
   *  `elapsedMs` is stamped when the block ends (other content begins / turn ends). */
  | { type: 'thinking'; text: string; startedAt?: number; elapsedMs?: number }
  /** `status`/`startedAt`/`elapsedMs` are set only for id-bearing tool calls
   *  (external MCP tools) so the UI can show a loading spinner + timer;
   *  instant built-in tools stay status-less and render as a plain line. */
  | {
      type: 'tool'
      name: string
      detail: string
      id?: number
      status?: 'running' | 'done' | 'error'
      startedAt?: number
      elapsedMs?: number
      /** Raw call arguments, kept for MCP tools so the UI can expand the full
       *  params (describeCall truncates them to a one-line summary). */
      args?: Record<string, unknown>
      /** The tool's output (capped), shown when the call is expanded. */
      result?: string
    }
  /** A created artifact (interactive HTML) — a clickable card that opens the
   *  file at `path`. `pending` = still being generated (loading card). */
  | { type: 'artifact'; title: string; path: string; pending?: boolean }
  /** A generated image saved into the KB (generate_image tool), shown inline. */
  | { type: 'image'; path: string }
  /** An ask-first write paused on the user — the decision card in the
   *  transcript. Carries a capped display diff (never the full contents, which
   *  stay in the waiting tool call); `decision` is stamped when the user
   *  settles it, turning the card into a read-only record. */
  | {
      type: 'approval'
      approvalId: string
      path: string
      deleted?: boolean
      dir?: boolean
      restorable?: boolean
      diff: HunkLine[]
      added: number
      removed: number
      truncated?: number
      decision?: ApprovalDecision
    }

/** Tool results (file contents, diffs, tab dumps) can be large; keep only a
 *  preview in the transcript so persisted sessions don't balloon. */
function capToolResult(s: string): string {
  const MAX = 4000
  return s.length > MAX ? `${s.slice(0, MAX)}\n… (+${s.length - MAX} characters truncated)` : s
}

/** A file the user attached to a message (pasted screenshot / upload). Already
 *  saved into the KB — `path` is its KB location. */
export interface Attachment {
  path: string
  image: boolean
}

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  /** Optional: sessions persisted before cache-write tracking lack it. */
  cacheWrite?: number
}

export interface UiMessage {
  id: number
  role: 'user' | 'assistant'
  parts: MessagePart[]
  attachments?: Attachment[]
  /** Passages the user selected in a file and staged as context (see composer). */
  contexts?: SelectionRef[]
  usage?: TokenUsage
  error?: string
  /** The turn ran out of steps rather than finishing. Rendered as an explicit
   *  notice with a Continue action — otherwise a truncated turn is
   *  indistinguishable from a completed one, and any plan it kept looks stalled
   *  when the work simply stopped mid-flight. */
  stoppedAtLimit?: boolean
}

interface ChatSession {
  id: string
  kb: string
  title: string
  /** Primary profile id the history was built with. */
  profileId: string
  /** 'mock' for the E2E provider, 'sdk' for every real provider. */
  provider: string
  uiMessages: UiMessage[]
  /** Unified AI SDK wire history (all providers share one shape). Opaque to the
   *  store — passed to runTurn/runMockTurn and stored verbatim. Typed loosely so
   *  Vue's reactive unwrap doesn't recurse the deep ModelMessage union (TS2589);
   *  cast to ModelMessage[] at the boundaries. */
  history: unknown[]
  createdAt: number
  updatedAt: number
  /** Starred by the user. A visual marker that also spares the session first
   *  when the tab cap recycles an idle tab. Does NOT reorder history. */
  favorite: boolean
}

/** An open chat tab: a session plus its runtime `running` flag. Multiple tabs
 *  run concurrently; `running` is not persisted. */
interface OpenSession extends ChatSession {
  running: boolean
}

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
  favorite: boolean
}

/** Text files this small are inlined into the message when @-mentioned;
 *  larger ones the agent reads via tools. */
const INLINE_MENTION_CHARS = 16_000

let nextId = 1

export const useChatStore = defineStore('chat', () => {
  const kb = useKbStore()

  /** Max concurrent chat tabs — 1 unless the user turned on multi-tab in
   *  settings (then their cap, 2-8). Creating/opening past this recycles the
   *  oldest idle tab; if every tab is running, the action is refused. */
  function maxTabs(): number {
    const s = useSettingsStore().state
    return s.agentMultiTab ? Math.min(8, Math.max(2, s.agentMaxTabs || 2)) : 1
  }

  // Open chat tabs run concurrently. Each carries its own `running` flag; the
  // per-session AbortController lives in a non-reactive map. Switching the
  // active tab never touches another tab's in-flight turn.
  const tabs = ref<OpenSession[]>([])
  const activeId = ref<string | null>(null)
  const sessions = ref<SessionSummary[]>([])
  const historyOpen = ref(false)
  const limitMsg = ref('')

  const controllers = new Map<string, AbortController>()

  // Sessions detached from the tab bar while their turn is still running (the
  // user switched away or closed the tab). They keep streaming via their
  // send-loop closure and persist on finish; re-opening one re-attaches it live.
  // A plain reference keeps the (already reactive) session object alive.
  const background = new Map<string, OpenSession>()

  // Mid-turn steering: messages the user submits WHILE a tab's turn is running.
  // The running turn stops at its next step boundary (via steerPending), then
  // the send loop appends these to the wire history and continues in a fresh
  // assistant bubble — so an interjection lands in the very next model step
  // instead of being dropped or starting a competing turn. Non-reactive.
  const steerQueue = new Map<string, ModelMessage[]>()
  const steerPending = (id: string): boolean => (steerQueue.get(id)?.length ?? 0) > 0

  const active = computed(() => tabs.value.find((t) => t.id === activeId.value) ?? null)
  const messages = computed<UiMessage[]>(() => active.value?.uiMessages ?? [])
  const running = computed(() => active.value?.running ?? false)

  // Sessions are per-KB: on KB switch, reload the list and auto-open the most
  // recent session (if any) so the user resumes where they left off.
  watch(
    () => kb.name,
    async (name) => {
      stopAll()
      tabs.value = []
      activeId.value = null
      historyOpen.value = false
      // Per-session subsystem state belongs to the old KB's sessions.
      usePlanStore().reset()
      useMcpStore().clearActivated()
      if (!name) {
        sessions.value = []
        return
      }
      const stored = await idb.listSessions(name) // sorted newest-first
      if (kb.name !== name) return // KB switched again while we awaited
      sessions.value = summarize(stored)
      if (stored.length) adoptSession(stored[0])
    },
    { immediate: true },
  )

  function summarize(list: idb.StoredSession[]): SessionSummary[] {
    // Order is recency only (idb already sorts newest-first). Favorite is NOT a
    // sort key — starring/unstarring must leave a row exactly where it is, so
    // the list order stays put across toggles.
    return list.map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: s.updatedAt,
      favorite: s.favorite ?? false,
    }))
  }

  function makeEmptySession(): OpenSession {
    return reactive({
      id: crypto.randomUUID(),
      kb: kb.name ?? '',
      title: 'New chat',
      profileId: '',
      provider: '',
      uiMessages: [],
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      favorite: false,
      running: false,
    }) as OpenSession
  }

  /** Add a tab, honoring the tab cap by recycling the oldest idle tab. Returns
   *  false (and flashes a message) when every existing tab is busy. */
  function addTab(s: OpenSession): boolean {
    const max = maxTabs()
    if (tabs.value.length >= max) {
      // Recycle a tab to stay within the cap: prefer an idle NON-favorite one,
      // then any idle tab, else detach the oldest. closeTab keeps a running turn
      // alive in the background, so recycling never interrupts anything. (The
      // session itself survives in IDB regardless — this only frees a tab slot.)
      const victim =
        tabs.value.find((t) => !t.running && !t.favorite) ??
        tabs.value.find((t) => !t.running) ??
        tabs.value[0]
      if (victim) closeTab(victim.id)
    }
    tabs.value.push(s)
    // Start the session with the deferred tools this KB actually uses already
    // active: no enable_tools round trip in the common case, and a tool set
    // that stays byte-stable from request one (it sits at the very front of the
    // provider's cache prefix — activating mid-turn invalidates everything).
    // Skipped for a re-attached running session: growing ITS tool set mid-turn
    // is the exact invalidation this avoids elsewhere.
    if (!s.running) useMcpStore().preactivate(s.id)
    return true
  }

  function activateTab(id: string): void {
    if (tabs.value.some((t) => t.id === id)) activeId.value = id
    historyOpen.value = false
  }

  function closeTab(id: string): void {
    // A running turn must SURVIVE tab close — only the stop button, deleting the
    // session, a KB switch, or a full page close may abort it. When it's running
    // we just detach the tab; the send loop's closure keeps streaming into the
    // (now off-screen) session and persists it on finish, so it reappears in
    // history. When idle, tear down its per-subsystem state as before.
    const t = tabs.value.find((x) => x.id === id)
    if (t?.running) {
      // Keep the live object so re-opening resumes its stream; its own finally
      // drops it from `background` once the turn ends.
      background.set(id, t)
    } else {
      controllers.get(id)?.abort()
      controllers.delete(id)
      steerQueue.delete(id)
      background.delete(id)
      // Release the session's per-subsystem state (paused approvals, plan,
      // deferred-tool activations).
      useApprovalsStore().clearSession(id)
      usePlanStore().clear(id)
      useMcpStore().clearActivated(id)
    }
    const i = tabs.value.findIndex((x) => x.id === id)
    if (i < 0) return
    tabs.value.splice(i, 1)
    if (activeId.value === id) {
      activeId.value = tabs.value[Math.min(i, tabs.value.length - 1)]?.id ?? null
    }
  }

  function newSession(): void {
    // Reuse an existing empty draft tab rather than piling up blank tabs.
    const empty = tabs.value.find((t) => !t.uiMessages.length && !t.running)
    if (empty) activeId.value = empty.id
    else {
      const s = makeEmptySession()
      if (!addTab(s)) return
      activeId.value = s.id
    }
    historyOpen.value = false
    // plan/mcp state is keyed per session — a fresh session starts empty.
  }

  /** Open a stored session as a tab (deduped: focus it if already open). */
  function adoptSession(stored: idb.StoredSession): void {
    const existing = tabs.value.find((t) => t.id === stored.id)
    if (existing) {
      activeId.value = existing.id
      historyOpen.value = false
      return
    }
    const s = reactive({ ...(stored as unknown as ChatSession), running: false }) as OpenSession
    // Legacy sessions persisted before the unified SDK history have no `history`
    // field (they carried separate anthropic/openai wire histories). Start their
    // wire history fresh — the UI transcript is intact; only cross-turn model
    // context for that old conversation is lost, and rebuilds on the next send.
    if (!Array.isArray(s.history)) s.history = []
    if (typeof s.favorite !== 'boolean') s.favorite = false // pre-favorite sessions
    // A session persisted mid-stream (reload during a turn) can carry unsettled
    // parts: stop forever-spinning tool calls, drop never-written artifacts,
    // and settle approval cards nobody can answer any more (the waiting tool
    // died with the page — the write never happened).
    for (const m of s.uiMessages) {
      for (const p of m.parts) {
        if (p.type === 'tool' && p.status === 'running') p.status = 'error'
        if (p.type === 'approval' && !p.decision) p.decision = 'stopped'
      }
      m.parts = m.parts.filter((p) => !(p.type === 'artifact' && p.pending))
    }
    if (!addTab(s)) return
    const maxId = s.uiMessages.reduce((a, m) => Math.max(a, m.id), 0)
    nextId = Math.max(nextId, maxId + 1)
    activeId.value = s.id
    historyOpen.value = false
  }

  async function openSession(id: string): Promise<void> {
    const existing = tabs.value.find((t) => t.id === id)
    if (existing) {
      activeId.value = existing.id
      historyOpen.value = false
      return
    }
    // A still-running session that was switched away from lives in `background`,
    // not IDB (which only has its last snapshot). Re-attach the live object so
    // its stream keeps rendering, rather than loading a frozen copy.
    const detached = background.get(id)
    if (detached) {
      background.delete(id)
      addTab(detached)
      activeId.value = detached.id
      historyOpen.value = false
      return
    }
    const stored = await idb.getSession(id)
    if (!stored) return
    adoptSession(stored)
  }

  async function removeSession(id: string): Promise<void> {
    // Deleting the session must abort its turn first — otherwise closeTab would
    // leave it running and it would re-persist itself right after we delete it.
    stop(id)
    closeTab(id)
    await idb.deleteSession(id)
    if (kb.name) sessions.value = summarize(await idb.listSessions(kb.name))
  }

  async function persist(session: OpenSession): Promise<void> {
    if (!session.uiMessages.length) return
    session.updatedAt = Date.now()
    // JSON round-trip strips Vue reactivity proxies before structured clone.
    const snapshot = JSON.parse(JSON.stringify(session)) as idb.StoredSession & { running?: boolean }
    delete snapshot.running
    await idb.saveSession(snapshot)
    if (kb.name) sessions.value = summarize(await idb.listSessions(kb.name))
  }

  /** Star/unstar a session. Works whether it's an open tab, a detached running
   *  session, or only in IDB. For an open tab not yet persisted, the flag rides
   *  along on its next persist; for a stored session we patch IDB in place
   *  (without bumping updatedAt, so starring doesn't reorder by recency). */
  async function toggleFavorite(id: string): Promise<void> {
    const open = tabs.value.find((t) => t.id === id) ?? background.get(id)
    const stored = await idb.getSession(id)
    const next = !(stored?.favorite ?? open?.favorite ?? false)
    if (open) open.favorite = next
    if (stored) {
      stored.favorite = next
      await idb.saveSession(stored)
    }
    if (kb.name) sessions.value = summarize(await idb.listSessions(kb.name))
  }

  /** Render the current (or given) session as a markdown snapshot plus a default
   *  file name. The UI's "save session" button writes it wherever the user picks;
   *  the agent's save_transcript tool writes it into the KB. Null when empty. */
  function renderSession(
    id: string | null = activeId.value,
  ): { name: string; content: string } | null {
    const s = tabs.value.find((t) => t.id === id)
    if (!s || !s.uiMessages.length) return null
    return { name: sessionFileName(s.title, s.createdAt), content: renderTranscriptFile(s) }
  }

  /** Stop a single session's turn (the active one by default). Only that
   *  session's paused approvals are rejected — others keep waiting. */
  function stop(id: string | null = activeId.value): void {
    if (!id) return
    controllers.get(id)?.abort()
    controllers.delete(id)
    steerQueue.delete(id) // a stopped turn must not later consume queued steers
    background.delete(id)
    const t = tabs.value.find((x) => x.id === id)
    if (t) t.running = false
    // Writes paused for approval must not dangle after the turn dies — they
    // release as 'stopped', which is not a rejection.
    useApprovalsStore().clearSession(id)
  }

  function stopAll(): void {
    for (const c of controllers.values()) c.abort()
    controllers.clear()
    steerQueue.clear()
    background.clear()
    for (const t of tabs.value) t.running = false
    useApprovalsStore().clearSession()
  }

  /** A leading /skill-name invocation forces that skill: the full SKILL.md
   *  is inlined so the model executes it without a use_skill round trip. */
  async function expandSlashSkill(trimmed: string): Promise<string> {
    const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(trimmed)
    if (!m) return trimmed
    const skill = await loadSkill(m[1])
    if (!skill) return trimmed // unknown /token — send as-is
    const resources = skill.resources.length
      ? `\nBundled resources (read with read_file when referenced): ${skill.resources.join(', ')}`
      : ''
    return (
      `Execute the "${skill.name}" skill now. Skill instructions:\n\n${skill.body}${resources}\n\n` +
      (m[2]?.trim() ? `User input for this run: ${m[2].trim()}` : 'No additional user input.')
    )
  }

  /** Model-facing message text: user text + notes about attachments and
   *  @-mentioned files (small text files inlined; documents pointed at their
   *  index workflow; images listed — they travel separately as image parts
   *  or through view_image). */
  async function buildModelText(
    trimmed: string,
    attachments: Attachment[],
    mentioned: string[],
    imagePaths: string[],
    imagesTravelInline: boolean,
    visionAvailable: boolean,
    selections: SelectionRef[],
    session: ChatSession,
  ): Promise<string> {
    let out = trimmed
    // Ambient current time, so date-aware tasks work without a tool round-trip.
    out += `\n\n${currentTimeNote()}`
    const uploaded = attachments.filter((a) => !a.image).map((a) => a.path)
    if (uploaded.length) {
      out += `\n\n[The user uploaded files with this message (saved to the KB): ${uploaded.join(', ')} — use read_file to view their contents]`
    }
    if (imagePaths.length) {
      if (imagesTravelInline) {
        out += `\n\n[Images attached to this message (saved to the KB): ${imagePaths.join(', ')}]`
      } else if (visionAvailable) {
        out += `\n\n[Images attached to this message (saved to the KB): ${imagePaths.join(', ')} — use the view_image tool to see their contents]`
      } else {
        out += `\n\n[Images attached to this message (saved to the KB): ${imagePaths.join(', ')} — no vision model is currently configured, so the image contents can't be viewed; you may suggest the user configure one in Settings]`
      }
    }
    // What the user is looking at right now — lets "summarize this file" work
    // without an explicit @-mention.
    const files = useFilesStore()
    const viewing = files.currentPath
    if (viewing) {
      const page = fileKind(viewing) === 'pdf' ? pdfPage.get(viewing) : undefined
      out += `\n\n[The user is currently viewing: ${viewing}${page ? ` (page ${page})` : ''}]`
    }
    const textMentions = mentioned.filter((p) => !imagePaths.includes(p))
    if (textMentions.length) {
      const blocks: string[] = []
      for (const p of textMentions) {
        const kind = fileKind(p)
        if (kind === 'pdf' || kind === 'epub' || kind === 'docx') {
          blocks.push(`@${p}: ${kind.toUpperCase()} document — read it via read_file through the structured index.`)
          continue
        }
        if (isAnnotationsPath(p)) {
          // Sidecar JSON is rect/CFI noise — inline the readable digest instead.
          const raw = await fs.tryReadFile(p)
          const digest = raw !== null ? renderAnnotationsDigest(p, raw) : null
          if (digest) {
            blocks.push(`@${p} contents (rendered annotations view):\n${digest}`)
            continue
          }
        }
        const content = await fs.tryReadFile(p)
        if (content === null) {
          blocks.push(`@${p}: (file does not exist)`)
        } else if (content.length <= INLINE_MENTION_CHARS) {
          blocks.push(`@${p} contents:\n\`\`\`\n${content}\n\`\`\``)
        } else {
          blocks.push(`@${p}: file is large (${content.length} characters) — use read_file to read it.`)
        }
      }
      out += `\n\n<referenced_files>\n${blocks.join('\n\n')}\n</referenced_files>`
    }
    // Passages the user selected and asked about explicitly. Each block leads
    // with where it came from — which file and section, or which of your replies
    // — because "look into this" means different work depending on the answer.
    if (selections.length) {
      const scope = { sessionId: session.id, messages: session.uiMessages, viewing }
      const blocks = selections.map(
        (s) => `${describeQuote(s, scope)}:\n\`\`\`\n${s.text}\n\`\`\``,
      )
      out += `\n\n<selected_context>\n${blocks.join('\n\n')}\n</selected_context>`
    }
    return out
  }

  /** Model-facing user content (enriched text + optional inline images for a
   *  multimodal primary) plus the matching UI bubble. Shared by a normal send
   *  and a mid-turn steer so both enrich identically (@mentions, selections,
   *  attachments, current view). */
  async function prepareUserMessage(
    trimmed: string,
    attachments: Attachment[],
    selections: SelectionRef[],
    session: ChatSession,
  ): Promise<{ content: UserContent; ui: UiMessage }> {
    const settings = useSettingsStore()
    const files = useFilesStore()
    const mentioned = extractMentions(trimmed, files.allFiles)
    const imagePaths = [
      ...attachments.filter((a) => a.image).map((a) => a.path),
      ...mentioned.filter((p) => fileKind(p) === 'image' && !/\.svg$/i.test(p)),
    ].filter((p, i, arr) => arr.indexOf(p) === i)
    const inline = settings.visionInline
    const modelText = await buildModelText(
      await expandSlashSkill(trimmed),
      attachments,
      mentioned,
      imagePaths,
      inline,
      settings.visionAvailable,
      selections,
      session,
    )
    // A multimodal primary gets images inline; the AI SDK formats them per
    // provider. A text-only primary sees only the path notes (view_image tool).
    const inlineImages = inline
      ? (await Promise.all(imagePaths.map((p) => loadKbImage(p)))).filter(
          (i): i is NonNullable<typeof i> => i !== null,
        )
      : []
    const content: UserContent = inlineImages.length
      ? [
          { type: 'text', text: modelText },
          ...inlineImages.map((img) => ({
            type: 'image' as const,
            image: toDataUrl(img),
            mediaType: img.mediaType,
          })),
        ]
      : modelText
    const ui: UiMessage = {
      id: nextId++,
      role: 'user',
      parts: [{ type: 'text', text: trimmed }],
      attachments: attachments.length ? [...attachments] : undefined,
      contexts: selections.length ? [...selections] : undefined,
    }
    return { content, ui }
  }

  async function send(
    text: string,
    attachments: Attachment[] = [],
    selections: SelectionRef[] = [],
  ): Promise<void> {
    const trimmed = text.trim()
    if ((!trimmed && !attachments.length && !selections.length) || !kb.name) return
    const settings = useSettingsStore()
    const primary = settings.primary
    if (!primary) return

    // Every real provider runs through the one AI SDK loop; only the E2E mock
    // takes a separate path.
    const providerKind = primary.provider === 'mock' ? 'mock' : 'sdk'

    // Send goes to the active tab (creating one if none). Other tabs may be
    // mid-turn; only THIS tab being busy blocks a new send.
    let session = active.value
    if (!session) {
      session = makeEmptySession()
      if (!addTab(session)) return
      activeId.value = session.id
    }
    // STEER: a message submitted while THIS tab's turn is running is injected
    // into that turn at its next step boundary — not dropped, not a competing
    // turn. The running send loop drains the queue between segments.
    if (session.running) {
      if (providerKind === 'mock') return // the E2E mock path takes no steers
      const { content: steerContent, ui } = await prepareUserMessage(
        trimmed,
        attachments,
        selections,
        session,
      )
      session.uiMessages.push(ui)
      const q = steerQueue.get(session.id) ?? []
      q.push({ role: 'user', content: steerContent } as ModelMessage)
      steerQueue.set(session.id, q)
      void persist(session)
      return
    }

    if (!session.uiMessages.length) {
      session.title = (trimmed || selections[0]?.text || attachments[0]?.path || 'chat').slice(0, 40)
    }

    // Switching the primary profile mid-conversation would replay an
    // incompatible (or differently-priced) history — start the wire history
    // fresh; the UI transcript stays. (Also fills profile on a fresh session.)
    if (session.profileId !== primary.id || session.provider !== providerKind) {
      session.profileId = primary.id
      session.provider = providerKind
      session.history = []
    }

    const { content, ui } = await prepareUserMessage(trimmed, attachments, selections, session)
    session.uiMessages.push(ui)
    // reactive() is load-bearing: onEvent mutates this object from outside the
    // store's proxy — a raw object would render nothing until the turn ends (no
    // streaming). Mutating through the proxy triggers per-delta updates. `let`
    // (not const): each steer segment opens a fresh assistant bubble below the
    // interjection, which onEvent then streams into.
    let assistant: UiMessage = reactive({ id: nextId++, role: 'assistant', parts: [] })
    session.uiMessages.push(assistant)
    void persist(session)
    // Throttle streaming persistence so a reload mid-turn keeps the partial
    // reply (the turn-end persist never runs if the tab is closed first).
    let lastStreamPersist = Date.now()

    const onEvent = (e: AgentEvent): void => {
      const parts = assistant.parts
      const last = parts[parts.length - 1]
      // A thinking block ends the moment any other content begins — stamp its
      // duration so the UI can show "thought for Ns".
      if (
        e.type !== 'thinking' &&
        e.type !== 'usage' &&
        last?.type === 'thinking' &&
        last.startedAt != null &&
        last.elapsedMs == null
      ) {
        last.elapsedMs = Date.now() - last.startedAt
      }
      if (e.type === 'text') {
        if (last?.type === 'text') last.text += e.delta
        else parts.push({ type: 'text', text: e.delta })
      } else if (e.type === 'thinking') {
        if (last?.type === 'thinking') last.text += e.delta
        else parts.push({ type: 'thinking', text: e.delta, startedAt: Date.now() })
      } else if (e.type === 'usage') {
        const u = (assistant.usage ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
        u.input += e.input
        u.output += e.output
        u.cacheRead += e.cacheRead
        u.cacheWrite = (u.cacheWrite ?? 0) + e.cacheWrite
      } else if (e.type === 'tool_result') {
        const p = parts.find((x): x is Extract<MessagePart, { type: 'tool' }> =>
          x.type === 'tool' && x.id === e.id,
        )
        if (p) {
          p.status = e.ok ? 'done' : 'error'
          p.elapsedMs = Date.now() - (p.startedAt ?? Date.now())
          if (e.result != null) p.result = capToolResult(e.result)
        }
      } else if (e.type === 'artifact') {
        if (e.pending) {
          parts.push({ type: 'artifact', title: '', path: '', pending: true })
        } else {
          // Fill in the pending card from this turn, if any; else add one.
          const p = [...parts].reverse().find((x) => x.type === 'artifact' && x.pending)
          if (p && p.type === 'artifact') {
            p.title = e.title
            p.path = e.path
            p.pending = false
          } else {
            parts.push({ type: 'artifact', title: e.title, path: e.path })
          }
        }
      } else if (e.type === 'image') {
        parts.push({ type: 'image', path: e.path })
      } else if (e.type === 'approval') {
        parts.push({
          type: 'approval',
          approvalId: e.id,
          path: e.path,
          deleted: e.deleted,
          dir: e.dir,
          restorable: e.restorable,
          diff: e.diff,
          added: e.added,
          removed: e.removed,
          truncated: e.truncated,
        })
      } else if (e.type === 'approval_result') {
        const p = parts.find(
          (x): x is Extract<MessagePart, { type: 'approval' }> =>
            x.type === 'approval' && x.approvalId === e.id,
        )
        if (p) p.decision = e.decision
      } else if (e.type === 'limit') {
        assistant.stoppedAtLimit = true
      } else {
        // Only id-bearing tool calls get the loading/timer treatment.
        parts.push(
          e.id != null
            ? { type: 'tool', name: e.name, detail: e.detail, id: e.id, args: e.args, status: 'running', startedAt: Date.now() }
            : { type: 'tool', name: e.name, detail: e.detail, args: e.args },
        )
      }
      const t = Date.now()
      if (t - lastStreamPersist > 1000) {
        lastStreamPersist = t
        void persist(session)
      }
    }

    session.running = true
    const controller = new AbortController()
    controllers.set(session.id, controller)
    try {
      const system = await buildSystemPrompt()

      if (providerKind === 'mock') {
        // E2E test provider: deterministic scripted turns, no network.
        const hist: ModelMessage[] = [
          ...(session.history as ModelMessage[]),
          { role: 'user', content: content as string },
        ]
        session.history = hist
        session.history = await runMockTurn({
          system: `${system.stable}\n\n${system.dynamic}`,
          messages: [...hist],
          sessionId: session.id,
          onEvent,
          signal: controller.signal,
        })
      } else {
        // History hygiene runs as BATCH events, not per-send sweeps: rewriting
        // old bytes invalidates every provider's prefix cache from the rewrite
        // point, so between events the history must stay append-only. Once the
        // size crosses the threshold, stub everything outside the keep window
        // in one go (the stubs persist — old regions stay byte-stable).
        let hist = session.history as ModelMessage[]
        if (estimateChars(hist) > TRIM_AT_CHARS) hist = trimHistory(hist)
        // Still huge after trimming → replace the old prefix with a summary.
        if (estimateChars(hist) > COMPACT_AT_CHARS) {
          const split = splitForCompaction(hist)
          if (split) {
            onEvent({ type: 'tool', name: 'compact', detail: 'History too long, compacting context…' })
            try {
              const summary = await summarizeHistory(
                primary,
                renderTranscript(split.old),
                controller.signal,
              )
              const prefix = compactedPrefix(summary)
              hist = [
                { role: 'user', content: prefix.user },
                { role: 'assistant', content: prefix.assistant },
                ...split.recent,
              ]
            } catch {
              /* summarizer failed — carry on with the full history */
            }
          }
        }
        // Commit the user turn to the wire history BEFORE running, so an
        // interrupted turn (reload mid-stream) still replays it next time.
        hist = [...hist, { role: 'user', content } as ModelMessage]
        session.history = hist
        void persist(session)

        // Multi-segment turn for steering. runTurn stops at a step boundary
        // whenever an interjection is queued (steerPending); the agent loop does
        // NOT stop — we append the steer to the history, open a fresh assistant
        // bubble below it, and immediately continue, so the message lands in the
        // very next model step. A copy is passed so the committed history stays
        // clean on abort (no dangling tool calls).
        let messages: ModelMessage[] = [...hist]
        for (;;) {
          const next = await runTurn({
            profile: primary,
            system,
            messages,
            vision: settings.vision
              ? { profile: settings.vision, inline: settings.visionInline }
              : settings.visionInline
                ? { profile: primary, inline: true }
                : undefined,
            image: settings.image ?? undefined,
            sessionId: session.id,
            onEvent,
            signal: controller.signal,
            allowSubagent: true,
            steerPending: () => steerPending(session.id),
          })
          session.history = next
          const steers = steerQueue.get(session.id)
          if (!steers?.length) break
          steerQueue.delete(session.id)
          messages = [...(next as ModelMessage[]), ...steers]
          session.history = messages
          void persist(session)
          assistant = reactive({ id: nextId++, role: 'assistant', parts: [] })
          session.uiMessages.push(assistant)
        }
      }
    } catch (err) {
      const name = (err as Error).name
      const msg = (err as Error).message
      if (name === 'AbortError' || name === 'APIUserAbortError') {
        assistant.error = 'Stopped.'
      } else if (name === 'APIConnectionError' || /connection error/i.test(msg)) {
        assistant.error =
          'Connection error — the endpoint could not be reached from the browser. ' +
          'This usually means the Base URL does not allow browser (CORS) access, or the network blocks it. ' +
          'Open Settings and pick a preset endpoint — those are verified to work in browsers.'
      } else {
        assistant.error = msg
      }
    } finally {
      session.running = false
      controllers.delete(session.id)
      steerQueue.delete(session.id) // drop any interjection the ended turn never consumed
      background.delete(session.id) // a detached turn that just ended is a plain stored session now
      // A setup card only makes sense while its turn is waiting on it; an
      // aborted turn would otherwise leave one on screen with nothing behind it.
      useSetupStore().clearSession(session.id)
      // Same for a paused approval: the tool behind it is dead, so release it
      // as 'stopped' and stamp the card (the abort listener usually beat us to
      // it — both paths are idempotent).
      useApprovalsStore().clearSession(session.id)
      // A tool still "running" means the turn died mid-call (abort/error) before
      // its tool_result — settle it so the spinner doesn't spin forever.
      for (const p of assistant.parts) {
        if (p.type === 'approval' && !p.decision) p.decision = 'stopped'
        if (p.type === 'tool' && p.status === 'running') {
          p.status = assistant.error ? 'error' : 'done'
          p.elapsedMs = Date.now() - (p.startedAt ?? Date.now())
        } else if (p.type === 'thinking' && p.startedAt != null && p.elapsedMs == null) {
          p.elapsedMs = Date.now() - p.startedAt
        }
      }
      // A still-pending artifact means the turn died before the file was
      // written — drop the loading card so it doesn't spin forever.
      assistant.parts = assistant.parts.filter((p) => !(p.type === 'artifact' && p.pending))
      void persist(session)
      void autoTitle(session, trimmed, assistant)
    }
  }

  /** After the FIRST exchange, replace the sliced-text title with a short
   *  model-generated one (fire-and-forget; failures keep the fallback). */
  async function autoTitle(
    session: OpenSession,
    userText: string,
    assistant: UiMessage,
  ): Promise<void> {
    if (session.uiMessages.length > 2) return // only the first turn
    const settings = useSettingsStore()
    if (!settings.primary) return
    const reply = assistant.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join(' ')
    if (!reply) return
    const title = await generateTitle(settings.primary, userText, reply)
    if (title) {
      session.title = title
      void persist(session)
    }
  }

  /** Session-wide token totals (sum of every assistant message's usage). */
  const sessionUsage = computed<TokenUsage>(() => {
    const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    for (const m of messages.value) {
      if (!m.usage) continue
      total.input += m.usage.input
      total.output += m.usage.output
      total.cacheRead += m.usage.cacheRead
      total.cacheWrite += m.usage.cacheWrite ?? 0
    }
    return total
  })

  return {
    messages,
    tabs,
    sessions,
    running,
    historyOpen,
    limitMsg,
    sessionUsage,
    currentSessionId: computed(() => active.value?.id ?? null),
    currentFavorite: computed(() => active.value?.favorite ?? false),
    send,
    stop,
    newSession,
    openSession,
    removeSession,
    toggleFavorite,
    activateTab,
    closeTab,
    renderSession,
  }
})
