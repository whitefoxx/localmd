/**
 * Git state for the opened KB: branch + dirty text files (badge in the title
 * bar), in-app commit, and GitHub fast-forward sync. All heavy work lives in
 * lib/git.ts / lib/github.ts; this store sequences it and owns the UI state.
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import * as g from '@/lib/git'
import { parseGithubRemote, push as ghPush, pull as ghPull, type GithubRepo } from '@/lib/github'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useSettingsStore } from '@/stores/settings'

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

  /** Re-read branch/status/log. Cheap after the first run (index cache). */
  async function refresh(): Promise<void> {
    if (!kb.name || busy.value) return
    try {
      isRepo.value = await g.isRepo()
      if (!isRepo.value) return
      busy.value = 'status'
      branch.value = await g.currentBranch()
      changes.value = await g.changedFiles()
      log.value = await g.recentLog()
      const remotes = await g.listRemotes()
      const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0]
      remote.value = origin ? parseGithubRemote(origin.url) : null
      // NB: don't clear `error` here — sync() runs refresh() as its last step,
      // and a successful refresh must not wipe the sync failure message.
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      busy.value = null
    }
  }

  async function commit(paths: string[], message: string): Promise<void> {
    if (busy.value || !message.trim() || !paths.length) return
    busy.value = 'commit'
    error.value = ''
    try {
      const settings = useSettingsStore()
      const author = await g.resolveAuthor({
        name: settings.state.gitName || 'browser-md',
        email: settings.state.gitEmail || 'browser-md@local',
      })
      const selected = changes.value.filter((c) => paths.includes(c.path))
      const oid = await g.commitPaths(selected, message.trim(), author)
      lastSync.value = `已提交 ${oid.slice(0, 7)}`
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      busy.value = null
    }
    await refresh()
  }

  /** Restore the files a checkpoint commit touched to their pre-checkpoint
   *  state (worktree only — the user reviews and commits the revert). */
  async function revertCheckpoint(oid: string): Promise<void> {
    if (busy.value) return
    busy.value = 'revert'
    error.value = ''
    try {
      const paths = await g.revertCommitInWorktree(oid)
      lastSync.value = `已还原 ${paths.length} 个文件到 ${oid.slice(0, 7)} 之前(未提交,可在 Changes 里确认)`
      const files = useFilesStore()
      await files.refreshTree()
      for (const p of paths) await files.reloadIfClean(p)
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      busy.value = null
    }
    await refresh()
  }

  async function sync(direction: 'push' | 'pull'): Promise<void> {
    if (busy.value) return
    const settings = useSettingsStore()
    if (!remote.value) {
      error.value = '没有可识别的 GitHub remote'
      return
    }
    if (direction === 'push' && !settings.state.githubToken) {
      error.value = '推送需要 GitHub token——在 Settings 里配置'
      return
    }
    busy.value = direction
    error.value = ''
    progress.value = ''
    try {
      const ctx = { ...remote.value, token: settings.state.githubToken }
      const onProgress = (msg: string) => (progress.value = msg)
      lastSync.value = direction === 'push' ? await ghPush(ctx, onProgress) : await ghPull(ctx, onProgress)
      if (direction === 'pull') {
        const files = useFilesStore()
        await files.refreshTree()
      }
    } catch (err) {
      const e = err as Error & { data?: { filepaths?: string[] } }
      if (e.name === 'CheckoutConflictError' && e.data?.filepaths) {
        error.value = `本地未提交的改动与远端冲突: ${e.data.filepaths.join(', ')} — 先提交或还原这些文件`
      } else {
        error.value = e.message
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
    refresh,
    commit,
    revertCheckpoint,
    sync,
  }
})
