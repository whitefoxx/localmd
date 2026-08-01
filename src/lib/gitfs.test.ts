/**
 * gitFs over an in-memory FileSystemDirectoryHandle mock, driving REAL
 * isomorphic-git. The write-guard tests pin the .git/index protection: a
 * status refresh must never persist a stale in-memory index over one that
 * CLI git rewrote underneath us (that write-back silently reverts the
 * external commit — git status shows the commit inverted, and the next
 * `git commit` undoes it).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import git from 'isomorphic-git'

const state = vi.hoisted(() => ({ root: null as unknown }))
vi.mock('@/lib/fs', () => ({ getRoot: () => state.root }))

import { gitFs, onIndexWriteConflict } from './gitfs'

/* ── minimal in-memory File System Access mock ───────────────────────────── */

let clock = 1_000_000
const tick = () => (clock += 7) // strictly monotonic lastModified

class MockFile {
  data = new Uint8Array()
  lastModified = tick()
}
class MockDir {
  children = new Map<string, MockDir | MockFile>()
}

function fileHandle(entry: MockFile) {
  return {
    kind: 'file',
    async getFile() {
      const data = entry.data
      return {
        size: data.byteLength,
        lastModified: entry.lastModified,
        async arrayBuffer() {
          return data.slice().buffer
        },
        async text() {
          return new TextDecoder().decode(data)
        },
      }
    },
    async createWritable() {
      const chunks: Uint8Array[] = []
      return {
        async write(chunk: unknown) {
          if (typeof chunk === 'string') chunks.push(new TextEncoder().encode(chunk))
          else if (chunk instanceof Blob) chunks.push(new Uint8Array(await chunk.arrayBuffer()))
          else chunks.push(new Uint8Array(chunk as ArrayBuffer))
        },
        async close() {
          const total = chunks.reduce((n, c) => n + c.byteLength, 0)
          const out = new Uint8Array(total)
          let o = 0
          for (const c of chunks) {
            out.set(c, o)
            o += c.byteLength
          }
          entry.data = out
          entry.lastModified = tick()
        },
      }
    },
  }
}

function dirHandle(entry: MockDir): unknown {
  return {
    kind: 'directory',
    async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
      let child = entry.children.get(name)
      if (!child) {
        if (!opts?.create) throw new DOMException(name, 'NotFoundError')
        child = new MockDir()
        entry.children.set(name, child)
      }
      if (!(child instanceof MockDir)) throw new DOMException(name, 'TypeMismatchError')
      return dirHandle(child)
    },
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      let child = entry.children.get(name)
      if (!child) {
        if (!opts?.create) throw new DOMException(name, 'NotFoundError')
        child = new MockFile()
        entry.children.set(name, child)
      }
      if (!(child instanceof MockFile)) throw new DOMException(name, 'TypeMismatchError')
      return fileHandle(child)
    },
    async removeEntry(name: string) {
      if (!entry.children.delete(name)) throw new DOMException(name, 'NotFoundError')
    },
    async *keys() {
      yield* entry.children.keys()
    },
  }
}

/** Walk the raw mock tree — the "CLI git" side door that bypasses gitFs. */
function rawFile(root: MockDir, path: string): MockFile {
  const segs = path.split('/').filter(Boolean)
  let cur: MockDir | MockFile = root
  for (const s of segs) {
    if (!(cur instanceof MockDir)) throw new Error(`not a dir: ${s} in ${path}`)
    const next = cur.children.get(s)
    if (!next) throw new Error(`missing: ${s} in ${path}`)
    cur = next
  }
  if (!(cur instanceof MockFile)) throw new Error(`not a file: ${path}`)
  return cur
}

/* ── scenario helpers ────────────────────────────────────────────────────── */

const dir = '/'
const author = { name: 't', email: 't@t' }

async function commitFile(cache: object, path: string, text: string, message: string) {
  await gitFs.promises.writeFile(`/${path}`, text)
  await git.add({ fs: gitFs, dir, cache, filepath: path })
  return git.commit({ fs: gitFs, dir, cache, message, author })
}

let root: MockDir

beforeEach(() => {
  root = new MockDir()
  state.root = dirHandle(root) // new handle → gitfs resets its caches
  onIndexWriteConflict(() => {})
})

/* ── tests ───────────────────────────────────────────────────────────────── */

describe('gitFs + isomorphic-git over the FSA mock', () => {
  it('init → commit → statusMatrix works, and repeat status is conflict-free', async () => {
    const cache = {}
    await git.init({ fs: gitFs, dir, defaultBranch: 'main' })
    await commitFile(cache, 'a.txt', 'original\n', 'commit A')

    const conflicts = vi.fn()
    onIndexWriteConflict(conflicts)
    expect(await git.statusMatrix({ fs: gitFs, dir, cache })).toEqual([['a.txt', 1, 1, 1]])
    // Same-generation write-backs (stat refresh) must NOT trip the guard.
    expect(await git.statusMatrix({ fs: gitFs, dir, cache })).toEqual([['a.txt', 1, 1, 1]])
    expect(conflicts).not.toHaveBeenCalled()
  })
})

describe('.git/index write-back guard', () => {
  it('refuses to overwrite an index that changed on disk since our read', async () => {
    const cache = {}
    await git.init({ fs: gitFs, dir, defaultBranch: 'main' })
    await commitFile(cache, 'a.txt', 'original\n', 'commit A')
    await git.statusMatrix({ fs: gitFs, dir, cache }) // guard now knows gen A

    // CLI git commits: index becomes generation B, bypassing gitFs entirely.
    const externalBytes = new TextEncoder().encode('GENERATION B (written by CLI git)')
    const index = rawFile(root, '.git/index')
    index.data = externalBytes
    index.lastModified = tick()

    // isomorphic-git's write-back of the stale generation-A index arrives:
    const conflicts = vi.fn()
    onIndexWriteConflict(conflicts)
    const staleGenA = new Uint8Array([1, 2, 3])
    await gitFs.promises.writeFile('/.git/index', staleGenA)

    expect(conflicts).toHaveBeenCalledTimes(1)
    expect(rawFile(root, '.git/index').data).toEqual(externalBytes) // B survived
  })

  it('allows the write again once the new generation has been read', async () => {
    const cache = {}
    await git.init({ fs: gitFs, dir, defaultBranch: 'main' })
    await commitFile(cache, 'a.txt', 'original\n', 'commit A')
    await git.statusMatrix({ fs: gitFs, dir, cache })

    const index = rawFile(root, '.git/index')
    index.data = new TextEncoder().encode('GENERATION B')
    index.lastModified = tick()

    const conflicts = vi.fn()
    onIndexWriteConflict(conflicts)
    await gitFs.promises.readFile('/.git/index') // adapter re-reads gen B
    const fresh = new Uint8Array([9, 9, 9])
    await gitFs.promises.writeFile('/.git/index', fresh)

    expect(conflicts).not.toHaveBeenCalled()
    expect(rawFile(root, '.git/index').data).toEqual(fresh)
  })

  it('statusMatrix after an external index rewrite re-reads instead of reverting', async () => {
    const cache = {}
    await git.init({ fs: gitFs, dir, defaultBranch: 'main' })
    await commitFile(cache, 'a.txt', 'original\n', 'commit A')
    await git.statusMatrix({ fs: gitFs, dir, cache })

    // "CLI git" commits b.txt: build generation B in a parallel context that
    // bypasses gitFs (its own cache; raw writes), then re-run status through
    // gitFs with the ORIGINAL long-lived cache — the buggy flow that used to
    // write generation A back over B.
    const side = {}
    await gitFs.promises.writeFile('/b.txt', 'added by CLI\n')
    await git.add({ fs: gitFs, dir, cache: side, filepath: 'b.txt' })
    await git.commit({ fs: gitFs, dir, cache: side, message: 'commit B', author })

    const matrix = await git.statusMatrix({ fs: gitFs, dir, cache })
    expect(matrix).toEqual([
      ['a.txt', 1, 1, 1],
      ['b.txt', 1, 1, 1], // gen B intact: b.txt tracked and clean, not reverted
    ])
  })
})
