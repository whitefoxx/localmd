/**
 * Git operations over the opened KB folder — isomorphic-git + the gitFs
 * adapter. Reads/writes the standard .git format, so everything here interops
 * with CLI git and trace-app.
 *
 * Status is scoped to TEXT files outside .trace/: the dirty list drives the
 * in-app commit flow (agent edits = text), and hashing multi-GB untracked
 * books on every refresh would be prohibitive. Binary/large sources are
 * committed from the terminal; the panel says so.
 */
import { Buffer } from 'buffer'
import git from 'isomorphic-git'
import { gitFs } from '@/lib/gitfs'
import * as kb from '@/lib/fs'

// isomorphic-git expects Node's Buffer as a global; Vite doesn't polyfill it.
const g = globalThis as unknown as { Buffer?: unknown }
if (typeof g.Buffer === 'undefined') g.Buffer = Buffer

const dir = '/'

/** isomorphic-git's object/packfile cache — huge speedup on repeated ops.
 *  Reset when the KB (root handle) changes. */
let cache: object = {}

export function resetGitCache(): void {
  cache = {}
}

const base = () => ({ fs: gitFs, dir, cache })

export async function isRepo(): Promise<boolean> {
  try {
    await gitFs.promises.stat('/.git')
    return true
  } catch {
    return false
  }
}

export async function currentBranch(): Promise<string | null> {
  try {
    return (await git.currentBranch({ ...base(), fullname: false })) ?? null
  } catch {
    return null
  }
}

export async function headOid(): Promise<string | null> {
  try {
    return await git.resolveRef({ ...base(), ref: 'HEAD' })
  } catch {
    return null // unborn branch (fresh repo)
  }
}

/** Binary/media files are excluded from status + in-app commits. */
const BINARY_RE =
  /\.(pdf|epub|png|jpe?g|gif|webp|bmp|avif|tiff?|ico|heic|svg|mp3|wav|m4a|flac|aac|ogg|opus|mp4|mov|webm|mkv|avi|m4v|zip|gz|xlsx?|docx?|pptx?|parquet|bin|dat)$/i

export function statusEligible(filepath: string): boolean {
  if (filepath === '.trace' || filepath.startsWith('.trace/')) return false
  return !BINARY_RE.test(filepath)
}

/** In-app add cap for binary files — aligned with the GitHub Data API's 100MB
 *  blob limit, so anything committable here is also pushable. */
export const MAX_BINARY_ADD = 100 * 1024 * 1024

export type FileChange = {
  path: string
  /** untracked | modified | deleted (vs HEAD, considering the worktree only) */
  kind: 'new' | 'modified' | 'deleted'
  /** Binary/media file (detected by membership only, not content). */
  binary?: boolean
  /** Binary above MAX_BINARY_ADD — commit it from a terminal. */
  oversized?: boolean
}

/** Dirty files vs HEAD. Text files go through statusMatrix (content-accurate);
 *  binaries are detected by cheap index-membership checks only — untracked and
 *  deleted binaries appear, but content modifications to tracked binaries
 *  can't be detected without hashing and are NOT listed. */
export async function changedFiles(): Promise<FileChange[]> {
  const matrix = await git.statusMatrix({ ...base(), filter: statusEligible })
  const out: FileChange[] = []
  for (const [path, head, workdir] of matrix) {
    if (head === 1 && workdir === 1) continue // unchanged
    if (head === 0 && workdir === 0) continue
    if (workdir === 0) out.push({ path, kind: 'deleted' })
    else if (head === 0) out.push({ path, kind: 'new' })
    else out.push({ path, kind: 'modified' })
  }

  // Binaries: membership-only detection, no content reads.
  const index = new Set(await git.listFiles(base()))
  const worktree = kb.collectFiles(await kb.readTree()) // skips .git and .trace
  for (const path of worktree) {
    if (statusEligible(path)) continue // text — handled above
    if (path === '.trace' || path.startsWith('.trace/')) continue
    if (index.has(path)) continue
    if (await git.isIgnored({ fs: gitFs, dir, filepath: path })) continue
    const size = (await gitFs.promises.stat(`/${path}`).catch(() => null))?.size ?? 0
    out.push({ path, kind: 'new', binary: true, ...(size > MAX_BINARY_ADD ? { oversized: true } : {}) })
  }
  const present = new Set(worktree)
  for (const path of index) {
    if (statusEligible(path)) continue
    if (!present.has(path)) out.push({ path, kind: 'deleted', binary: true })
  }
  return out
}

/** File content at HEAD, or null when absent there (new file / no commits). */
export async function readHeadText(path: string): Promise<string | null> {
  const oid = await headOid()
  if (!oid) return null
  try {
    const { blob } = await git.readBlob({ ...base(), oid, filepath: path })
    return new TextDecoder().decode(blob)
  } catch {
    return null
  }
}

export interface CommitAuthor {
  name: string
  email: string
}

/** Author identity: repo-local git config first, then the provided fallback. */
export async function resolveAuthor(fallback: CommitAuthor): Promise<CommitAuthor> {
  try {
    const name = await git.getConfig({ ...base(), path: 'user.name' })
    const email = await git.getConfig({ ...base(), path: 'user.email' })
    if (name && email) return { name, email }
  } catch {
    /* no repo config */
  }
  return fallback
}

/** Stage + commit the given paths (adds handle new/modified, remove handles
 *  deletions). Returns the new commit oid. */
export async function commitPaths(
  changes: FileChange[],
  message: string,
  author: CommitAuthor,
): Promise<string> {
  for (const c of changes) {
    if (c.kind === 'deleted') await git.remove({ ...base(), filepath: c.path })
    else await git.add({ ...base(), filepath: c.path })
  }
  return await git.commit({ ...base(), message, author })
}

export interface LogEntry {
  oid: string
  message: string
  author: string
  when: number
}

export async function recentLog(depth = 20): Promise<LogEntry[]> {
  try {
    const entries = await git.log({ ...base(), depth })
    return entries.map((e) => ({
      oid: e.oid,
      message: e.commit.message.split('\n')[0],
      author: e.commit.author.name,
      when: e.commit.author.timestamp * 1000,
    }))
  } catch {
    return [] // no commits yet
  }
}

export interface RemoteInfo {
  name: string
  url: string
}

export async function listRemotes(): Promise<RemoteInfo[]> {
  try {
    return (await git.listRemotes(base())).map((r) => ({ name: r.remote, url: r.url }))
  } catch {
    return []
  }
}

export async function isAncestor(ancestor: string, descendent: string): Promise<boolean> {
  if (ancestor === descendent) return true
  try {
    return await git.isDescendent({ ...base(), oid: descendent, ancestor })
  } catch {
    return false
  }
}

/* ── low-level object access for the GitHub sync (lib/github.ts) ─────────── */

export async function hasObject(oid: string): Promise<boolean> {
  try {
    await git.readObject({ ...base(), oid })
    return true
  } catch {
    return false
  }
}

export const raw = {
  git,
  base,
}

/* ── checkpoints: per-turn commits + one-click revert ────────────────────── */

/** Paths whose content differs between a commit and its first parent
 *  (added/modified/deleted by that commit). */
export async function commitChangedPaths(oid: string): Promise<string[]> {
  const { commit } = await git.readCommit({ ...base(), oid })
  const parent = commit.parent[0]
  if (!parent) {
    // Root commit: everything in its tree.
    const files: string[] = []
    await git.walk({
      ...base(),
      trees: [git.TREE({ ref: oid })],
      map: async (filepath, [a]) => {
        if (filepath === '.') return
        if ((await a?.type()) === 'blob') files.push(filepath)
      },
    })
    return files
  }
  const changed: string[] = []
  await git.walk({
    ...base(),
    trees: [git.TREE({ ref: oid }), git.TREE({ ref: parent })],
    map: async (filepath, [now, before]) => {
      if (filepath === '.') return
      const nowType = await now?.type()
      const beforeType = await before?.type()
      if (nowType !== 'blob' && beforeType !== 'blob') return
      const nowOid = nowType === 'blob' ? await now!.oid() : null
      const beforeOid = beforeType === 'blob' ? await before!.oid() : null
      if (nowOid !== beforeOid) changed.push(filepath)
    },
  })
  return changed
}

/** Restore the files touched by `oid` to their state BEFORE that commit
 *  (parent version; absent there = delete). Changes land in the worktree
 *  uncommitted — the user reviews/commits via the panel. Returns the paths. */
export async function revertCommitInWorktree(oid: string): Promise<string[]> {
  const { commit } = await git.readCommit({ ...base(), oid })
  const parent = commit.parent[0] ?? null
  const paths = await commitChangedPaths(oid)
  for (const path of paths) {
    let before: Uint8Array | null = null
    if (parent) {
      try {
        before = (await git.readBlob({ ...base(), oid: parent, filepath: path })).blob
      } catch {
        before = null // file didn't exist before the commit
      }
    }
    if (before === null) {
      await kb.removeFile(path).catch(() => {})
    } else {
      await kb.writeFile(path, new Blob([before as Uint8Array<ArrayBuffer>]))
    }
  }
  return paths
}
