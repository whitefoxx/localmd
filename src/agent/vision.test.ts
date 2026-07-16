import { describe, it, expect } from 'vitest'
import { arrayBufferToBase64, toDataUrl } from './vision'

describe('arrayBufferToBase64', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const b64 = arrayBufferToBase64(bytes.buffer)
    expect(atob(b64).split('').map((c) => c.charCodeAt(0))).toEqual([...bytes])
  })
  it('handles buffers larger than the chunk size', () => {
    const big = new Uint8Array(70000).fill(65)
    const b64 = arrayBufferToBase64(big.buffer)
    expect(atob(b64)).toHaveLength(70000)
  })
})

describe('toDataUrl', () => {
  it('builds a data URL from media type + base64', () => {
    expect(toDataUrl({ path: 'a.png', mediaType: 'image/png', base64: 'iVBORw0KGgo=' })).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    )
  })
})
