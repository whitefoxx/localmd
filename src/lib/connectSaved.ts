/**
 * Keeping the browser's idea of "this page is already in your knowledge base"
 * honest.
 *
 * localmd Connect learns that a page became a note when this app acks a clip
 * and names the file it wrote. After that the extension is blind: it cannot see
 * the folder, so a note deleted or renamed here leaves an entry claiming the
 * page is saved, and its popup says so — with a green tick and a path that is
 * not there any more (findings F-61).
 *
 * A cache of someone else's state is kept honest by REVALIDATION, not by hoping
 * every mutation site remembers to send a message. So: read the whole index,
 * check each path against the real folder, and tell the extension what changed.
 * Cheap in the ordinary case — one tool call and a handful of `exists` — and it
 * only walks the note index when something is actually missing.
 *
 * A missing path is not necessarily a deletion: the agent reorganizes the KB
 * with the user's consent, and a moved note should stay saved. So a note whose
 * frontmatter `url:` matches the entry is re-pointed rather than forgotten.
 */
import * as fs from '@/lib/fs'
import { extractField } from '@/lib/wiki'
import { useKbStore } from '@/stores/kb'
import { useKbIndexStore } from '@/stores/kbIndex'

export const LIST_SAVED_TOOL = 'generic__list_saved_pages'
export const SYNC_SAVED_TOOL = 'generic__sync_saved_pages'

export interface SavedPage {
  url: string
  path: string
  title?: string
  at?: number
}

export interface ReconcileDeps {
  serverId: string
  call(tool: string, args: Record<string, unknown>): Promise<string>
}

export interface ReconcileResult {
  checked: number
  forgotten: string[]
  moved: Array<{ url: string; path: string }>
}

const EMPTY: ReconcileResult = { checked: 0, forgotten: [], moved: [] }

/** Rows out of a `list_saved_pages` reply. Text that is not JSON is a failure,
 *  not an empty index — reading it as empty would report "nothing to fix" for
 *  a transport that never answered (the mistake F-59 was made of). */
export function parseSavedPages(out: string): SavedPage[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(out)
  } catch {
    throw new Error(`list_saved_pages returned something that is not JSON: ${out.slice(0, 80)}…`)
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? ((parsed as { pages?: unknown }).pages ?? [])
      : []
  if (!Array.isArray(list)) return []
  return list
    .map((v) => v as Record<string, unknown>)
    .filter((o) => o && typeof o.url === 'string' && typeof o.path === 'string')
    .map((o) => ({
      url: String(o.url),
      path: String(o.path),
      ...(typeof o.title === 'string' ? { title: o.title } : {}),
      ...(typeof o.at === 'number' ? { at: o.at } : {}),
    }))
}

/** The form two URLs are compared in: the fragment is not part of which page
 *  this is, and the extension keys its index the same way. Pure. */
export function urlKey(url: string): string {
  const trimmed = url.trim()
  try {
    const u = new URL(trimmed)
    u.hash = ''
    return u.href
  } catch {
    return trimmed
  }
}

/** Every note that declares where it was clipped from: url → its path. Pure. */
export function urlIndexOf(pages: Iterable<[string, { content: string }]>): Map<string, string> {
  const out = new Map<string, string>()
  for (const [path, page] of pages) {
    const declared = extractField(page.content, 'url')?.[0]
    if (!declared) continue
    const key = urlKey(declared)
    // First writer wins: two notes of one page is a copy, and re-pointing to
    // whichever the iteration happened to reach last would be a coin toss.
    if (!out.has(key)) out.set(key, path)
  }
  return out
}

const running = new Set<string>()

/**
 * Check the browser's index against the folder and correct it.
 *
 * Returns what changed, so a caller can log it; failures are the caller's to
 * swallow — a reconcile that cannot reach the extension changes nothing, which
 * is the right outcome for a cache.
 */
export async function reconcileSavedPages(deps: ReconcileDeps): Promise<ReconcileResult> {
  if (running.has(deps.serverId)) return EMPTY
  // Without a folder open there is nothing to check against, and "no folder"
  // must never read as "none of these notes exist".
  if (!useKbStore().name) return EMPTY
  running.add(deps.serverId)
  try {
    const rows = parseSavedPages(await deps.call(LIST_SAVED_TOOL, {}))
    if (!rows.length) return EMPTY

    const missing: SavedPage[] = []
    for (const row of rows) {
      if (!(await fs.exists(row.path))) missing.push(row)
    }
    if (!missing.length) return { checked: rows.length, forgotten: [], moved: [] }

    // Only now is the note index worth walking.
    const byUrl = urlIndexOf(useKbIndexStore().pages)
    const forgotten: string[] = []
    const moved: Array<{ url: string; path: string }> = []
    for (const row of missing) {
      const candidate = byUrl.get(urlKey(row.url))
      // The index can lag the disk, so a candidate is only a move if it is
      // really there — otherwise this would swap one dead path for another.
      if (candidate && candidate !== row.path && (await fs.exists(candidate))) {
        moved.push({ url: row.url, path: candidate })
      } else {
        forgotten.push(row.url)
      }
    }
    if (forgotten.length || moved.length) {
      await deps.call(SYNC_SAVED_TOOL, {
        ...(forgotten.length ? { forget: JSON.stringify(forgotten) } : {}),
        ...(moved.length ? { moved: JSON.stringify(moved) } : {}),
      })
    }
    return { checked: rows.length, forgotten, moved }
  } finally {
    running.delete(deps.serverId)
  }
}

/**
 * Reconcile every connected extension, without the caller having to know how
 * to reach one.
 *
 * The store is imported lazily because this is called from the file store —
 * deleting a note is exactly when the browser's answer goes stale — and a
 * static import there would close the cycle files → mcp → connectInbox →
 * fileOps → files.
 */
export async function reconcileSavedPagesEverywhere(): Promise<void> {
  const { useMcpStore } = await import('@/stores/mcp')
  await useMcpStore().reconcileConnectSavedPages()
}
