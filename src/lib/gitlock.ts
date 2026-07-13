/**
 * App-wide async mutex for .git-mutating operations. isomorphic-git has no
 * internal locking — two concurrent operations that write .git/index (status
 * cache write-back, add/commit, checkout) interleave and corrupt state. With
 * concurrent chat sessions each checkpointing at turn end, plus user-driven
 * panel actions, every mutating sequence must go through this lock.
 *
 * Waiters queue FIFO. An optional acquisition timeout lets callers give up
 * with a clear message (GitBusyError) instead of stalling forever behind a
 * long push/pull — the caller keeps its changes and can retry.
 */

export class GitBusyError extends Error {
  constructor() {
    super('another git operation is in progress')
    this.name = 'GitBusyError'
  }
}

let held = false
const waiters: Array<() => void> = []

/** True while an operation holds (or waits for) the lock. */
export function isGitLockBusy(): boolean {
  return held || waiters.length > 0
}

export interface GitLockOptions {
  /** Give up acquiring after this long and throw GitBusyError. */
  timeoutMs?: number
  /** Called once if the lock is contended (i.e. the caller will wait). */
  onWait?: () => void
}

export async function withGitLock<T>(fn: () => Promise<T>, opts: GitLockOptions = {}): Promise<T> {
  const release = await new Promise<(() => void) | null>((resolve) => {
    const grant = (): void => {
      held = true
      resolve(() => {
        held = false
        waiters.shift()?.()
      })
    }
    if (!held) {
      grant()
      return
    }
    opts.onWait?.()
    waiters.push(grant)
    if (opts.timeoutMs) {
      setTimeout(() => {
        const i = waiters.indexOf(grant)
        if (i >= 0) {
          waiters.splice(i, 1)
          resolve(null)
        }
      }, opts.timeoutMs)
    }
  })
  if (!release) throw new GitBusyError()
  try {
    return await fn()
  } finally {
    release()
  }
}
