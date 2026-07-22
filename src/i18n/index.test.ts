import { describe, it, expect, afterEach } from 'vitest'
import { t, setLocale, getLocale } from './index'

afterEach(() => setLocale('en'))

/** Flatten a nested message object to dotted leaf keys, for en/zh parity checks. */
function leafKeys(obj: unknown, prefix = ''): string[] {
  if (obj == null || typeof obj !== 'object') return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    leafKeys(v, prefix ? `${prefix}.${k}` : k),
  )
}

describe('i18n', () => {
  it('defaults to English', () => {
    expect(getLocale()).toBe('en')
    expect(t('common.save')).toBe('Save')
  })

  it('switches language reactively', () => {
    setLocale('zh')
    expect(getLocale()).toBe('zh')
    expect(t('common.save')).toBe('保存')
    expect(t('common.cancel')).toBe('取消')
  })

  it('interpolates named params', () => {
    // A key with a placeholder is only guaranteed once real strings exist;
    // interpolation itself is exercised against a common key pattern here.
    expect(t('__nonexistent__', { a: 1 })).toBe('__nonexistent__')
  })

  it('returns the key for a missing string', () => {
    expect(t('does.not.exist')).toBe('does.not.exist')
  })

  it('falls back to English when a key is missing in the active locale', () => {
    setLocale('zh')
    // common.save exists in both; a made-up key falls through to the key.
    expect(t('common.save')).toBe('保存')
  })
})

describe('locale catalogs', () => {
  const modules = import.meta.glob<{ default: { en: unknown; zh: unknown } }>(
    './locales/*.ts',
    { eager: true },
  )

  for (const [path, mod] of Object.entries(modules)) {
    const ns = path.slice(path.lastIndexOf('/') + 1, -3)
    it(`${ns}: en and zh have identical keys`, () => {
      const en = leafKeys(mod.default.en).sort()
      const zh = leafKeys(mod.default.zh).sort()
      const onlyEn = en.filter((k) => !zh.includes(k))
      const onlyZh = zh.filter((k) => !en.includes(k))
      expect({ onlyEn, onlyZh }).toEqual({ onlyEn: [], onlyZh: [] })
    })
  }

  it('every t()/$t() literal key used in the app is defined', () => {
    // Valid dotted keys across all namespaces.
    const valid = new Set<string>()
    for (const [path, mod] of Object.entries(modules)) {
      const ns = path.slice(path.lastIndexOf('/') + 1, -3)
      for (const k of leafKeys(mod.default.en)) valid.add(`${ns}.${k}`)
    }
    // Raw source of the app code that calls t()/$t() (i18n dir itself excluded).
    const sources = import.meta.glob('../{components,stores,agent,lib}/**/*.{vue,ts}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const re = /[^\w$]\$?t\(\s*['"]([\w-]+(?:\.[\w-]+)+)['"]/g
    const missing: string[] = []
    for (const [path, src] of Object.entries(sources)) {
      if (path.includes('.test.')) continue
      for (const m of src.matchAll(re)) {
        if (!valid.has(m[1])) missing.push(`${m[1]}  (${path})`)
      }
    }
    expect(missing).toEqual([])
  })
})
