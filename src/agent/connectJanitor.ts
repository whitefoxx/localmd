/**
 * The janitor for browser tabs localmd Connect opened on the agent's behalf.
 *
 * The extension reaps the tabs its OWN agent opens, and treats a caller outside
 * the browser — us — as the owner of anything it opened for us: "TABS ARE
 * YOURS: nothing here reaps them", says the server's own instructions. Nobody
 * was standing on this side of that contract, so every `open_url` left a tab
 * behind in the "localmd Connect" group, for the rest of the browser session.
 *
 * The alternative is a rule the model has to remember on the last step of every
 * turn, which is exactly where a model forgets — the extension learned that
 * about its own agent and moved the job into its harness rather than its prompt.
 * So does this: when a turn ends is something the app knows for a fact, and the
 * model then has nothing to remember.
 *
 * Only what a call CREATED (`created_tab`) and opened in the BACKGROUND is
 * closed. A page the agent deliberately put in front of the user (`active:
 * true`) is theirs: from here there is no way to see which window has focus, so
 * "they are still reading it" is unknowable, and closing a page someone is
 * reading is a worse failure than one tab too many.
 *
 * Records are keyed by SESSION, not globally: sessions run in parallel (a
 * background turn keeps going in another tab), and a global list would let one
 * turn's end close the tabs another turn is mid-way through using. The mirror in
 * `sessionStorage` is what survives a page reload — same lifetime as the browser
 * tabs it describes, and reloading localmd mid-turn is a normal thing to do.
 * Deleting a session with tabs still recorded leaks them; the alternative was
 * teaching this module what a live session is, which is a bigger hole than the
 * one it plugs.
 */

/** The Connect tool that closes a browser tab, and its argument name. */
export const CLOSE_TAB_TOOL = 'generic__close_tab'

/** One browser tab a Connect call created, plus the server it belongs to. */
export interface OpenedTab {
  serverId: string
  tabId: number
}

const STORE_KEY = 'localmd:connectOpenedTabs'

type Store = Record<string, OpenedTab[]>

function restore(): Store {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Store = {}
    for (const [sessionId, rows] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(rows)) continue
      const tabs = rows.filter(
        (r): r is OpenedTab =>
          !!r &&
          typeof r === 'object' &&
          typeof (r as OpenedTab).serverId === 'string' &&
          typeof (r as OpenedTab).tabId === 'number',
      )
      if (tabs.length) out[sessionId] = tabs
    }
    return out
  } catch {
    // No sessionStorage (tests, private mode) or unreadable contents — the
    // janitor still works, it just forgets across a reload.
    return {}
  }
}

let opened: Store = restore()

function persist(): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(opened))
  } catch {
    /* nothing to mirror to — the in-memory record is still authoritative */
  }
}

/**
 * A browser tab this Connect result left behind, if any: the extension marks a
 * result that CREATED a durable tab with `created_tab`, whatever tool it came
 * from (`open_url`, `get_page_text {keep_open: true}`, …) — keying on that
 * rather than on tool names is what keeps a newly-tab-leaving tool from
 * silently leaking. A foreground open is a display page and is left alone.
 */
export function openedTabFromResult(out: string): number | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(out)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const r = parsed as Record<string, unknown>
  if (r.created_tab !== true || r.active === true) return null
  const id = r.tabId
  return typeof id === 'number' && Number.isFinite(id) ? id : null
}

/** Feed the janitor from a Connect tool result on its way back to the model.
 *  Call for every localmd Connect result; one that opened nothing is a no-op. */
export function noteOpenedTab(sessionId: string, serverId: string, out: string): void {
  const tabId = openedTabFromResult(out)
  if (tabId === null) return
  const rows = opened[sessionId] ?? []
  if (rows.some((r) => r.serverId === serverId && r.tabId === tabId)) return
  opened[sessionId] = [...rows, { serverId, tabId }]
  persist()
}

/**
 * Close the background tabs this session's turns opened. Call when a turn ends
 * — including one that errored or was stopped, which is when tabs are most
 * likely to have been left mid-task.
 *
 * The record is cleared AFTER each close, so a reload part-way through leaves
 * the rest to be collected by the next turn instead of orphaning them. A close
 * that fails is forgotten anyway: the overwhelmingly common reason is a tab the
 * user already closed, and retrying it forever would be its own leak.
 */
export async function reapOpenedTabs(
  sessionId: string,
  close: (serverId: string, tabId: number) => Promise<unknown>,
): Promise<number> {
  const rows = opened[sessionId]
  if (!rows?.length) return 0
  let closed = 0
  for (const row of rows) {
    try {
      await close(row.serverId, row.tabId)
      closed++
    } catch {
      /* already gone, or the extension is no longer connected */
    }
    // Tabs recorded by anything still in flight land in a fresh array, so
    // filtering (rather than assigning []) never drops them.
    opened[sessionId] = (opened[sessionId] ?? []).filter(
      (r) => !(r.serverId === row.serverId && r.tabId === row.tabId),
    )
  }
  if (!opened[sessionId]?.length) delete opened[sessionId]
  persist()
  return closed
}

/** Test-only: drop every record. */
export function __resetOpenedTabs(): void {
  opened = {}
  persist()
}
