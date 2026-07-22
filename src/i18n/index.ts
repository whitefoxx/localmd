/**
 * Lightweight i18n for browser-md. No external dependency — a reactive locale
 * ref plus a `t(key, params?)` lookup over per-namespace message catalogs.
 *
 * Message catalogs live in ./locales/<namespace>.ts, each default-exporting
 * `{ en: {...}, zh: {...} }`. They're aggregated at build time by import.meta
 * .glob, so adding a namespace file needs no central edit (keeps parallel work
 * conflict-free). Keys are dotted: `t('common.save')`, `t('settings.language')`.
 *
 * `t` reads the reactive `locale`, so any template/computed that calls it
 * re-renders when the language changes. Non-Vue code (e.g. the agent system
 * prompt) can read the current language with getLocale().
 */
import { ref, readonly, watch, type App } from 'vue'

export type Locale = 'en' | 'zh'

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
]

/** Human-readable language name, for the agent prompt. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  zh: 'Chinese (中文)',
}

const STORAGE_KEY = 'browser-md:locale'

type Messages = Record<string, unknown>

// Eagerly bundle every namespace catalog. Vite/vitest resolve this at build
// time; the shape is { './locales/common.ts': { default: { en, zh } }, … }.
const modules = import.meta.glob<{ default: { en: Messages; zh: Messages } }>(
  './locales/*.ts',
  { eager: true },
)

const messages: Record<Locale, Messages> = { en: {}, zh: {} }
for (const [path, mod] of Object.entries(modules)) {
  const ns = path.slice(path.lastIndexOf('/') + 1, -'.ts'.length)
  messages.en[ns] = mod.default.en
  messages.zh[ns] = mod.default.zh
}

/** Default English (per product decision); a saved choice wins. */
function loadLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'zh') return saved
  } catch {
    /* private mode / disabled storage — fall through to the default */
  }
  return 'en'
}

const locale = ref<Locale>(loadLocale())

// Keep <html lang> in sync so the platform (spellcheck, screen readers) knows.
watch(
  locale,
  (l) => {
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* ignore persistence failures */
    }
    if (typeof document !== 'undefined') document.documentElement.lang = l
  },
  { immediate: true },
)

export function getLocale(): Locale {
  return locale.value
}

export function setLocale(l: Locale): void {
  locale.value = l
}

/** Walk a dotted key (`a.b.c`) into a nested catalog; undefined if absent. */
function lookup(bag: Messages | undefined, key: string): unknown {
  let cur: unknown = bag
  for (const part of key.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

/**
 * Translate a dotted key. Falls back to English, then to the key itself, so a
 * missing string is visible rather than blank. Reads `locale` reactively.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const active = locale.value
  let value = lookup(messages[active], key)
  if (typeof value !== 'string' && active !== 'en') value = lookup(messages.en, key)
  if (typeof value !== 'string') return key
  return interpolate(value, params)
}

/** Composable form for `<script setup>`. */
export function useI18n(): {
  t: typeof t
  locale: Readonly<typeof locale>
  setLocale: typeof setLocale
} {
  return { t, locale: readonly(locale), setLocale }
}

/** Register `$t` as a global template helper. */
export const i18n = {
  install(app: App): void {
    app.config.globalProperties.$t = t
  },
}
