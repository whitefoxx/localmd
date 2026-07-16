/**
 * File System Access API layer over the opened KB directory handle.
 *
 * All paths are KB-relative, '/'-separated, no leading slash (e.g.
 * "wiki/concepts/foo.md"). This replaces trace-app's main-process fs.ts:
 * the browser talks to the user's real folder directly — no server involved.
 *
 * Writes go through createWritable(), which the browser stages in a swap file
 * and commits atomically on close(), so interrupted writes never corrupt files.
 */

export interface TreeNode {
  name: string
  path: string
  kind: 'file' | 'dir'
  children?: TreeNode[]
}

/** Entries hidden from the tree and search. */
const IGNORED = new Set(['.git', '.trace', '.obsidian', 'node_modules', '.DS_Store'])

/** True for entries the UI tree hides. Beyond the dot-dirs above, this covers
 *  PDF/EPUB annotation sidecars (`*.annotations.json`): they're committed to git
 *  so highlights sync across machines, but they're noise in the file tree.
 *  Git status walks the real directory (not readTree), so they stay tracked. */
function isTreeHidden(name: string): boolean {
  return IGNORED.has(name) || name.endsWith('.annotations.json')
}

let root: FileSystemDirectoryHandle | null = null

export function setRoot(handle: FileSystemDirectoryHandle | null): void {
  root = handle
}

export function getRoot(): FileSystemDirectoryHandle {
  if (!root) throw new Error('No KB folder is open')
  return root
}

export function hasRoot(): boolean {
  return root !== null
}

/** True when the browser supports the File System Access API (Chrome/Edge). */
export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') return null
    throw err
  }
}

/**
 * Ensure we hold readwrite permission on a persisted handle. Returns false if
 * the user declined. Must be called from a user gesture when state is 'prompt'.
 */
export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' } as const
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}

export async function queryPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return handle.queryPermission({ mode: 'readwrite' })
}

function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean)
}

async function getDirHandle(path: string, create = false): Promise<FileSystemDirectoryHandle> {
  let dir = getRoot()
  for (const seg of splitPath(path)) {
    dir = await dir.getDirectoryHandle(seg, { create })
  }
  return dir
}

async function getFileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
  const segs = splitPath(path)
  const name = segs.pop()
  if (!name) throw new Error(`Invalid file path: ${path}`)
  let dir = getRoot()
  for (const seg of segs) {
    dir = await dir.getDirectoryHandle(seg, { create })
  }
  return dir.getFileHandle(name, { create })
}

export async function readFile(path: string): Promise<string> {
  const fh = await getFileHandle(path)
  const file = await fh.getFile()
  return file.text()
}

/** Like readFile but returns null when the file doesn't exist. */
export async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path)
  } catch (err) {
    if ((err as DOMException).name === 'NotFoundError') return null
    throw err
  }
}

export async function readBinary(path: string): Promise<ArrayBuffer> {
  const fh = await getFileHandle(path)
  const file = await fh.getFile()
  return file.arrayBuffer()
}

export async function statMtime(path: string): Promise<number | null> {
  try {
    const fh = await getFileHandle(path)
    return (await fh.getFile()).lastModified
  } catch (err) {
    if ((err as DOMException).name === 'NotFoundError') return null
    throw err
  }
}

export async function writeFile(path: string, content: string | Blob): Promise<void> {
  const fh = await getFileHandle(path, true)
  const w = await fh.createWritable()
  await w.write(content)
  await w.close()
}

export async function exists(path: string): Promise<boolean> {
  try {
    await getFileHandle(path)
    return true
  } catch (err) {
    const name = (err as DOMException).name
    if (name === 'NotFoundError') return false
    if (name === 'TypeMismatchError') return true // it's a directory
    throw err
  }
}

export async function mkdir(path: string): Promise<void> {
  await getDirHandle(path, true)
}

export async function removeFile(path: string): Promise<void> {
  const segs = splitPath(path)
  const name = segs.pop()
  if (!name) throw new Error(`Invalid path: ${path}`)
  const dir = await getDirHandle(segs.join('/'))
  await dir.removeEntry(name)
}

export async function removeDir(path: string): Promise<void> {
  const segs = splitPath(path)
  const name = segs.pop()
  if (!name) throw new Error(`Invalid path: ${path}`)
  const dir = await getDirHandle(segs.join('/'))
  await dir.removeEntry(name, { recursive: true })
}

/** Rename/move a file via copy + delete (the Access API has no cross-dir move). */
export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const src = await getFileHandle(oldPath)
  const file = await src.getFile()
  await writeFile(newPath, file)
  await removeFile(oldPath)
}

/** Rename/move a directory by copying every file under it to the new prefix,
 *  then removing the old tree. (Empty subdirectories are not preserved.) */
export async function renameDir(oldPath: string, newPath: string): Promise<void> {
  const files = collectFiles(await readTreeFrom(oldPath))
  for (const p of files) {
    const dest = newPath + p.slice(oldPath.length) // p starts with `${oldPath}/`
    await writeFile(dest, await (await getFileHandle(p)).getFile())
  }
  await removeDir(oldPath)
}

export async function readTree(): Promise<TreeNode[]> {
  return readDirRecursive(getRoot(), '', true)
}

/**
 * Recursive listing rooted at `dirPath` — used by the agent to browse
 * app-generated directories like `.trace/pdf-index/` that the UI tree hides.
 */
export async function readTreeFrom(dirPath: string): Promise<TreeNode[]> {
  const dir = await getDirHandle(dirPath)
  return readDirRecursive(dir, dirPath.replace(/\/+$/, ''), false)
}

async function readDirRecursive(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  applyIgnore: boolean,
): Promise<TreeNode[]> {
  const nodes: TreeNode[] = []
  for await (const entry of dir.values()) {
    if (entry.name === '.git') continue
    if (applyIgnore && isTreeHidden(entry.name)) continue
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.kind === 'directory') {
      nodes.push({
        name: entry.name,
        path,
        kind: 'dir',
        children: await readDirRecursive(entry as FileSystemDirectoryHandle, path, applyIgnore),
      })
    } else {
      nodes.push({ name: entry.name, path, kind: 'file' })
    }
  }
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

/** Flatten a tree into file paths (depth-first). */
export function collectFiles(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.kind === 'file') out.push(n.path)
    else if (n.children) collectFiles(n.children, out)
  }
  return out
}
