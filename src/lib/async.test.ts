import { describe, it, expect } from 'vitest'
import { mapLimit } from './async'

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
