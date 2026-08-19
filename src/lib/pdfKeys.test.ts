import { describe, it, expect } from 'vitest'
import {
  comboOf,
  pdfKeyDecision,
  takeoverPdfShortcuts,
  type ShortcutCommandsApi,
} from './pdfKeys'

/** EmbedPDF's own normalization of a registration string — the two sides must
 *  agree or every lookup misses. */
const theirNormalize = (s: string) => s.toLowerCase().split('+').sort().join('+')

describe('comboOf', () => {
  it('matches the normalization EmbedPDF applies to its registrations', () => {
    expect(comboOf({ key: 'c', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(
      theirNormalize('Meta+C'),
    )
    expect(comboOf({ key: 's', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false })).toBe(
      theirNormalize('Meta+Shift+S'),
    )
    expect(comboOf({ key: 'ArrowLeft', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toBe(
      theirNormalize('ArrowLeft'),
    )
  })

  it('spells space out and drops bare modifiers', () => {
    expect(comboOf({ key: ' ', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false })).toBe('ctrl+space')
    expect(comboOf({ key: 'Meta', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBeNull()
    expect(comboOf({ key: 'Shift', metaKey: false, ctrlKey: false, shiftKey: true, altKey: false })).toBeNull()
  })
})

describe('pdfKeyDecision', () => {
  const table = new Map([
    ['c+meta', 'copy'],
    ['arrowleft', 'prev-page'],
  ])

  it('gives the visible pdf its key', () => {
    expect(pdfKeyDecision({ combo: 'c+meta', editable: false, table, selectionOutside: false })).toBe('copy')
  })

  it('a hidden pdf hears nothing', () => {
    expect(pdfKeyDecision({ combo: 'c+meta', editable: false, table: null, selectionOutside: false })).toBeNull()
  })

  it('yields to a selection outside the pdf — the stolen ⌘C', () => {
    expect(pdfKeyDecision({ combo: 'c+meta', editable: false, table, selectionOutside: true })).toBeNull()
  })

  it('never reaches into inputs', () => {
    expect(pdfKeyDecision({ combo: 'c+meta', editable: true, table, selectionOutside: false })).toBeNull()
  })

  it('ignores keys the pdf never claimed', () => {
    expect(pdfKeyDecision({ combo: 'arrowup+meta', editable: false, table, selectionOutside: false })).toBeNull()
    expect(pdfKeyDecision({ combo: null, editable: false, table, selectionOutside: false })).toBeNull()
  })
})

describe('takeoverPdfShortcuts', () => {
  /** A fake registry shaped like the real capability. */
  function fakeApi() {
    const commands = new Map<string, { id: string; shortcuts?: string[]; action: string }>([
      ['copy', { id: 'copy', shortcuts: ['Ctrl+C', 'Meta+C'], action: 'copy-action' }],
      ['print', { id: 'print', shortcuts: ['Ctrl+P', 'Meta+P'], action: 'print-action' }],
      ['bm:zen', { id: 'bm:zen', action: 'zen-action' }], // ours: no shortcuts
    ])
    const shortcutMap = new Map<string, string>()
    for (const c of commands.values())
      for (const s of c.shortcuts ?? []) shortcutMap.set(s.toLowerCase().split('+').sort().join('+'), c.id)
    const api: ShortcutCommandsApi = {
      getAllShortcuts: () => new Map(shortcutMap),
      getCommandByShortcut: (s) => {
        const id = shortcutMap.get(s.toLowerCase().split('+').sort().join('+'))
        return id ? commands.get(id) : undefined
      },
      unregisterCommand: (id) => {
        const c = commands.get(id)
        if (!c) return
        for (const s of c.shortcuts ?? []) shortcutMap.delete(s.toLowerCase().split('+').sort().join('+'))
        commands.delete(id)
      },
      registerCommand: (c) => {
        commands.set(c.id, c as never)
        const sc = (c as { shortcuts?: string[] }).shortcuts
        for (const s of sc ?? []) shortcutMap.set(s.toLowerCase().split('+').sort().join('+'), c.id)
      },
    }
    return { api, commands, shortcutMap }
  }

  it('returns the full table and empties the registry of shortcuts', () => {
    const { api, shortcutMap } = fakeApi()
    const table = takeoverPdfShortcuts(api)
    expect(table.get('c+meta')).toBe('copy')
    expect(table.get('c+ctrl')).toBe('copy')
    expect(table.get('meta+p')).toBe('print')
    expect(shortcutMap.size).toBe(0) // the library's listener now matches nothing
  })

  it('keeps the commands themselves intact, minus shortcuts', () => {
    const { api, commands } = fakeApi()
    takeoverPdfShortcuts(api)
    expect(commands.get('copy')?.action).toBe('copy-action') // toolbar path survives
    expect(commands.get('copy')?.shortcuts).toBeUndefined()
    expect(commands.get('bm:zen')?.action).toBe('zen-action') // untouched
  })
})
