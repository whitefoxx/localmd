import { describe, it, expect, afterEach } from 'vitest'
import { installJsShims, jsShimSource } from './polyfills'

/**
 * Node usually ships these natively, so each test drops the built-in first —
 * otherwise `installJsShims` would (correctly) no-op and we'd be asserting on
 * V8's implementation instead of ours.
 */
const saved = new Map<string, [object, PropertyDescriptor | undefined]>()

function drop(target: object, name: string): void {
  saved.set(name, [target, Object.getOwnPropertyDescriptor(target, name)])
  delete (target as Record<string, unknown>)[name]
}

afterEach(() => {
  for (const [name, [target, desc]] of saved) {
    delete (target as Record<string, unknown>)[name]
    if (desc) Object.defineProperty(target, name, desc)
  }
  saved.clear()
})

type Hexable = { toHex(): string }
type Base64able = { toBase64(): string }
type U8Statics = { fromBase64(s: string): Uint8Array }
type PromiseStatics = {
  try<T>(fn: () => T): Promise<T>
  withResolvers<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
}

describe('installJsShims', () => {
  it('hex-encodes with zero padding', () => {
    drop(Uint8Array.prototype, 'toHex')
    installJsShims()
    const u8 = new Uint8Array([0x00, 0x01, 0x0f, 0xff]) as unknown as Hexable
    expect(u8.toHex()).toBe('00010fff')
    expect((new Uint8Array(0) as unknown as Hexable).toHex()).toBe('')
  })

  it('round-trips base64, including payloads past the chunk size', () => {
    drop(Uint8Array.prototype, 'toBase64')
    drop(Uint8Array, 'fromBase64')
    installJsShims()
    expect((new Uint8Array([0x68, 0x69]) as unknown as Base64able).toBase64()).toBe('aGk=')
    expect((new Uint8Array([0xff, 0xfe, 0xfd]) as unknown as Base64able).toBase64()).toBe('//79')

    const big = new Uint8Array(0x8000 * 2 + 7)
    for (let i = 0; i < big.length; i++) big[i] = i % 256
    const back = (Uint8Array as unknown as U8Statics).fromBase64(
      (big as unknown as Base64able).toBase64(),
    )
    expect(back).toEqual(big)
  })

  it('runs Promise.try and rejects on a synchronous throw', async () => {
    drop(Promise, 'try')
    installJsShims()
    const P = Promise as unknown as PromiseStatics
    await expect(P.try(() => 42)).resolves.toBe(42)
    await expect(
      P.try(() => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })

  it('hands back an externally settleable promise from withResolvers', async () => {
    drop(Promise, 'withResolvers')
    installJsShims()
    const { promise, resolve } = (Promise as unknown as PromiseStatics).withResolvers<string>()
    resolve('ok')
    await expect(promise).resolves.toBe('ok')
  })

  it('leaves a native implementation alone', () => {
    const before = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toHex')
    installJsShims()
    expect(Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toHex')).toEqual(before)
  })
})

describe('jsShimSource', () => {
  it('is self-contained — it installs the shims with no module scope around it', () => {
    drop(Uint8Array.prototype, 'toHex')
    // Indirect eval runs in global scope, so any leaked closure reference (an
    // import, a module-level const) would throw here rather than in a worker.
    ;(0, eval)(jsShimSource())
    expect((new Uint8Array([0xde, 0xad]) as unknown as Hexable).toHex()).toBe('dead')
  })
})
