/**
 * Git state for the opened KB: branch + dirty text files (badge in the title
 * bar), in-app commit, and GitHub fast-forward sync. All heavy work lives in
 * lib/git.ts / lib/github.ts; this store sequences it and owns the UI state.
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import * as g from '@/lib/git'
import { withGitLock } from '@/lib/gitlock'
import { coalesce } from '@/lib/async'
import {
  parseGithubRemote,
  push as ghPush,
  pull as ghPull,
  explainGithubError,
  type GithubRepo,
} from '@/lib/github'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useSettingsStore } from '@/stores/settings'
import { useReviewStore } from '@/stores/review'

export const useGitStore = defineStore('git', () => {
  const kb = useKbStore()

  const isRepo = ref(false)
  const branch = ref<string | null>(null)
  const changes = ref<g.FileChange[]>([])
  const log = ref<g.LogEntry[]>([])
  const remote = ref<GithubRepo | null>(null)
  const panelOpen = ref(false)
  const busy = ref<string | null>(null) // current operation label
  const progress = ref('')
  const error = ref('')
  const lastSync = ref('')

  const dirtyCount = computed(() => changes.value.length)

  /** path → change kind, for tinting file rows in the tree (VS Code style). */
  const statusByPath = computed(() => {
    const m = new Map<string, g.FileChange['kind']>()
    for (const c of changes.value) m.set(c.path, c.kind)
    return m
  })

  /** Aggregate git status of a directory from its descendants: modified wins
   *  over deleted over new, so a folder shows the most notable change under it. */
  function dirStatus(dirPath: string): g.FileChange['kind'] | null {
    const prefix = `${dirPath}/`
    let hasDeleted = false
    let hasNew = false
    for (const c of changes.value) {
      if (!c.path.startsWith(prefix)) continue
      if (c.kind === 'modified') return 'modified'
      if (c.kind === 'deleted') hasDeleted = true
      else hasNew = true
    }
    return hasDeleted ? 'deleted' : hasNew ? 'new' : null
  }

  /**
   * Re-read branch, working-tree changes, log and remote.
   *
   * Coalesced, and never dropped. The old guard returned early whenever ANY
   * operation held `busy`, which discarded exactly the refreshes that matter
   * most — the one a commit or an agent write fires while something else is
   * still in flight — and left the tree's U/M/D decorations describing a state
   * that had already changed, until an unrelated window focus happened to ask
   * again. That is the "sometimes it syncs, sometimes I have to refresh" of it.
   *
   * Exclusion over the repository is withGitLock's job, not a dropped read's.
   * `busy` stays what it always was, a UI label: this claims it only when
   * nothing else has, and releases it only if it is still ours, so a status
   * read can neither mislabel a push nor clear its spinner early.
   */
  const refresh = coalesce(async () => {
    if (!kb.name) return
    let claimed = false
    try {
      isRepo.value = await g.isRepo()
      if (!isRepo.value) return
      if (busy.value === null) {
        busy.value = 'status'
        claimed = true
      }
      await withGitLock(async () => {
        branch.value = await g.currentBranch()
        changes.value = await g.changedFiles()
        log.value = await g.recentLog()
      })
      const remotes = await g.listRemotes()
      const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0]
      remote.value = origin ? parseGithubRemote(origin.url) : null
      // NB: don't clear `error` here — sync() runs refresh() as its last step,
      // and a successful refresh must not wipe the sync failure message.
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      if (claimed && busy.value === 'status') busy.value = null
    }
  })

  watch(
    () => kb.name,
    async (name) => {
      g.resetGitCache()
      isRepo.value = false
      branch.value = null
      changes.value = []
      log.value = []
      remote.value = null
      panelOpen.value = false
      error.value = ''
      lastSync.value = ''
      if (name) await refresh()
    },
    { immediate: true },
  )

  /** Sets the panel's "waiting" note when another session holds the git lock. */
  function noteWait(): void {
    progress.value = 'Waiting for another git operation to finish…'
  }


  /** Initialize a git repo in the opened KB, then reload state. */
  async function init(): Promise<void> {
    if (!kb.name || busy.value || isRepo.value) return
    busy.value = 'init'
    error.value = ''
    try {
      await withGitLock(() => g.init(), { onWait: noteWait })
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      busy.value = null
      progress.value = ''
    }
    await refresh()
  }

  async function commit(paths: string[], message: string): Promise<void> {
    if (busy.value || !message.trim() || !paths.length) return
    busy.value = 'commit'
    error.value = ''
    try {
      const oid = await withGitLock(
        async () => {
          const settings = useSettingsStore()
          const author = await g.resolveAuthor({
            name: settings.state.gitName || 'browser-md',
            email: settings.state.gitEmail || 'browser-md@local',
          })
          const selected = changes.value.filter((c) => paths.includes(c.path))
          return g.commitPaths(selected, message.trim(), author)
        },
        { onWait: noteWait },
      )
      lastSync.value = `Committed ${oid.slice(0, 7)}`
      // Committing is an approval — drop these from the agent-changes review list.
      useReviewStore().markCommitted(paths)
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      busy.value = null
      progress.value = ''
    }
    await refresh()
  }

  async function sync(direction: 'push' | 'pull'): Promise<void> {
    if (busy.value) return
    const settings = useSettingsStore()
    if (!remote.value) {
      error.value = 'No recognizable GitHub remote'
      return
    }
    if (direction === 'push' && !settings.state.githubToken) {
      error.value = 'Pushing requires a GitHub token — configure it in Settings'
      return
    }
    busy.value = direction
    error.value = ''
    progress.value = ''
    try {
      const ctx = { ...remote.value, token: settings.state.githubToken }
      const onProgress = (msg: string) => (progress.value = msg)
      lastSync.value = await withGitLock(
        () => (direction === 'push' ? ghPush(ctx, onProgress) : ghPull(ctx, onProgress)),
        { onWait: noteWait },
      )
      if (direction === 'pull') {
        const files = useFilesStore()
        await files.refreshTree()
      }
    } catch (err) {
      const e = err as Error & { data?: { filepaths?: string[] } }
      if (e.name === 'CheckoutConflictError' && e.data?.filepaths) {
        error.value = `Local uncommitted changes conflict with the remote: ${e.data.filepaths.join(', ')} — commit or revert these files first`
      } else {
        const repo = remote.value ? `${remote.value.owner}/${remote.value.repo}` : undefined
        error.value = explainGithubError(e, direction, repo)
      }
    } finally {
      busy.value = null
      progress.value = ''
    }
    await refresh()
  }

  return {
    isRepo,
    branch,
    changes,
    log,
    remote,
    panelOpen,
    busy,
    progress,
    error,
    lastSync,
    dirtyCount,
    statusByPath,
    dirStatus,
    refresh,
    init,
    commit,
    sync,
  }
})
