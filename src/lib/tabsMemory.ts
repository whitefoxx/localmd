/**
 * Per-KB persistence of the open editor tabs + active tab, so reopening a KB
 * restores the working set (dropping files that no longer exist). Stored in
 * localStorage, keyed by KB folder name — matching idb.ts (recents) and
 * viewMemory.ts (reading positions).
 */
const LS_KEY = 'browser-md:open-tabs:v1'

export interface KbTabs {
  tabs: string[]
  active: string | null
}
type Store = Record<string, KbTabs>

function readStore(): Store {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {}
  }
}

export function readTabs(kb: string): KbTabs | null {
  return readStore()[kb] ?? null
}

export function writeTabs(kb: string, value: KbTabs): void {
  const store = readStore()
  store[kb] = value
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store))
  } catch {
    /* quota exceeded or private mode — tab memory is best-effort */
  }
}
