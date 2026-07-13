import { describe, it, expect } from 'vitest'
import { withGitLock, isGitLockBusy, GitBusyError } from './gitlock'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('withGitLock', () => {
  it('serializes concurrent operations in FIFO order', async () => {
    const order: string[] = []
    await Promise.all([
      withGitLock(async () => {
        order.push('a-start')
        await sleep(20)
        order.push('a-end')
      }),
      withGitLock(async () => {
        order.push('b-start')
        await sleep(5)
        order.push('b-end')
      }),
      withGitLock(async () => {
        order.push('c-start')
        order.push('c-end')
      }),
    ])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end', 'c-start', 'c-end'])
  })

  it('reports contention via onWait and isGitLockBusy', async () => {
    let waited = false
    const first = withGitLock(async () => {
      await sleep(20)
      return 1
    })
    expect(isGitLockBusy()).toBe(true)
    const second = withGitLock(async () => 2, { onWait: () => (waited = true) })
    expect(waited).toBe(true)
    expect(await first).toBe(1)
    expect(await second).toBe(2)
    expect(isGitLockBusy()).toBe(false)
  })

  it('times out with GitBusyError without blocking later waiters', async () => {
    const first = withGitLock(async () => {
      await sleep(40)
      return 'long'
    })
    const timedOut = withGitLock(async () => 'never', { timeoutMs: 10 })
    await expect(timedOut).rejects.toBeInstanceOf(GitBusyError)
    // The timed-out waiter must have left the queue: a later waiter still runs.
    const third = withGitLock(async () => 'third')
    expect(await first).toBe('long')
    expect(await third).toBe('third')
  })

  it('releases the lock when the operation throws', async () => {
    await expect(
      withGitLock(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(isGitLockBusy()).toBe(false)
    expect(await withGitLock(async () => 'after')).toBe('after')
  })
})
