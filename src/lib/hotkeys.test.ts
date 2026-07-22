import { describe, it, expect } from 'vitest'
import {
  matchBinding,
  resolveHotkey,
  findConflict,
  formatBinding,
  normalizeHotkeyOverrides,
  HOTKEY_BY_ID,
} from './hotkeys'

function ev(code: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    code,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    ...opts,
  } as unknown as KeyboardEvent
}

describe('matchBinding', () => {
  const sidebar = HOTKEY_BY_ID.sidebar.defaultBinding // { mod, KeyB }

  it('matches ⌘ and Ctrl interchangeably', () => {
    expect(matchBinding(ev('KeyB', { metaKey: true }), sidebar)).toBe(true)
    expect(matchBinding(ev('KeyB', { ctrlKey: true }), sidebar)).toBe(true)
  })

  it('ignores Alt (so ⌥⌘B still counts)', () => {
    expect(matchBinding(ev('KeyB', { metaKey: true, altKey: true }), sidebar)).toBe(true)
  })

  it('requires the modifier and exact shift', () => {
    expect(matchBinding(ev('KeyB'), sidebar)).toBe(false)
    expect(matchBinding(ev('KeyB', { metaKey: true, shiftKey: true }), sidebar)).toBe(false)
  })
})

describe('resolveHotkey', () => {
  it('resolves primary bindings', () => {
    expect(resolveHotkey(ev('KeyJ', { metaKey: true }), {})).toBe('agent')
    expect(resolveHotkey(ev('KeyB', { metaKey: true }), {})).toBe('sidebar')
    expect(resolveHotkey(ev('BracketRight', { metaKey: true }), {})).toBe('tabNext')
  })

  it('resolves fixed aliases', () => {
    expect(resolveHotkey(ev('KeyP', { metaKey: true }), {})).toBe('search') // ⌘P → search
    expect(resolveHotkey(ev('Backquote', { metaKey: true }), {})).toBe('sidebar') // ⌘` → sidebar
    expect(resolveHotkey(ev('Enter', { metaKey: true }), {})).toBe('agent') // ⌘↵ → agent
  })

  it('the ⌘↵ alias is suppressed inside editable fields', () => {
    const inInput = ev('Enter', {
      metaKey: true,
      target: { tagName: 'INPUT' } as unknown as EventTarget,
    })
    expect(resolveHotkey(inInput, {})).toBeNull()
  })

  it('honors the browser-safe forms ⌥⌘B / Ctrl+J', () => {
    expect(resolveHotkey(ev('KeyB', { metaKey: true, altKey: true }), {})).toBe('sidebar')
    expect(resolveHotkey(ev('KeyJ', { ctrlKey: true }), {})).toBe('agent')
  })

  it('applies user overrides and drops the old default', () => {
    const overrides = { agent: { mod: true, code: 'KeyG' } }
    expect(resolveHotkey(ev('KeyG', { metaKey: true }), overrides)).toBe('agent')
    expect(resolveHotkey(ev('KeyJ', { metaKey: true }), overrides)).toBeNull()
  })
})

describe('findConflict', () => {
  it('reports the command already bound to a combo', () => {
    expect(findConflict('agent', { mod: true, code: 'KeyK' }, {})?.id).toBe('search')
  })
  it('ignores the command itself', () => {
    expect(findConflict('search', { mod: true, code: 'KeyK' }, {})).toBeNull()
  })
})

describe('formatBinding', () => {
  it('renders the physical key label', () => {
    expect(formatBinding({ mod: true, code: 'KeyS' })).toContain('S')
    expect(formatBinding({ mod: true, code: 'BracketLeft' })).toContain('[')
  })
})

describe('normalizeHotkeyOverrides', () => {
  it('keeps valid overrides, drops unknown ids and malformed bindings', () => {
    const out = normalizeHotkeyOverrides({
      agent: { code: 'KeyG', mod: true, shift: true },
      sidebar: {}, // no code → dropped
      bogus: { code: 'KeyX', mod: true }, // unknown id → dropped
    })
    expect(out).toEqual({ agent: { code: 'KeyG', mod: true, shift: true } })
  })

  it('is safe on garbage', () => {
    expect(normalizeHotkeyOverrides(null)).toEqual({})
    expect(normalizeHotkeyOverrides('x')).toEqual({})
  })
})
