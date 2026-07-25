/**
 * The file-touching tools against the in-memory FS shim — the destructive ones
 * (delete_path / move_path), where a wrong branch costs the user real files,
 * plus the reading and searching they rely on.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import * as fs from '@/lib/fs'
import * as g from '@/lib/git'
import { createMemoryRoot } from '@/lib/memfs'
import { useFilesStore } from '@/stores/files'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore } from '@/stores/settings'
import { TOOLS, type ToolCtx } from './tools'

// The settings store persists through a watcher; node has no localStorage.
globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
} as unknown as Storage

const ctx: ToolCtx = { sessionId: 's1' }

function tool(name: string) {
  const spec = TOOLS.find((t) => t.name === name)
  if (!spec) throw new Error(`no such tool: ${name}`)
  return (args: Record<string, unknown>): Promise<string> => spec.run(args, ctx)
}

const del = tool('delete_path')
const move = tool('move_path')
const read = tool('read_file')
const search = tool('search_files')
const mkdir = tool('create_directory')
const open = tool('open_file')
const restore = tool('git_restore')

/** Spin the microtask/timer queue until `cond` holds (an awaiting approval). */
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(async () => {
  setActivePinia(createPinia())
  fs.setRoot(createMemoryRoot())
  await fs.writeFile('wiki/note.md', '# Note\n\nbody\n')
  await fs.writeFile('raw/papers/paper.pdf', 'binary-ish')
  await fs.writeFile('inbox/a.md', 'A')
  await fs.writeFile('inbox/sub/b.md', 'B')
})

describe('delete_path', () => {
  it('deletes a text file and keeps a snapshot the user can restore', async () => {
    const out = await del({ path: 'wiki/note.md' })
    expect(out).toContain('Deleted wiki/note.md')
    expect(await fs.exists('wiki/note.md')).toBe(false)

    const review = useReviewStore()
    expect(review.changes).toHaveLength(1)
    expect(review.changes[0]).toMatchObject({ path: 'wiki/note.md', deleted: true })

    await review.discard('wiki/note.md')
    expect(await fs.readFile('wiki/note.md')).toBe('# Note\n\nbody\n')
    expect(review.count).toBe(0)
  })

  it('tolerates "./" and trailing slashes in the path', async () => {
    const review = useReviewStore()
    const pending = del({ path: './inbox/sub/', recursive: true })
    await until(() => review.changes.some((c) => c.awaiting))
    expect(review.changes[0].path).toBe('inbox/sub')
    review.decide('inbox/sub', true)

    expect(await pending).toContain('Deleted directory inbox/sub')
    expect(await fs.exists('inbox/sub/b.md')).toBe(false)
  })

  it('refuses a directory without recursive, and leaves it alone', async () => {
    const out = await del({ path: 'inbox' })
    expect(out).toMatch(/^Error:/)
    expect(out).toContain('recursive: true')
    expect(await fs.exists('inbox/a.md')).toBe(true)
  })

  it('refuses the KB root and .git', async () => {
    expect(await del({ path: '', recursive: true })).toContain('KB root')
    expect(await del({ path: '.', recursive: true })).toContain('KB root')
    expect(await del({ path: '.git', recursive: true })).toContain('off limits')
    expect(await del({ path: '.git/config' })).toContain('off limits')
  })

  it('reports a missing path instead of pretending it deleted something', async () => {
    expect(await del({ path: 'wiki/ghost.md' })).toBe('Error: no such file or directory: wiki/ghost.md')
  })

  it('asks before a directory delete even in auto mode, and honors a rejection', async () => {
    const review = useReviewStore()
    const pending = del({ path: 'inbox', recursive: true })
    await until(() => review.changes.some((c) => c.awaiting))

    const change = review.changes[0]
    expect(change).toMatchObject({ path: 'inbox', deleted: true, dir: true, awaiting: true })
    // The approval diff lists what would disappear.
    expect(change.before).toContain('inbox/a.md')
    expect(change.before).toContain('inbox/sub/b.md')

    review.decide('inbox', false)
    expect(await pending).toContain('User declined')
    expect(await fs.exists('inbox/a.md')).toBe(true)
  })

  it('deletes the directory once approved, and never restores its listing as a file', async () => {
    const review = useReviewStore()
    const pending = del({ path: 'inbox', recursive: true })
    await until(() => review.changes.some((c) => c.awaiting))
    review.decide('inbox', true)

    expect(await pending).toContain('2 file(s)')
    expect(await fs.exists('inbox/a.md')).toBe(false)

    // Discarding a directory removal only dismisses the receipt.
    await review.discard('inbox')
    expect(await fs.statKind('inbox')).toBe(null)
    expect(review.count).toBe(0)
  })

  it('asks before deleting a binary in auto mode (no snapshot to undo with)', async () => {
    const review = useReviewStore()
    const pending = del({ path: 'raw/papers/paper.pdf' })
    await until(() => review.changes.some((c) => c.awaiting))
    expect(review.changes[0].before).toBe(null)
    review.decide('raw/papers/paper.pdf', true)

    expect(await pending).toContain('cannot be undone')
    expect(await fs.exists('raw/papers/paper.pdf')).toBe(false)
    await review.discard('raw/papers/paper.pdf')
    expect(await fs.exists('raw/papers/paper.pdf')).toBe(false)
  })

  it('asks before deleting a text file in ask mode', async () => {
    useSettingsStore().state.writeMode = 'ask'
    const review = useReviewStore()
    const pending = del({ path: 'wiki/note.md' })
    await until(() => review.changes.some((c) => c.awaiting))
    review.decide('wiki/note.md', false)

    expect(await pending).toContain('User declined')
    expect(await fs.exists('wiki/note.md')).toBe(true)
  })
})

describe('move_path', () => {
  it('moves a file, creating the destination directory', async () => {
    expect(await move({ from: 'inbox/a.md', to: 'wiki/notes/a.md' })).toBe(
      'Moved inbox/a.md → wiki/notes/a.md',
    )
    expect(await fs.readFile('wiki/notes/a.md')).toBe('A')
    expect(await fs.exists('inbox/a.md')).toBe(false)
  })

  it('moves a directory with its contents', async () => {
    expect(await move({ from: 'inbox/sub', to: 'wiki/sub' })).toContain('directory')
    expect(await fs.readFile('wiki/sub/b.md')).toBe('B')
    expect(await fs.statKind('inbox/sub')).toBe(null)
  })

  it('never overwrites an existing destination', async () => {
    const out = await move({ from: 'inbox/a.md', to: 'wiki/note.md' })
    expect(out).toContain('already exists')
    expect(await fs.readFile('wiki/note.md')).toBe('# Note\n\nbody\n')
    expect(await fs.exists('inbox/a.md')).toBe(true)
  })

  it('refuses a missing source, the KB root, .git, and moving a directory into itself', async () => {
    expect(await move({ from: 'nope.md', to: 'x.md' })).toContain('no such file')
    expect(await move({ from: '.', to: 'x' })).toContain('KB root')
    expect(await move({ from: 'wiki/note.md', to: '.git/note.md' })).toContain('off limits')
    expect(await move({ from: 'inbox', to: 'inbox/nested' })).toContain('into itself')
    expect(await fs.exists('inbox/a.md')).toBe(true)
  })

  it('is a no-op error when source and destination match', async () => {
    expect(await move({ from: 'wiki/note.md', to: './wiki/note.md' })).toContain('the same')
    expect(await fs.exists('wiki/note.md')).toBe(true)
  })
})

describe('read_file', () => {
  it('hands back the offset to continue from, and reads the tail with it', async () => {
    const long = 'x'.repeat(250_000)
    await fs.writeFile('big.txt', long)

    const first = await read({ path: 'big.txt' })
    expect(first).toContain('continue with read_file offset=100000')
    expect(first.slice(0, 100_000)).toBe('x'.repeat(100_000))

    const second = await read({ path: 'big.txt', offset: 100_000 })
    expect(second).toContain('offset=200000')
    const last = await read({ path: 'big.txt', offset: 200_000 })
    expect(last).toBe('x'.repeat(50_000)) // the tail comes back whole, no marker
  })

  it('rejects an offset past the end instead of returning nothing', async () => {
    expect(await read({ path: 'wiki/note.md', offset: 9999 })).toContain('past the end')
  })
})

describe('search_files', () => {
  beforeEach(async () => {
    await fs.writeFile('wiki/api.md', '# API\n\nThe API key lives in settings.\n')
    await fs.writeFile('artifacts/guide.html', '<h1>API guide</h1>')
  })

  it('matches file contents case-insensitively, including .html artifacts', async () => {
    const out = await search({ query: 'api guide' })
    expect(out).toContain('artifacts/guide.html:1:')
  })

  it('takes a /regex/ query', async () => {
    const out = await search({ query: '/^# API$/' })
    expect(out).toContain('wiki/api.md:1: # API')
    expect(out).not.toContain('settings')
  })

  it('reports a bad regex instead of throwing', async () => {
    expect(await search({ query: '/[unclosed/' })).toMatch(/^Error: invalid regular expression/)
  })

  it('finds files by path with names: true, binaries included', async () => {
    const out = await search({ query: 'paper', names: true })
    expect(out).toBe('raw/papers/paper.pdf')
  })

  it('says so when nothing matches', async () => {
    expect(await search({ query: 'nonexistent-token' })).toContain('No matches')
    expect(await search({ query: 'nonexistent-token', names: true })).toContain('No file paths match')
  })
})

describe('git_restore', () => {
  beforeEach(async () => {
    await g.init()
    await g.commitPaths(await g.changedFiles(), 'initial', { name: 'test', email: 't@e' })
  })

  it('reverts an edit and brings back a file deleted after it was committed', async () => {
    await fs.writeFile('wiki/note.md', 'edited\n')
    await del({ path: 'inbox/a.md' })

    const out = await restore({ paths: ['wiki/note.md', 'inbox/a.md'] })
    expect(out).toContain('Restored 2 file(s)')
    expect(await fs.readFile('wiki/note.md')).toBe('# Note\n\nbody\n')
    expect(await fs.readFile('inbox/a.md')).toBe('A')
  })

  it('the restore itself is reviewable — Discard puts the working copy back', async () => {
    await fs.writeFile('wiki/note.md', 'edited\n')
    await restore({ paths: ['wiki/note.md'] })

    const review = useReviewStore()
    await review.discard('wiki/note.md')
    expect(await fs.readFile('wiki/note.md')).toBe('edited\n')
  })

  it('skips binaries, paths not in HEAD, and files already committed as-is', async () => {
    const out = await restore({ paths: ['raw/papers/paper.pdf', 'ghost.md', 'wiki/note.md'] })
    expect(out).toContain('binary')
    expect(out).toContain('not in HEAD')
    expect(out).toContain('already matches HEAD')
    expect(await fs.readFile('raw/papers/paper.pdf')).toBe('binary-ish')
  })
})

describe('create_directory / open_file', () => {
  it('creates an empty directory and is idempotent', async () => {
    expect(await mkdir({ path: 'wiki/concepts/' })).toContain('Created directory wiki/concepts/')
    expect(await fs.statKind('wiki/concepts')).toBe('dir')
    expect(await mkdir({ path: 'wiki/concepts' })).toContain('already exists')
    expect(await mkdir({ path: 'wiki/note.md' })).toContain('already exists as a file')
    expect(await mkdir({ path: '.git/hooks' })).toContain('off limits')
  })

  it('opens a file for the user and refuses directories', async () => {
    expect(await open({ path: 'wiki/note.md' })).toContain('Opened wiki/note.md')
    expect(useFilesStore().currentPath).toBe('wiki/note.md')
    expect(await open({ path: 'wiki' })).toContain('is a directory')
    expect(await open({ path: 'ghost.md' })).toContain('file not found')
  })
})
