/**
 * Draining what the user captured in their BROWSER.
 *
 * Every other Connect path is this app pulling: the agent decides it needs a
 * page and calls a tool. A clip starts on the other side — someone is reading
 * something, presses "Clip page to localmd", and this app may not even be
 * open. The extension parks those gestures in a queue of its own and pokes us
 * with `notifications/localmd/inbox`; we call `list_inbox`, act on each item,
 * and `ack_inbox` the ones we finished.
 *
 * The poke is a hint, never the delivery. A tab can miss it — mid-reload, or
 * not yet open when the clip was made — so the queue is the truth and this
 * runs on connect as well (the extension re-announces a non-empty inbox to a
 * page that has just handshaken). Which is also why acking is the only way an
 * item leaves: a clip the user made must survive us being closed, reloaded, or
 * pointed at a different folder.
 *
 * **Nothing is drained without a knowledge base open.** A clip has nowhere to
 * go otherwise, and acking it would destroy it. It waits.
 */
import { useKbStore } from '@/stores/kb'
import { useComposerStore } from '@/stores/composer'
import { useUiStore } from '@/stores/ui'
import { openInEditor } from '@/lib/openInEditor'
import { parseClip, writeClip, dataUrlToBlob } from '@/lib/clip'
import { importFile, ensureFilename, extForMime } from '@/lib/capture'
import { syncAfterFsChange } from '@/lib/fileOps'

export const LIST_INBOX_TOOL = 'generic__list_inbox'
export const ACK_INBOX_TOOL = 'generic__ack_inbox'

/** The extension's server→client poke. Carries `{count}`; carries no id, so it
 *  must never be replied to. */
export const INBOX_NOTIFICATION = 'notifications/localmd/inbox'

/** How many items one drain handles. The rest stay queued and arrive on the
 *  next poke — a hundred clips must not become one unbounded write burst. */
const BATCH = 10

/** Give up on an item after this many failed attempts and ack it, so one
 *  malformed capture cannot make every future drain fail at the same place. */
const MAX_ATTEMPTS = 3

export type InboxKind = 'clip' | 'ask' | 'highlight' | 'screenshot'

export interface InboxItem {
  id: string
  kind: InboxKind
  createdAt: number
  url: string
  title: string
  /** The browser tab it was captured from, when that tab is still open. */
  tabId?: number
  payload: unknown
  /** The extension could not deliver this item even on its own — it is
   *  larger than one relay frame — and sent its metadata without the payload.
   *  Nothing can be written from it; acking it is what lets the queue move. */
  oversized?: true
  /** Its size, when `oversized`. */
  bytes?: number
}

function row(value: unknown): InboxItem | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.kind !== 'string') return null
  return {
    id: o.id,
    kind: o.kind as InboxKind,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
    url: typeof o.url === 'string' ? o.url : '',
    title: typeof o.title === 'string' ? o.title : '',
    ...(typeof o.tabId === 'number' ? { tabId: o.tabId } : {}),
    payload: o.payload,
    ...(o.oversized === true ? { oversized: true as const } : {}),
    ...(typeof o.bytes === 'number' ? { bytes: o.bytes } : {}),
  }
}

/**
 * Items out of a `list_inbox` result, whatever JSON shape it chose.
 *
 * Text that is not JSON is an ERROR, not an empty inbox. It used to yield
 * nothing, "rather than guessing" — and the guess that replaced it was worse:
 * the extension truncates a reply that exceeds its frame ceiling, the tail of a
 * JSON document went missing, this returned [], and the drain concluded there
 * was nothing to do while eight captures sat in the queue. Throwing leaves them
 * queued too, but as a failure someone can see, not a success that did nothing.
 */
export function parseInbox(out: string): InboxItem[] {
  return parseInboxReply(out).items
}

export interface InboxReply {
  items: InboxItem[]
  /** How many items the extension holds in total — the reply is one batch of
   *  them, bounded by bytes, so this is what says whether to ask again. */
  pending: number
}

export function parseInboxReply(out: string): InboxReply {
  let parsed: unknown
  try {
    parsed = JSON.parse(out)
  } catch {
    throw new Error(
      `list_inbox returned something that is not JSON (${out.length} chars): ${out.slice(0, 80)}…`,
    )
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? ((parsed as { items?: unknown }).items ?? [])
      : []
  const items = Array.isArray(list) ? list.map(row).filter((r): r is InboxItem => r !== null) : []
  const declared =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as { pending?: unknown }).pending
      : undefined
  return { items, pending: typeof declared === 'number' ? declared : items.length }
}

export interface DrainDeps {
  /** Call a tool on the Connect server, exactly as the agent would. */
  call(tool: string, args: Record<string, unknown>): Promise<string>
  /** The server the items belong to — a tab reference is only meaningful with it. */
  serverId: string
}

export interface DrainResult {
  /** KB paths written, in the order they were written. */
  written: string[]
  /** Items handed to the composer as "ask about this page". */
  asks: number
  /** Items acked (handled, or given up on). */
  acked: number
  /** Left for a later drain: unhandled kinds, and failures still under the
   *  retry ceiling. */
  left: number
}

/** Attempts per item id, so a poison pill stops after MAX_ATTEMPTS. Module
 *  scope, and deliberately not persisted: a reload is a fresh chance, and the
 *  worst case is a few extra tries. */
const attempts = new Map<string, number>()

/** One drain at a time per server — a poke can arrive while the previous batch
 *  is still writing, and two drains would fight over the same ids. */
const running = new Set<string>()

/** Servers poked while their drain was running. The poke itself is dropped by
 *  the guard above; this is what makes the drain look once more before it
 *  ends, so a capture made mid-drain is not left waiting for the next one. */
const poked = new Set<string>()

/** Rounds one drain may run. The extension hands over one frame's worth per
 *  call and eight captures took four; a bound, not a target. */
const MAX_ROUNDS = 25

/**
 * The lock two TABS of this app contend for. Both are connected to the same
 * extension, both are poked, and without this both would list the same items,
 * write each of them twice into the same folder and ack them twice. Web Locks
 * are per origin, which is exactly the scope of "the same app". Where the API
 * is missing (tests, an old runtime) the drain simply runs.
 */
async function withInboxLock<T>(serverId: string, skipped: T, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks
  if (!locks) return fn()
  return (await locks.request(
    `localmd-connect-inbox:${serverId}`,
    { ifAvailable: true },
    async (lock) => (lock ? fn() : skipped),
  )) as T
}

/**
 * Pull everything the browser has queued, in as many rounds as it takes.
 *
 * One round is one `list_inbox` — a batch the extension bounds by BYTES — and
 * it used to be the whole drain. Eight captures arrived in four batches, and
 * only the first was pulled by the poke that announced them; the rest waited
 * for a coincidence (another capture, a tab switch). Now a round that made
 * progress while the extension still reports items pending is followed by
 * another, and a poke that arrived mid-drain earns one more look at the end.
 */
export async function drainInbox(deps: DrainDeps): Promise<DrainResult> {
  const empty: DrainResult = { written: [], asks: 0, acked: 0, left: 0 }
  if (running.has(deps.serverId)) {
    poked.add(deps.serverId)
    return empty
  }
  // No folder open: a clip has nowhere to go, and acking it would lose it.
  if (!useKbStore().name) return empty
  return withInboxLock(deps.serverId, empty, async () => {
    running.add(deps.serverId)
    const total: DrainResult = { written: [], asks: 0, acked: 0, left: 0 }
    const asked: InboxItem[] = []
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        poked.delete(deps.serverId)
        const r = await drainBatch(deps)
        total.written.push(...r.written)
        total.asks += r.asks
        total.acked += r.acked
        total.left = r.left
        asked.push(...r.asked)
        const more = r.acked > 0 && r.remaining > 0
        if (!more && !poked.has(deps.serverId)) break
      }
    } finally {
      running.delete(deps.serverId)
      poked.delete(deps.serverId)
    }

    // The receipts, once per drain rather than once per round.
    //
    // The tree does not watch the disk, so a file written behind its back is
    // invisible until something re-reads it — which is why a capture only
    // showed up after a manual reload.
    if (total.written.length) await syncAfterFsChange()

    // An ask becomes a DRAFT in the chat box, not just an attached tab.
    //
    // Attaching the tab alone was the first design and it delivered nothing the
    // user could see: tabs are staged per SESSION, so a chip lands in whichever
    // chat happened to be open when the drain ran and is invisible in the next
    // one — and someone arriving from the browser usually starts a new chat. A
    // draft is session-independent, visible and editable, which is also the
    // house pattern (a document's "Write a note" drafts a request rather than
    // sending one). The tab is still attached when there is one: reading the
    // live page beats reading its address. One draft for the whole drain: a
    // second round must not overwrite what the first one asked.
    if (asked.length) useUiStore().pendingPrompt = askDraft(asked)

    // One clip opens where it landed. Several would be a fight over the
    // editor, so a batch says nothing and leaves them in the tree.
    if (total.written.length === 1) await openInEditor(total.written[0])
    return total
  })
}

interface BatchResult extends DrainResult {
  /** The asks of this round, for the one draft written at the end. */
  asked: InboxItem[]
  /** Items the extension still holds after this round's acks. */
  remaining: number
}

/** One `list_inbox`, its writes, and one `ack_inbox`. */
async function drainBatch(deps: DrainDeps): Promise<BatchResult> {
  const none: BatchResult = { written: [], asks: 0, acked: 0, left: 0, asked: [], remaining: 0 }
  const reply = parseInboxReply(await deps.call(LIST_INBOX_TOOL, { limit: BATCH }))
  const items = reply.items
  if (!items.length) return none

  {
    const composer = useComposerStore()
    const done: string[] = []
    const written: string[] = []
    /** Which item became which file — handed back in the ack so the browser
     *  learns the page is now in the knowledge base. */
    const wrote: Array<{ id: string; path: string }> = []
    const asked: InboxItem[] = []
    let asks = 0
    let left = 0

    for (const item of items) {
      const tries = (attempts.get(item.id) ?? 0) + 1
      attempts.set(item.id, tries)
      try {
        if (item.oversized) {
          // Bigger than a relay frame: the extension sent the metadata only,
          // and no retry will bring the payload. Give it up so what is queued
          // behind it can arrive — and say so, since something the user
          // captured is being dropped.
          console.warn(
            `[connect] a ${item.kind} capture of ${item.url} (${Math.round((item.bytes ?? 0) / 1_048_576)}MB) is too large to transfer and was dropped`,
          )
          done.push(item.id)
          continue
        }
        if (item.kind === 'clip' && isPdfClip(item.payload)) {
          // A PDF the user had open: the file itself, filed the way a dropped
          // paper is (raw/papers/ in a raw-layout folder). localmd indexes it
          // from there; nothing here tries to read it.
          const pdf = item.payload
          const stem = (pdf.title || 'document')
            .replace(/\.pdf$/i, '')
            .replace(/[\\/:*?"<>|]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80)
          const blob = dataUrlToBlob(`data:application/pdf;base64,${pdf.data}`)
          if (!blob) {
            done.push(item.id) // undecodable bytes are permanent
            continue
          }
          const path = await importFile(
            new File([blob], `${stem || 'document'}.pdf`, { type: 'application/pdf' }),
          )
          written.push(path)
          wrote.push({ id: item.id, path })
          done.push(item.id)
        } else if (item.kind === 'clip') {
          const clip = parseClip(item.payload)
          // Unparseable is permanent — retrying it forever helps nobody.
          if (!clip) {
            console.warn(`[connect] a clip of ${item.url} was not a clip and was dropped`)
            done.push(item.id)
            continue
          }
          const path = await writeClip(clip)
          written.push(path)
          wrote.push({ id: item.id, path })
          done.push(item.id)
        } else if (item.kind === 'ask') {
          if (typeof item.tabId === 'number') {
            composer.attachTab({
              serverId: deps.serverId,
              tabId: item.tabId,
              title: item.title || item.url,
              url: item.url,
            })
          }
          asked.push(item)
          asks++
          done.push(item.id)
        } else if (item.kind === 'screenshot') {
          const shot = parseScreenshot(item.payload)
          if (!shot) {
            // Permanent: no retry will make these bytes an image. Said out
            // loud, because a capture is being dropped.
            console.warn(`[connect] a screenshot of ${item.url} could not be decoded and was dropped`)
            done.push(item.id)
            continue
          }
          // The same landing as a dropped or pasted picture: raw/images/ in a
          // raw-layout folder, inbox/ elsewhere. Named after the page it came
          // from, so a folder of them still means something.
          const stem = (item.title || 'screenshot')
            .replace(/[\\/:*?"<>|]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 60)
          // The codec is the extension's choice (a whole page arrives as
          // WebP, a region as PNG); the file is named for what it is.
          const mime = shot.type || 'image/png'
          const name = ensureFilename(
            `${stem || 'screenshot'}.${extForMime(mime)}`,
            mime,
            Date.now(),
          )
          written.push(await importFile(new File([shot], name, { type: mime })))
          done.push(item.id)
        } else {
          // A kind this build does not handle yet (highlight). Leave
          // it: a newer app version will know what to do with it, and acking
          // would throw away something the user captured.
          left++
        }
      } catch {
        if (tries >= MAX_ATTEMPTS) done.push(item.id)
        else left++
      }
    }

    if (done.length) {
      for (const id of done) attempts.delete(id)
      await deps.call(ACK_INBOX_TOOL, {
        ids: JSON.stringify(done),
        ...(wrote.length ? { written: JSON.stringify(wrote) } : {}),
      })
    }
    return {
      written,
      asks,
      acked: done.length,
      left,
      asked,
      remaining: Math.max(0, reply.pending - done.length),
    }
  }
}

/** A clip that is a PDF file rather than a page. Pure. */
export function isPdfClip(
  value: unknown,
): value is { kind: 'pdf'; title: string; url: string; data: string; size: number } {
  const v = value as { kind?: unknown; data?: unknown } | null
  return !!v && typeof v === 'object' && v.kind === 'pdf' && typeof v.data === 'string' && !!v.data
}

/** A region screenshot's bytes, or null when the payload is not one. Pure. */
export function parseScreenshot(value: unknown): Blob | null {
  if (!value || typeof value !== 'object') return null
  const dataUrl = (value as { dataUrl?: unknown }).dataUrl
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null
  return dataUrlToBlob(dataUrl)
}

/**
 * The draft an "Ask localmd" lands in the chat box. Names the page and quotes
 * the passage, then stops: the QUESTION is the user's to type, and a guess is
 * something they have to delete first.
 */
export function askDraft(items: InboxItem[]): string {
  const parts = items.map((item) => {
    const title = item.title && item.title !== item.url ? item.title : ''
    const head = title ? `${title} — ${item.url}` : item.url
    const p = (item.payload ?? {}) as { selection?: unknown; prompt?: unknown; answer?: unknown }
    const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
    const selection = text(p.selection)
    const quote = selection
      ? '\n\n' +
        selection
          .split(/\r?\n/)
          .map((l) => `> ${l}`)
          .join('\n')
      : ''
    // The extension's in-page prompts answer where the reader is; "Continue in
    // localmd" is the door out of that popover, and it carries what has already
    // been said so the conversation starts where they are rather than making
    // them re-explain what they just read. Absent on a plain "ask", and on
    // anything sent by an extension older than this field.
    const answer = text(p.answer)
    const ran = text(p.prompt)
    const already = answer
      ? `\n\n${ran ? `**${ran}** already answered:` : 'Already answered:'}\n\n${answer}`
      : ''
    return `About this page: ${head}${quote}${already}`
  })
  // A rule between what the browser brought and where the person types. The
  // draft can be several lines of quoted passage and an answer, and without a
  // divider the composer opens with the cursor somewhere in the middle of a
  // wall of text that is not theirs.
  return parts.join('\n\n') + '\n\n---\n\n'
}

/** Test seam: forget the retry counters. */
export function __resetInboxAttempts(): void {
  attempts.clear()
  running.clear()
}
