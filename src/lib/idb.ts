/**
 * IndexedDB persistence for FileSystemDirectoryHandle objects, so a KB folder
 * can be reopened after a page reload without re-picking it. Handles are
 * structured-cloneable, which is the only way to persist them (localStorage
 * cannot hold them). Pattern borrowed from files.md.
 */

const DB_NAME = 'localmd'
const DB_VERSION = 2

/** Where this database lived before the rename. See lib/legacyStorage for why
 *  the old copy is left in place rather than deleted. */
const LEGACY_DB_NAME = 'browser-md'

export interface RecentKb {
  /** Folder name — also the store key. Same-name folders collide; acceptable for now. */
  name: string
  handle: FileSystemDirectoryHandle
  lastOpened: number
}

/** A persisted chat session. Histories are plain-JSON provider payloads. */
export interface StoredSession {
  id: string
  /** KB folder name the session belongs to. */
  kb: string
  title: string
  provider: string
  uiMessages: unknown[]
  anthropicHistory: unknown[]
  openaiHistory: unknown[]
  createdAt: number
  updatedAt: number
  /** Starred by the user. Optional so pre-favorite sessions load as unstarred. */
  favorite?: boolean
  /** Snapshot of the agent's update_plan checklist (see stores/chat). */
  plan?: unknown[]
}

/**
 * Copy the legacy database across, once, before the first open.
 *
 * This database holds the folder handles and every saved chat — the two things
 * a user would notice the loss of immediately, and neither of which can be
 * recreated by re-entering something. `indexedDB.open` on a name that has never
 * existed cheerfully creates an empty one, so without this the rename would
 * present as a wipe.
 *
 * Guarded on the NEW database not existing yet: once this browser has one, it
 * is the live copy, and re-running would overwrite current data with a
 * snapshot. The legacy database is left where it is.
 */
async function adoptLegacyDb(): Promise<void> {
  // Chromium-only API, and this is a Chromium-only app; absent under vitest,
  // where there is nothing to migrate anyway.
  const listed = await indexedDB.databases?.().catch(() => [])
  const names = (listed ?? []).map((d) => d.name)
  if (names.includes(DB_NAME) || !names.includes(LEGACY_DB_NAME)) return

  const legacy = await new Promise<IDBDatabase | null>((resolve) => {
    // Version 2 is the shape this code understands. Opening WITHOUT a version
    // takes whatever is there, which is what we want to read from.
    const req = indexedDB.open(LEGACY_DB_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
  if (!legacy) return

  try {
    const carried: Record<string, unknown[]> = {}
    for (const store of ['recents', 'sessions']) {
      if (!legacy.objectStoreNames.contains(store)) continue
      carried[store] = await new Promise<unknown[]>((resolve) => {
        const req = legacy.transaction(store, 'readonly').objectStore(store).getAll()
        req.onsuccess = () => resolve(req.result ?? [])
        req.onerror = () => resolve([])
      })
    }
    legacy.close()
    if (!Object.values(carried).some((rows) => rows.length)) return

    const fresh = await rawOpen()
    await new Promise<void>((resolve, reject) => {
      const names = Object.keys(carried).filter((n) => fresh.objectStoreNames.contains(n))
      if (!names.length) return resolve()
      const t = fresh.transaction(names, 'readwrite')
      for (const name of names) {
        const store = t.objectStore(name)
        for (const row of carried[name]) store.put(row)
      }
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
    fresh.close()
  } catch {
    // A failed carry-over must not stop the app: the data is still under the
    // old name, and a later build can try again.
    try {
      legacy.close()
    } catch {
      /* already closed */
    }
  }
}

let adopted: Promise<void> | null = null

function rawOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('recents')) {
        db.createObjectStore('recents', { keyPath: 'name' })
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Every read and write goes through here, so the carry-over cannot be
 *  raced by whichever caller happens to be first. */
function openDb(): Promise<IDBDatabase> {
  adopted ??= adoptLegacyDb().catch(() => {})
  return adopted.then(rawOpen)
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = run(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

export async function saveRecent(handle: FileSystemDirectoryHandle): Promise<void> {
  const entry: RecentKb = { name: handle.name, handle, lastOpened: Date.now() }
  await tx('recents', 'readwrite', (s) => s.put(entry))
}

export async function listRecents(): Promise<RecentKb[]> {
  const all = await tx<RecentKb[]>('recents', 'readonly', (s) => s.getAll() as IDBRequest<RecentKb[]>)
  return all.sort((a, b) => b.lastOpened - a.lastOpened)
}

export async function removeRecent(name: string): Promise<void> {
  await tx('recents', 'readwrite', (s) => s.delete(name))
}

export async function saveSession(session: StoredSession): Promise<void> {
  await tx('sessions', 'readwrite', (s) => s.put(session))
}

export async function getSession(id: string): Promise<StoredSession | null> {
  const r = await tx<StoredSession | undefined>('sessions', 'readonly', (s) => s.get(id))
  return r ?? null
}

export async function listSessions(kb: string): Promise<StoredSession[]> {
  const all = await tx<StoredSession[]>(
    'sessions',
    'readonly',
    (s) => s.getAll() as IDBRequest<StoredSession[]>,
  )
  return all.filter((s) => s.kb === kb).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteSession(id: string): Promise<void> {
  await tx('sessions', 'readwrite', (s) => s.delete(id))
}
