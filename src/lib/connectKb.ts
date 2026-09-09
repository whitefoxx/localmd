/**
 * Telling the browser which knowledge base is open, and taking its answer when
 * the user picks another in the extension's popup.
 *
 * The popup's buttons all write into a folder, and until now it could not name
 * which one — a capture that went somewhere other than the user pictured is a
 * mistake only discovered later. So this mirrors the recents list and the open
 * folder into the extension (`sync_kb_folders`).
 *
 * Switching runs the other way and CANNOT be done by the extension: a File
 * System Access directory handle belongs to the page it was granted to, so the
 * popup sends `notifications/localmd/open-kb {name}` and this side decides. If
 * the grant has lapsed Chrome needs a user gesture to renew it, which no
 * notification can supply — the extension focuses this tab for exactly that
 * reason, and the failure surfaces as the store's own error rather than as
 * silence.
 */
import { useKbStore } from '@/stores/kb'

export const SYNC_KB_TOOL = 'generic__sync_kb_folders'
export const OPEN_KB_NOTIFICATION = 'notifications/localmd/open-kb'

export interface KbSyncDeps {
  serverId: string
  call(tool: string, args: Record<string, unknown>): Promise<string>
}

/** What the browser should believe right now: the recents list, and which of
 *  them is open. Pure, so the watcher can compare it without calling out. */
export function kbSnapshot(recents: Array<{ name: string }>, current: string): {
  folders: string[]
  current: string
} {
  const folders = recents.map((r) => r.name).filter(Boolean)
  // The open folder is always offered, even if the recents list has not caught
  // up with it yet (a folder opened this session, before its row was saved).
  if (current && !folders.includes(current)) folders.unshift(current)
  return { folders, current }
}

export async function syncKbFolders(deps: KbSyncDeps): Promise<void> {
  const kb = useKbStore()
  const snap = kbSnapshot(kb.recents, kb.name ?? '')
  await deps.call(SYNC_KB_TOOL, {
    folders: JSON.stringify(snap.folders),
    current: snap.current,
  })
}

/**
 * The popup asked for another folder.
 *
 * Returns what happened, so the caller can log it; the user sees the result in
 * the app itself, which is where they now are. A name that is not in the
 * recents list is not an error worth shouting about — it means the two sides
 * disagree, and the sync that follows this will settle it.
 */
export async function openKbByName(name: string): Promise<'opened' | 'already' | 'unknown' | 'failed'> {
  const kb = useKbStore()
  if (!name) return 'unknown'
  if (kb.name === name) return 'already'
  const entry = kb.recents.find((r) => r.name === name)
  if (!entry) return 'unknown'
  return (await kb.openRecent(entry)) ? 'opened' : 'failed'
}
