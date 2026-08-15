/**
 * The open browser tabs a user can point the agent at, via localmd Connect.
 *
 * The agent can already list tabs itself — this exists because *which* tab is
 * the user's answer to give, not the agent's to guess: "this one, and that
 * one" is a glance for them and a search for it. Attaching a tab hands over an
 * address, never a copy: the page's contents stay where they are until the
 * agent reads them with the browser tools, so a conversation about eight open
 * tabs costs eight lines rather than eight pages, and what arrives is current
 * at the moment it is read rather than at the moment it was picked.
 */

/** The Connect tool that answers with the open tabs. */
export const LIST_TABS_TOOL = 'generic__list_tabs'

export interface BrowserTab {
  /** Chrome's tab id — the `tab_id` argument every page tool takes. */
  tabId: number
  title: string
  url: string
}

/** An attached tab, plus the Connect server whose browser it belongs to. */
export interface TabRef extends BrowserTab {
  serverId: string
}

function rowToTab(row: unknown): BrowserTab | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  // tabId is the extension's spelling; tab_id and id are what a different
  // build (or a different extension speaking the same protocol) might say.
  const id = r.tabId ?? r.tab_id ?? r.id
  if (typeof id !== 'number' || !Number.isFinite(id)) return null
  const url = typeof r.url === 'string' ? r.url : ''
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : url
  if (!title) return null
  return { tabId: id, title, url }
}

/**
 * Tabs out of a `list_tabs` result, whatever JSON shape it chose: the
 * documented `{ count, tabs, groups }`, a bare array, or rows under some other
 * single key. Anything that is not JSON — an error line, prose from a bridge
 * that failed — yields nothing, and the caller shows that as "no tabs" rather
 * than guessing.
 */
export function parseTabs(out: string): BrowserTab[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(out)
  } catch {
    return []
  }
  let rows: unknown = parsed
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    rows = Array.isArray(obj.tabs) ? obj.tabs : Object.values(obj).find(Array.isArray)
  }
  if (!Array.isArray(rows)) return []
  const seen = new Set<number>()
  const tabs: BrowserTab[] = []
  for (const row of rows) {
    const tab = rowToTab(row)
    if (!tab || seen.has(tab.tabId)) continue
    seen.add(tab.tabId)
    tabs.push(tab)
  }
  return tabs
}

/**
 * Drop the tab this app is running in. Pointing the agent at the page you are
 * typing on is never the question — the app is already the thing reading your
 * KB — and it is the one tab guaranteed to be in every list.
 *
 * Matched by address, which is exact for the case that matters and slightly
 * blunt for one that barely happens: two tabs on the SAME localmd address
 * would both drop out. A second localmd on a different address (the hosted app
 * next to a local build) stays listed, which is the pairing people actually
 * have.
 */
export function excludeSelf<T extends BrowserTab>(tabs: T[], selfUrl: string): T[] {
  const strip = (u: string): string => u.split('#')[0]
  const self = strip(selfUrl)
  return tabs.filter((t) => strip(t.url) !== self)
}

/** Rank tabs against what the user has typed after `@`, title first then URL. */
export function filterTabs<T extends BrowserTab>(tabs: T[], query: string, limit = 6): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return tabs.slice(0, limit)
  const scored: { tab: T; score: number }[] = []
  for (const tab of tabs) {
    const title = tab.title.toLowerCase()
    const url = tab.url.toLowerCase()
    const score = title.startsWith(q) ? 3 : title.includes(q) ? 2 : url.includes(q) ? 1 : 0
    if (score) scored.push({ tab, score })
  }
  scored.sort((a, b) => b.score - a.score || a.tab.title.length - b.tab.title.length)
  return scored.slice(0, limit).map((s) => s.tab)
}

/**
 * How attached tabs reach the model: an address list, not a transcript. It
 * repeats on every message of the conversation because the list is the user's
 * live answer to "which pages are we talking about" — they add and drop tabs
 * mid-conversation, and a block sent once would go stale silently.
 *
 * It has to say who it is FOR, not just what it holds. Picking a tab leaves no
 * token in the message the way `@path` does — the text stays a bare "summarize
 * this" — so the model arrives at those words with two candidate targets, the
 * tab and whatever file is open in the editor, and the ambient "currently
 * viewing" note is the more assertive of the two. Naming that conflict here is
 * the fix: an explicit pick outranks what happens to be on screen, and the
 * block that knows a pick was made is the one place that can say so.
 */
export function describeTabs(tabs: BrowserTab[]): string {
  if (!tabs.length) return ''
  const rows = tabs.map((t) => `- tab_id ${t.tabId} · ${t.title}${t.url ? ` · ${t.url}` : ''}`)
  return (
    '<browser_tabs>\n' +
    'The user PICKED these open browser tabs and attached them to this message — a ' +
    'deliberate choice of what to talk about, not ambient context. A message that ' +
    'points at something without naming it ("this", "the page", "summarize it", or no ' +
    'target at all) means these tabs: NOT the file open in the editor, not anything ' +
    'else on screen. Only a message that names some other target outranks them.\n' +
    'Their contents are NOT included — read what you need with the browser tools, ' +
    'passing the tab_id shown here (get_page_text, find_in_page, …; enable_tools ' +
    'first), before answering anything that depends on what the page says.\n' +
    'Read the TAB, not the URL. Fetching the address again gets a signed-out, ' +
    'freshly-loaded page — a different page from the one the user is looking at, ' +
    'whenever a login, a search they typed, or anything else the tab is holding ' +
    'matters. A tab may since have been closed or navigated; the tool will say so.\n' +
    `${rows.join('\n')}\n` +
    '</browser_tabs>'
  )
}
