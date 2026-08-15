import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useChatStore } from '@/stores/chat'
import type { TabRef } from '@/lib/connectTabs'

/** Where a quoted passage was taken from, captured at selection time — the view
 *  moves on (the user scrolls, keeps chatting) but the provenance must not. The
 *  agent gets it as prose (see lib/quoteContext); the UI stays as it was.
 *
 *  File quotes carry a locator (`page` for PDFs, `heading` for rendered
 *  markdown); reply quotes carry the chat session and the UI message id of the
 *  reply, so the agent can tell WHICH of its answers is being pointed at. */
export interface QuoteOrigin {
  /** PDF page the passage sat on. */
  page?: number
  /** Nearest heading above the passage in the rendered file. */
  heading?: string
  /** Chat session the quoted reply belongs to. */
  sessionId?: string
  /** `UiMessage.id` of the quoted reply. */
  messageId?: number
}

/** A snapshot of text the user selected, staged in the composer as a context
 *  chip. Travels with the next message so the agent sees the exact passage the
 *  user is asking about.
 *
 *  `file` is the KB path a selection came from; an absent `file` means the text
 *  was quoted from a previous agent reply. `pinned` decides its lifetime: an
 *  unpinned chip is transient — it mirrors the live selection and vanishes when
 *  the user deselects. Pinning it (the quote icon) freezes it as a snapshot that
 *  lives until removed with ✕. */
export interface SelectionRef {
  id: string
  file?: string
  text: string
  pinned: boolean
  /** Provenance beyond `file` (absent on quotes staged before this existed). */
  from?: QuoteOrigin
}

export const useComposerStore = defineStore('composer', () => {
  /** Staged selections, in the order the user made them. At most one is the
   *  transient "live" chip (tracked by `liveId`); the rest are pinned. */
  const refs = ref<SelectionRef[]>([])
  let liveId: string | null = null

  /** Reflect the current selection as the single transient chip. `file` is the
   *  source path, or null for a quote from an agent reply; `from` carries the
   *  finer provenance. Pinned chips are untouched, and a selection already
   *  matching a pinned chip shows no dup. */
  function syncLive(file: string | null, text: string, from?: QuoteOrigin): void {
    const t = text.trim()
    if (!t) return
    const f = file || undefined
    const same = (r: SelectionRef): boolean => r.text === t && r.file === f
    if (refs.value.some((r) => r.pinned && same(r))) {
      dropLive()
      return
    }
    const live = liveId ? refs.value.find((r) => r.id === liveId && !r.pinned) : undefined
    if (live) {
      live.file = f
      live.text = t
      live.from = from
    } else {
      const r: SelectionRef = { id: crypto.randomUUID(), file: f, text: t, pinned: false, from }
      refs.value.push(r)
      liveId = r.id
    }
  }

  /** Remove just the transient chip (leaving pinned ones). */
  function dropLive(): void {
    if (!liveId) return
    refs.value = refs.value.filter((r) => r.id !== liveId)
    liveId = null
  }

  /** Selection cleared (deselect) → drop every unpinned chip. */
  function clearTransient(): void {
    if (refs.value.some((r) => !r.pinned)) refs.value = refs.value.filter((r) => r.pinned)
    liveId = null
  }

  /** Toggle a chip between transient (gray) and pinned (blue). Pinning decouples
   *  it from the live selection so a fresh selection starts a new transient chip. */
  function togglePin(id: string): void {
    const r = refs.value.find((x) => x.id === id)
    if (!r) return
    r.pinned = !r.pinned
    if (r.pinned && r.id === liveId) liveId = null
  }

  function remove(id: string): void {
    refs.value = refs.value.filter((r) => r.id !== id)
    if (id === liveId) liveId = null
  }

  function clear(): void {
    if (refs.value.length) refs.value = []
    liveId = null
  }

  /** Quotes taken from an agent reply belong to the conversation they were taken
   *  from — "this passage of your answer" points at nothing once another session
   *  is open, so those chips (including pre-provenance ones, which carry neither
   *  `file` nor `from`) are dropped on the switch. File quotes are KB-scoped and
   *  stay: the file is still there whichever conversation you ask in. */
  function dropForeignReplyQuotes(sessionId: string | null): void {
    const foreign = (r: SelectionRef): boolean => !r.file && r.from?.sessionId !== sessionId
    if (!refs.value.some(foreign)) return
    refs.value = refs.value.filter((r) => !foreign(r))
    if (liveId && !refs.value.some((r) => r.id === liveId)) liveId = null
  }

  /* ── attached browser tabs (localmd Connect) ───────────────────────────── */

  /**
   * Tabs are staged for ONE message and cleared when it is sent — the chip
   * above the box means "this message is about that page", so a chip still
   * sitting there afterwards is a claim about the next message that the user
   * never made. Nothing is lost by letting it go: the address travels inside
   * the sent message and stays in the wire history, so a follow-up still has
   * the tab_id to read from.
   *
   * They are keyed by session anyway, because staging survives a switch between
   * chat tabs — including `null`, the conversation that does not exist yet,
   * since picking tabs before typing the first message is the ordinary way to
   * start one.
   */
  const tabsBySession = ref(new Map<string | null, TabRef[]>())
  const chat = useChatStore()

  /** Tabs attached to the conversation on screen. */
  const tabs = computed<TabRef[]>(() => tabsBySession.value.get(chat.currentSessionId) ?? [])

  function setTabs(next: TabRef[]): void {
    const map = new Map(tabsBySession.value)
    if (next.length) map.set(chat.currentSessionId, next)
    else map.delete(chat.currentSessionId)
    tabsBySession.value = map
  }

  /** Attach a tab, or replace what is known about one already attached (the
   *  title and URL move as the user browses). */
  function attachTab(tab: TabRef): void {
    setTabs([...tabs.value.filter((t) => t.tabId !== tab.tabId), tab])
  }

  function detachTab(tabId: number): void {
    setTabs(tabs.value.filter((t) => t.tabId !== tabId))
  }

  /** Drop every staged tab — what sending does, alongside `clear()`. */
  function clearTabs(): void {
    if (tabs.value.length) setTabs([])
  }

  // Staged context belongs to the KB it was selected in — drop it on KB switch.
  const kb = useKbStore()
  watch(() => kb.name, () => {
    clear()
    tabsBySession.value = new Map()
  })

  watch(
    () => chat.currentSessionId,
    (id, was) => {
      // …and a reply quote additionally belongs to one conversation.
      dropForeignReplyQuotes(id)
      // Sending the first message is what creates the session, so tabs picked
      // against "no conversation yet" belong to the one that just began —
      // otherwise the feature would break in the exact case it is designed for.
      if (was !== null || id === null) return
      const staged = tabsBySession.value.get(null)
      if (!staged?.length) return
      const map = new Map(tabsBySession.value)
      map.delete(null)
      map.set(id, staged)
      tabsBySession.value = map
    },
  )

  return {
    refs,
    syncLive,
    clearTransient,
    togglePin,
    remove,
    clear,
    tabs,
    attachTab,
    detachTab,
    clearTabs,
  }
})
