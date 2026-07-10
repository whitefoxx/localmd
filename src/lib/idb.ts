/**
 * IndexedDB persistence for FileSystemDirectoryHandle objects, so a KB folder
 * can be reopened after a page reload without re-picking it. Handles are
 * structured-cloneable, which is the only way to persist them (localStorage
 * cannot hold them). Pattern borrowed from files.md.
 */

const DB_NAME = 'browser-md'
const STORE = 'recents'
const DB_VERSION = 1

export interface RecentKb {
  /** Folder name — also the store key. Same-name folders collide; acceptable for now. */
  name: string
  handle: FileSystemDirectoryHandle
  lastOpened: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'name' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

export async function saveRecent(handle: FileSystemDirectoryHandle): Promise<void> {
  const entry: RecentKb = { name: handle.name, handle, lastOpened: Date.now() }
  await tx('readwrite', (s) => s.put(entry))
}

export async function listRecents(): Promise<RecentKb[]> {
  const all = await tx<RecentKb[]>('readonly', (s) => s.getAll() as IDBRequest<RecentKb[]>)
  return all.sort((a, b) => b.lastOpened - a.lastOpened)
}

export async function removeRecent(name: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(name))
}
