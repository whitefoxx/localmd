import { describe, it, expect } from 'vitest'
import { keepsNativeMenu, type MenuSelection, type MenuTarget } from './nativeMenu'

/** A stand-in for the element under the cursor. `matches` lists the selectors
 *  an ancestor (or itself) would answer to; `holds` is what it contains. */
const el = (matches: string[] = [], holds: unknown[] = []): MenuTarget => ({
  closest: (sel) => (matches.some((m) => sel.includes(m)) ? {} : null),
  contains: (other) => holds.includes(other),
})

const nothingSelected: MenuSelection = {
  isCollapsed: true,
  rangeCount: 0,
  anchorNode: null,
  containsNode: () => false,
}

/** A live selection whose anchor is `anchor` and which fully covers `inside`. */
const selecting = (anchor: unknown, inside: unknown[] = []): MenuSelection => ({
  isCollapsed: false,
  rangeCount: 1,
  anchorNode: anchor,
  containsNode: (node) => inside.includes(node),
})

describe('keepsNativeMenu', () => {
  it('suppresses the menu over plain app chrome', () => {
    expect(keepsNativeMenu(el(), nothingSelected)).toBe(false)
    expect(keepsNativeMenu(null, nothingSelected)).toBe(false)
  })

  it('keeps it wherever text is selected — the agent transcript included', () => {
    const anchor = { textNode: 'a reply worth quoting' }
    // A chat bubble: no data-file-selection anywhere above it.
    const bubble = el([], [anchor])
    expect(keepsNativeMenu(bubble, selecting(anchor))).toBe(true)
  })

  it('keeps it when the cursor is on an element inside the selection', () => {
    const span = el()
    expect(keepsNativeMenu(span, selecting({}, [span]))).toBe(true)
  })

  it('ignores a selection living somewhere else on screen', () => {
    // Text stays selected in the file pane; the right-click lands on the tree.
    const treeRow = el()
    expect(keepsNativeMenu(treeRow, selecting({ elsewhere: true }))).toBe(false)
  })

  it('keeps it in the open-file region with nothing selected', () => {
    expect(keepsNativeMenu(el(['[data-file-selection]']), nothingSelected)).toBe(true)
  })

  it('keeps it in editable fields, where paste and undo live', () => {
    expect(keepsNativeMenu(el(['input']), nothingSelected)).toBe(true)
    expect(keepsNativeMenu(el(['textarea']), nothingSelected)).toBe(true)
    expect(keepsNativeMenu(el(['contenteditable']), nothingSelected)).toBe(true)
  })

  it('survives a missing selection object', () => {
    expect(keepsNativeMenu(el(), null)).toBe(false)
    expect(keepsNativeMenu(el(['input']), null)).toBe(true)
  })

  it('does not treat a collapsed caret as a selection', () => {
    const anchor = {}
    const target = el([], [anchor])
    expect(keepsNativeMenu(target, { ...selecting(anchor), isCollapsed: true })).toBe(false)
  })
})
