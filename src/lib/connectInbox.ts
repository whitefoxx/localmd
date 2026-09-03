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
import { importFile, ensureFilename } from '@/lib/capture'

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
  }
}

/**
 * Items out of a `list_inbox` result, whatever JSON shape it chose. Anything
 * that is not JSON — an error line, prose from a transport that failed — yields
 * nothing, which the caller treats as "an empty inbox" rather than guessing.
 */
export function parseInbox(out: string): InboxItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(out)
  } catch {
    return []
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? ((parsed as { items?: unknown }).items ?? [])
      : []
  if (!Array.isArray(list)) return []
  return list.map(row).filter((r): r is InboxItem => r !== null)
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

export async function drainInbox(deps: DrainDeps): Promise<DrainResult> {
  const empty: DrainResult = { written: [], asks: 0, acked: 0, left: 0 }
  if (running.has(deps.serverId)) return empty
  // No folder open: a clip has nowhere to go, and acking it would lose it.
  if (!useKbStore().name) return empty
  running.add(deps.serverId)
  try {
    const items = parseInbox(await deps.call(LIST_INBOX_TOOL, { limit: BATCH }))
    if (!items.length) return empty

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
          const name = ensureFilename(`${stem || 'screenshot'}.png`, 'image/png', Date.now())
          written.push(await importFile(new File([shot], name, { type: 'image/png' })))
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
    // An ask becomes a DRAFT in the chat box, not just an attached tab.
    //
    // Attaching the tab alone was the first design and it delivered nothing the
    // user could see: tabs are staged per SESSION, so a chip lands in whichever
    // chat happened to be open when the drain ran and is invisible in the next
    // one — and someone arriving from the browser usually starts a new chat. A
    // draft is session-independent, visible and editable, which is also the
    // house pattern (a document's "Write a note" drafts a request rather than
    // sending one). The tab is still attached when there is one: reading the
    // live page beats reading its address.
    if (asked.length) useUiStore().pendingPrompt = askDraft(asked)

    // The receipt: one clip opens where it landed. Several would be a fight
    // over the editor, so a batch says nothing and leaves them in the tree.
    if (written.length === 1) await openInEditor(written[0])
    return { written, asks, acked: done.length, left }
  } finally {
    running.delete(deps.serverId)
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
    const selection = (item.payload as { selection?: unknown } | null)?.selection
    const quote =
      typeof selection === 'string' && selection.trim()
        ? '\n\n' +
          selection
            .trim()
            .split(/\r?\n/)
            .map((l) => `> ${l}`)
            .join('\n')
        : ''
    return `About this page: ${head}${quote}`
  })
  return parts.join('\n\n') + '\n\n'
}

/** Test seam: forget the retry counters. */
export function __resetInboxAttempts(): void {
  attempts.clear()
  running.clear()
}
