/**
 * Central keyboard-shortcut registry.
 *
 * The app's global shortcuts used to be a hardcoded if/else chain in App.vue.
 * They now live here as data so they can be (a) matched uniformly, (b) shown in
 * Settings, and (c) rebound by the user (overrides persist in the settings store).
 *
 * Matching notes:
 *  - `mod` means ⌘ on mac / Ctrl elsewhere — the app treats them interchangeably.
 *  - We match on `KeyboardEvent.code` (physical key), not `.key`, because ⌥ on
 *    mac remaps `.key` to dead/special characters. This is why ⌘N and ⌥⌘N (the
 *    browser-safe form) both fire the same command: Alt is intentionally ignored.
 *  - `shift` is matched exactly.
 */

export type HotkeyId = 'search' | 'sidebar' | 'agent' | 'tabPrev' | 'tabNext'

export interface Binding {
  /** KeyboardEvent.code, e.g. 'KeyS', 'BracketLeft', 'Backquote', 'Enter'. */
  code: string
  /** Requires ⌘ (mac) / Ctrl. */
  mod?: boolean
  shift?: boolean
  /** Only fire when focus is NOT in an input/textarea/contenteditable. */
  notInEditable?: boolean
}

export interface HotkeyDef {
  id: HotkeyId
  label: string
  hint?: string
  /** The primary, user-editable binding. */
  defaultBinding: Binding
  /** Extra fixed combos that always work but aren't user-editable. */
  aliases?: Binding[]
  /** Most commands only act once a KB is open; `false` fires always. */
  needsKb?: boolean
}

export const HOTKEYS: HotkeyDef[] = [
  {
    id: 'search',
    label: 'Search',
    hint: 'Open / close the search panel',
    defaultBinding: { mod: true, code: 'KeyK' },
    aliases: [{ mod: true, code: 'KeyP' }],
  },
  {
    id: 'sidebar',
    // ⌘B is bold inside a text editor — every editor in the world agrees, so
    // the sidebar yields there and ⌘` covers the case. Same trade as ⌘[ / ⌘]
    // below.
    label: 'Sidebar',
    hint: 'Show / hide the file tree. ⌘B is bold while editing a file — use ⌘` there.',
    defaultBinding: { mod: true, code: 'KeyB', notInEditable: true },
    aliases: [{ mod: true, code: 'Backquote' }],
  },
  {
    id: 'agent',
    label: 'Agent panel',
    hint: 'Show / hide the agent conversation',
    defaultBinding: { mod: true, code: 'KeyJ' },
    aliases: [{ mod: true, code: 'Enter', notInEditable: true }],
  },
  // ⌘[ / ⌘] are CodeMirror's indent — yield them inside the editor so paging tabs
  // only fires outside an editable target (the global handler runs in capture phase).
  { id: 'tabPrev', label: 'Previous tab', defaultBinding: { mod: true, code: 'BracketLeft', notInEditable: true } },
  { id: 'tabNext', label: 'Next tab', defaultBinding: { mod: true, code: 'BracketRight', notInEditable: true } },
]

export const HOTKEY_BY_ID = Object.fromEntries(HOTKEYS.map((h) => [h.id, h])) as Record<
  HotkeyId,
  HotkeyDef
>

/** User overrides: id → replacement primary binding. Absent = use default. */
export type HotkeyOverrides = Partial<Record<HotkeyId, Binding>>

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

export function matchBinding(e: KeyboardEvent, b: Binding): boolean {
  const mod = e.metaKey || e.ctrlKey
  if (!!b.mod !== mod) return false
  if (!!b.shift !== e.shiftKey) return false
  if (e.code !== b.code) return false // Alt intentionally ignored (see file header)
  if (b.notInEditable && isEditableTarget(e.target)) return false
  return true
}

export function bindingsEqual(a: Binding, b: Binding): boolean {
  return a.code === b.code && !!a.mod === !!b.mod && !!a.shift === !!b.shift
}

/** The primary (override or default) plus any fixed aliases. */
export function activeBindings(def: HotkeyDef, overrides: HotkeyOverrides): Binding[] {
  const primary = overrides[def.id] ?? def.defaultBinding
  return def.aliases ? [primary, ...def.aliases] : [primary]
}

/** Which command does this keydown trigger, if any? */
export function resolveHotkey(e: KeyboardEvent, overrides: HotkeyOverrides): HotkeyId | null {
  for (const def of HOTKEYS) {
    for (const b of activeBindings(def, overrides)) {
      if (matchBinding(e, b)) return def.id
    }
  }
  return null
}

/** A different command already bound to `b`, or null. Ignores `id` itself. */
export function findConflict(
  id: HotkeyId,
  b: Binding,
  overrides: HotkeyOverrides,
): HotkeyDef | null {
  for (const def of HOTKEYS) {
    if (def.id === id) continue
    if (activeBindings(def, overrides).some((o) => bindingsEqual(o, b))) return def
  }
  return null
}

const CODE_LABELS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
  Enter: IS_MAC ? '↵' : 'Enter',
  Space: 'Space',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Minus: '-',
  Equal: '=',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Tab: 'Tab',
}

function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return CODE_LABELS[code] ?? code
}

export function formatBinding(b: Binding): string {
  const parts: string[] = []
  if (b.mod) parts.push(IS_MAC ? '⌘' : 'Ctrl')
  if (b.shift) parts.push(IS_MAC ? '⇧' : 'Shift')
  parts.push(codeLabel(b.code))
  return parts.join(IS_MAC ? '' : '+')
}

/** Validate persisted overrides — drop unknown ids and malformed bindings. */
export function normalizeHotkeyOverrides(raw: unknown): HotkeyOverrides {
  const out: HotkeyOverrides = {}
  if (!raw || typeof raw !== 'object') return out
  const ids = new Set<string>(HOTKEYS.map((h) => h.id))
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ids.has(k) || !v || typeof v !== 'object') continue
    const vv = v as Record<string, unknown>
    if (typeof vv.code !== 'string' || !vv.code) continue
    const b: Binding = { code: vv.code }
    if (vv.mod) b.mod = true
    if (vv.shift) b.shift = true
    out[k as HotkeyId] = b
  }
  return out
}
