import { describe, it, expect, beforeEach } from 'vitest'
import { adoptLegacyLocalStorage } from './legacyStorage'

/**
 * The module this tests is the only thing standing between a rename and a
 * browser that looks wiped, so its two failure modes are worth pinning: losing
 * a legacy value, and clobbering a current one with it.
 */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as unknown as Storage
}

const read = () => {
  const out: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    out[k] = localStorage.getItem(k)!
  }
  return out
}

describe('adoptLegacyLocalStorage', () => {
  beforeEach(() => {
    globalThis.localStorage = fakeStorage()
  })

  it('carries every legacy key over under its new name', () => {
    globalThis.localStorage = fakeStorage({
      'browser-md:settings': '{"licenceKey":"LMD1.x"}',
      'browser-md:locale': 'zh',
      'browser-md:reading-position:v1': '{"a":1}',
    })
    adoptLegacyLocalStorage()
    expect(read()['localmd:settings']).toBe('{"licenceKey":"LMD1.x"}')
    expect(read()['localmd:locale']).toBe('zh')
    expect(read()['localmd:reading-position:v1']).toBe('{"a":1}')
  })

  it('leaves the originals in place — the copy is not a move', () => {
    // Deleting is a separate, later act. A build that got the copy wrong must
    // not also have destroyed what it was copying.
    globalThis.localStorage = fakeStorage({ 'browser-md:locale': 'zh' })
    adoptLegacyLocalStorage()
    expect(read()['browser-md:locale']).toBe('zh')
  })

  it('never overwrites a value already written under the new name', () => {
    // The failure this prevents is real: i18n writes a default locale while it
    // is being imported, and a migration arriving after that would find the new
    // key set and — without this guard — replace the user's saved choice.
    globalThis.localStorage = fakeStorage({
      'browser-md:locale': 'zh',
      'localmd:locale': 'en',
    })
    adoptLegacyLocalStorage()
    expect(read()['localmd:locale']).toBe('en')
  })

  it('touches nothing that is not prefixed', () => {
    globalThis.localStorage = fakeStorage({ 'someone-elses-key': 'v' })
    adoptLegacyLocalStorage()
    expect(read()).toEqual({ 'someone-elses-key': 'v' })
  })

  it('is safe to run twice', () => {
    globalThis.localStorage = fakeStorage({ 'browser-md:locale': 'zh' })
    adoptLegacyLocalStorage()
    localStorage.setItem('localmd:locale', 'en') // the user then switches
    adoptLegacyLocalStorage()
    expect(read()['localmd:locale']).toBe('en')
  })
})
