import { describe, it, expect } from 'vitest'
import { mapLimit, untilAborted, coalesce } from './async'

describe('mapLimit', () => {
  it('preserves order and caps concurrency', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 10))
      active--
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('captures per-item failures without failing the batch', async () => {
    const out = await mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom')
      return n
    })
    expect(out[0]).toBe(1)
    expect(out[1]).toBeInstanceOf(Error)
    expect(out[2]).toBe(3)
  })
})

describe('untilAborted', () => {
  it('passes a normal result through', async () => {
    expect(await untilAborted(Promise.resolve('ok'), new AbortController().signal)).toBe('ok')
  })

  it('gives up on work that never settles', async () => {
    const c = new AbortController()
    const forever = new Promise<string>(() => {}) // the tool that ignores its signal
    const raced = untilAborted(forever, c.signal)
    c.abort()
    await expect(raced).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const c = new AbortController()
    c.abort()
    await expect(untilAborted(new Promise<string>(() => {}), c.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('swallows the abandoned work’s later failure', async () => {
    const c = new AbortController()
    let boom!: (e: Error) => void
    const work = new Promise<string>((_, reject) => (boom = reject))
    const raced = untilAborted(work, c.signal)
    c.abort()
    await expect(raced).rejects.toMatchObject({ name: 'AbortError' })
    boom(new Error('the tool failed after we stopped caring'))
    // An unhandled rejection here would fail the suite run.
    await new Promise((r) => setTimeout(r, 10))
  })

  it('is a no-op without a signal', async () => {
    expect(await untilAborted(Promise.resolve(42))).toBe(42)
  })
})

describe('coalesce', () => {
  const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((r) => (resolve = r))
    return { promise, resolve }
  }

  it('runs once when nothing overlaps', async () => {
    let runs = 0
    const refresh = coalesce(async () => {
      runs++
    })
    await refresh()
    await refresh()
    expect(runs).toBe(2)
  })

  it('collapses a burst into one follow-up pass', async () => {
    let runs = 0
    let gate = deferred()
    const refresh = coalesce(async () => {
      runs++
      await gate.promise
    })
    const first = refresh()
    expect(runs).toBe(1)
    // Five more arrive while the first pass is still going.
    const rest = [refresh(), refresh(), refresh(), refresh(), refresh()]
    expect(runs).toBe(1)
    const second = deferred()
    const open = gate
    gate = second
    open.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(runs).toBe(2) // one follow-up, not five
    second.resolve()
    await Promise.all([first, ...rest])
    expect(runs).toBe(2)
  })

  it('resolves a mid-pass caller only after a pass that covers it', async () => {
    const seen: number[] = []
    let version = 0
    let gate = deferred()
    const refresh = coalesce(async () => {
      const at = version
      await gate.promise
      seen.push(at)
    })
    const first = refresh()
    version = 1 // the change a late caller wants reflected
    const late = refresh()
    const next = deferred()
    const open = gate
    gate = next
    open.resolve()
    await Promise.resolve()
    next.resolve()
    await Promise.all([first, late])
    expect(seen).toEqual([0, 1]) // the follow-up saw the newer state
  })

  it('does not wedge after a failing pass', async () => {
    let runs = 0
    const refresh = coalesce(async () => {
      runs++
      if (runs === 1) throw new Error('scan failed')
    })
    await expect(refresh()).resolves.toBeUndefined()
    await refresh()
    expect(runs).toBe(2)
  })
})
