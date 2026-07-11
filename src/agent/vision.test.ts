import { describe, it, expect } from 'vitest'
import { imageUrlForProvider, arrayBufferToBase64 } from './vision'

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

describe('imageUrlForProvider', () => {
  it('passes data URLs through for standard providers', () => {
    expect(imageUrlForProvider({ provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }, DATA_URL)).toBe(DATA_URL)
    expect(imageUrlForProvider({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' }, DATA_URL)).toBe(DATA_URL)
  })
  it('strips the data: prefix for GLM (bigmodel.cn wants raw base64)', () => {
    expect(imageUrlForProvider({ provider: 'glm', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }, DATA_URL)).toBe('iVBORw0KGgo=')
    expect(imageUrlForProvider({ provider: 'custom', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }, DATA_URL)).toBe('iVBORw0KGgo=')
  })
  it('never touches http(s) refs', () => {
    const url = 'https://example.com/x.png'
    expect(imageUrlForProvider({ provider: 'glm', baseUrl: 'https://open.bigmodel.cn' }, url)).toBe(url)
  })
})

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
