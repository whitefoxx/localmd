/**
 * A promises-style fs client for isomorphic-git backed by the KB's
 * FileSystemDirectoryHandle. isomorphic-git calls us with '/'-rooted paths
 * (we pass dir: '/'); we resolve them segment-by-segment against the root
 * handle, with a directory-handle cache to keep .git/objects traffic cheap.
 *
 * Stat caveat: File System Access exposes only size + lastModified. ino/uid/
 * gid/ctime are faked as 0, which makes every index entry written by real git
 * look stale ONCE — isomorphic-git then re-hashes the file and (oid unchanged)
 * rewrites the index entry with our stats, so subsequent status calls are
 * cache hits. Interop with CLI git is symmetric: it re-freshes the entries
 * back. This is the documented racy-git behavior, not corruption.
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
}

async function unlink(path: string): Promise<void> {
  try {
    const [parent, name] = await getParentAndName(path)
    await parent.removeEntry(name)
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
