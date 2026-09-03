/**
 * IndexedDB persistence for FileSystemDirectoryHandle objects, so a KB folder
 * can be reopened after a page reload without re-picking it. Handles are
 * structured-cloneable, which is the only way to persist them (localStorage
 * cannot hold them). Pattern borrowed from files.md.
 */

const DB_NAME = 'localmd'
const DB_VERSION = 2

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
  /** A generated title has landed (see stores/chat) — absent on sessions
   *  stored before the flag existed, which read as "not yet titled". */
  titled?: boolean
}

function openDb(): Promise<IDBDatabase> {
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
