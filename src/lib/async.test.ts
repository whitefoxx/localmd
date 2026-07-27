import { describe, it, expect } from 'vitest'
import { mapLimit, untilAborted } from './async'

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
