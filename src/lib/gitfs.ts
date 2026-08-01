/**
 * A promises-style fs client for isomorphic-git backed by the KB's
 * FileSystemDirectoryHandle. isomorphic-git calls us with '/'-rooted paths
 * (we pass dir: '/'); we resolve them segment-by-segment against the root
 * handle, with a directory-handle cache to keep .git/objects traffic cheap.
 *
 * Stat caveat: File System Access exposes only size + lastModified. ino/uid/
 * gid/ctime are faked as 0, which makes every index entry written by real git
 * look stale ONCE — isomorphic-git then re-hashes the file and (oid unchanged)
 * rewrites the index entry with our stats. That per-entry refresh is the
 * documented racy-git behavior and is harmless BY ITSELF — but isomorphic-git
 * persists it by rewriting the WHOLE index file from its in-memory copy, with
 * no .git/index.lock (the file lock in GitIndexManager is commented out
 * upstream). If CLI git commits between our read and that write-back, the
 * write-back reverts the index to the pre-commit generation: git status then
 * shows the last commit's changes inverted, and the next `git commit` silently
 * undoes it. Hence the write guard below: refuse the write-back whenever
 * .git/index on disk no longer matches what this adapter last read/wrote, and
 * tell git.ts to drop its cached in-memory index instead. The guard compares
 * size + mtimeMs; a same-millisecond same-size external write still slips
 * through, but that window is stat-vs-write, not the whole workdir scan.
 */
import * as fs from '@/lib/fs'

interface StatLike {
  type: 'file' | 'dir'
  mode: number
  size: number
  ino: number
  mtimeMs: number
  ctimeMs: number
  uid: number
  gid: number
  dev: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

function err(code: string, path: string): Error & { code: string } {
  const e = new Error(`${code}: ${path}`) as Error & { code: string }
  e.code = code
  return e
}

function mapDomError(e: unknown, path: string): Error {
  const name = (e as DOMException)?.name
  if (name === 'NotFoundError') return err('ENOENT', path)
  if (name === 'TypeMismatchError') return err('ENOTDIR', path)
  if (name === 'InvalidModificationError') return err('ENOTEMPTY', path)
  return e as Error
}

function segments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0 && s !== '.')
}

/** dir-handle cache: 'a/b' → handle. Cleared on deletions and KB switch. */
let dirCache = new Map<string, FileSystemDirectoryHandle>()
let cachedRoot: FileSystemDirectoryHandle | null = null

/* ── .git/index write-back guard (see header) ────────────────────────────── */

/** On-disk state of .git/index as of this adapter's last read/write of it.
 *  null = never seen (fresh repo or KB just opened). */
let indexDiskState: { size: number; mtimeMs: number } | null = null
let indexConflictHandler: (() => void) | null = null

/** Single-consumer hook (git.ts): called when an index write-back is refused
 *  because .git/index changed on disk since this adapter last read it — the
 *  in-memory index is a stale generation and must be dropped, not persisted. */
export function onIndexWriteConflict(handler: () => void): void {
  indexConflictHandler = handler
}

function isIndexPath(path: string): boolean {
  const segs = segments(path)
  return segs.length === 2 && segs[0] === '.git' && segs[1] === 'index'
}

/** Drop cached directory handles. Must be called after directories are moved
 *  or deleted OUTSIDE gitFs (app-side fs.renameDir/removeDir) — a cached
 *  handle to a removed directory throws on use and corrupts status results. */
export function invalidateGitFsCache(): void {
  dirCache = new Map()
}

function root(): FileSystemDirectoryHandle {
  const r = fs.getRoot()
  if (r !== cachedRoot) {
    cachedRoot = r
    dirCache = new Map()
    indexDiskState = null // different repo, forget the old index generation
  }
  return r
}

async function getDir(path: string, create = false): Promise<FileSystemDirectoryHandle> {
  const segs = segments(path)
  const key = segs.join('/')
  if (!create) {
    const hit = dirCache.get(key)
    if (hit) return hit
  }
  let handle = root()
  let sofar = ''
  for (const seg of segs) {
    sofar = sofar ? `${sofar}/${seg}` : seg
    const hit = !create && dirCache.get(sofar)
    if (hit) {
      handle = hit
      continue
    }
    try {
      handle = await handle.getDirectoryHandle(seg, { create })
    } catch (e) {
      throw mapDomError(e, path)
    }
    dirCache.set(sofar, handle)
  }
  return handle
}

async function getParentAndName(
  path: string,
  createParents = false,
): Promise<[FileSystemDirectoryHandle, string]> {
  const segs = segments(path)
  const name = segs.pop()
  if (!name) throw err('EINVAL', path)
  const parent = segs.length ? await getDir(segs.join('/'), createParents) : root()
  return [parent, name]
}

async function readFile(
  path: string,
  options?: { encoding?: string } | string,
): Promise<Uint8Array | string> {
  const encoding = typeof options === 'string' ? options : options?.encoding
  try {
    const [parent, name] = await getParentAndName(path)
    const file = await (await parent.getFileHandle(name)).getFile()
    if (isIndexPath(path)) indexDiskState = { size: file.size, mtimeMs: file.lastModified }
    if (encoding === 'utf8') return await file.text()
    return new Uint8Array(await file.arrayBuffer())
  } catch (e) {
    throw mapDomError(e, path)
  }
}

async function writeFile(
  path: string,
  data: Uint8Array | string,
  _options?: unknown,
): Promise<void> {
  if (isIndexPath(path) && indexDiskState) {
    // Write-back guard: isomorphic-git rewrites the WHOLE index from memory.
    // If the file moved on disk since we read it (CLI git committed), that
    // memory copy is a stale generation — persisting it would revert the
    // external commit's index. Refuse, and have git.ts drop the cached index.
    const cur = await stat(path).catch(() => null)
    if (cur && (cur.size !== indexDiskState.size || cur.mtimeMs !== indexDiskState.mtimeMs)) {
      console.warn(
        'gitfs: .git/index changed on disk since it was read (external git?) — ' +
          'skipping the write-back and dropping the in-memory index',
      )
      indexConflictHandler?.()
      return
    }
  }
  try {
    const [parent, name] = await getParentAndName(path, true)
    const handle = await parent.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    // TS lib DOM typing quirk: write() accepts BufferSource | Blob | string.
    await writable.write(typeof data === 'string' ? data : new Blob([data as Uint8Array<ArrayBuffer>]))
    await writable.close()
  } catch (e) {
    throw mapDomError(e, path)
  }
  if (isIndexPath(path)) {
    const now = await stat(path).catch(() => null)
    indexDiskState = now ? { size: now.size, mtimeMs: now.mtimeMs } : null
  }
}

async function unlink(path: string): Promise<void> {
  try {
    const [parent, name] = await getParentAndName(path)
    await parent.removeEntry(name)
    if (isIndexPath(path)) indexDiskState = null
  } catch (e) {
    throw mapDomError(e, path)
  }
}

async function readdir(path: string): Promise<string[]> {
  try {
    const dir = await getDir(path)
    const names: string[] = []
    for await (const name of dir.keys()) names.push(name)
    return names
  } catch (e) {
    throw mapDomError(e, path)
  }
}

async function mkdir(path: string): Promise<void> {
  await getDir(path, true)
}

async function rmdir(path: string): Promise<void> {
  try {
    const [parent, name] = await getParentAndName(path)
    await parent.removeEntry(name) // non-recursive: throws if not empty
  } catch (e) {
    throw mapDomError(e, path)
  } finally {
    dirCache = new Map() // drop any handles under the removed dir
  }
}

async function stat(path: string): Promise<StatLike> {
  const segs = segments(path)
  if (segs.length === 0) return makeStat('dir', 0, 0)
  const [parent, name] = await getParentAndName(path)
  try {
    const file = await (await parent.getFileHandle(name)).getFile()
    return makeStat('file', file.size, file.lastModified)
  } catch (e) {
    const mapped = mapDomError(e, path)
    if ((mapped as Error & { code?: string }).code !== 'ENOTDIR' && (e as DOMException)?.name !== 'TypeMismatchError') {
      if ((mapped as Error & { code?: string }).code === 'ENOENT') {
        // Could still be a directory of the same name.
      } else {
        throw mapped
      }
    }
  }
  try {
    await parent.getDirectoryHandle(name)
    return makeStat('dir', 0, 0)
  } catch (e) {
    throw mapDomError(e, path)
  }
}

function makeStat(type: 'file' | 'dir', size: number, mtimeMs: number): StatLike {
  return {
    type,
    mode: type === 'dir' ? 0o40000 : 0o100644,
    size,
    ino: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    uid: 0,
    gid: 0,
    dev: 1,
    isFile: () => type === 'file',
    isDirectory: () => type === 'dir',
    isSymbolicLink: () => false,
  }
}

async function readlink(path: string): Promise<never> {
  throw err('ENOENT', path) // no symlinks over File System Access
}

async function symlink(_target: string, path: string): Promise<never> {
  throw err('EPERM', path)
}

/** The fs client object isomorphic-git consumes. */
export const gitFs = {
  promises: {
    readFile,
    writeFile,
    unlink,
    readdir,
    mkdir,
    rmdir,
    stat,
    lstat: stat,
    readlink,
    symlink,
  },
}
