import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

/**
 * `changedFiles` parks inside every status read, so a read can be inspected
 * while it is in flight — which is the only moment `busy` says anything.
 */
let release: (() => void) | null = null
let arrived: (() => void) | null = null
const entry = (): Promise<void> => new Promise<void>((r) => (arrived = r))

const changedFiles = vi.fn(async () => {
  arrived?.()
  await new Promise<void>((r) => (release = r))
  return []
})

vi.mock('@/lib/git', () => ({
  isRepo: () => Promise.resolve(true),
  currentBranch: () => Promise.resolve('main'),
  changedFiles: () => changedFiles(),
  recentLog: () => Promise.resolve([]),
  listRemotes: () => Promise.resolve([]),
  resetGitCache: () => {},
  init: () => Promise.resolve(),
  commitPaths: () => Promise.resolve(''),
  resolveAuthor: () => ({ name: 'x', email: 'x' }),
}))
vi.mock('@/lib/gitlock', () => ({ withGitLock: (fn: () => Promise<void>) => fn() }))
vi.mock('@/lib/github', () => ({
  parseGithubRemote: () => null,
  remoteHead: () => Promise.resolve(null),
  push: () => Promise.resolve(),
  pull: () => Promise.resolve(),
  explainGithubError: (e: Error) => e.message,
}))
vi.mock('@/stores/kb', () => ({ useKbStore: () => ({ name: 'kb' }) }))
vi.mock('@/stores/files', () => ({ useFilesStore: () => ({ refreshTree: () => Promise.resolve() }) }))
vi.mock('@/stores/settings', () => ({ useSettingsStore: () => ({ state: {} }) }))
vi.mock('@/stores/review', () => ({ useReviewStore: () => ({ count: 0 }) }))

/**
 * `busy` is a claim on the user's attention — it spins the git icon and
 * disables Commit and Push. A read the user did not ask for must make neither.
 */
describe('the git status label', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    changedFiles.mockClear()
    release = null
    arrived = null
  })

  /**
   * Opening a KB refreshes on its own — `watch(() => kb.name, …, immediate)` —
   * so every test has to let that pass land before asking anything about the
   * label. Coalescing means a refresh started while it is still in flight is
   * folded into it rather than run again, which is correct and would otherwise
   * make each test measure the wrong pass.
   */
  async function settledStore(): Promise<{ busy: string | null; refresh: () => Promise<void>; refreshQuietly: () => Promise<void> }> {
    const { useGitStore } = await import('./git')
    const git = useGitStore()
    await vi.waitFor(() => expect(release).not.toBeNull())
    release!()
    await vi.waitFor(() => expect(git.busy).toBeNull())
    changedFiles.mockClear()
    return git as never
  }

  it('is claimed by a refresh someone asked for', async () => {
    const git = await settledStore()
    const inside = entry()
    const done = git.refresh()
    await inside
    expect(git.busy).toBe('status')
    release!()
    await done
    expect(git.busy).toBeNull()
  })

  it('stays clear for a refresh nobody asked for', async () => {
    const git = await settledStore()
    const inside = entry()
    const done = git.refreshQuietly()
    await inside
    expect(git.busy).toBeNull()
    release!()
    await done
    expect(git.busy).toBeNull()
  })

  /**
   * Both go through one coalescing queue, so the quiet flag has to belong to
   * the pass it was set for and to no other — otherwise the first background
   * reconciliation would silence whatever the user asked for next.
   */
  it('does not silence a real refresh queued behind a quiet one', async () => {
    const git = await settledStore()

    const firstInside = entry()
    const quiet = git.refreshQuietly()
    await firstInside
    expect(git.busy).toBeNull()

    const loud = git.refresh() // queued behind the pass now in flight
    const secondInside = entry()
    release!() // let the quiet pass finish; the queued one starts
    await secondInside

    expect(git.busy).toBe('status')
    release!()
    await Promise.all([quiet, loud])
    expect(git.busy).toBeNull()
    expect(changedFiles).toHaveBeenCalledTimes(2)
  })
})
