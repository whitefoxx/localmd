import { describe, it, expect } from 'vitest'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import {
  displayWidth,
  splitRow,
  tableAt,
  renderTable,
  columnAt,
  insertTable,
  moveCell,
  nextRow,
  formatTable,
  editTableStructure,
} from './tables'

const TABLE = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')

function apply(doc: string, pos: number, cmd: (s: EditorState) => TransactionSpec | null) {
  const state = EditorState.create({ doc, selection: { anchor: pos } })
  const spec = cmd(state)
  return spec ? state.update(spec).state : null
}

describe('splitRow', () => {
  it('drops the outer pipes but keeps empty cells', () => {
    expect(splitRow('| a | b |')).toEqual(['a', 'b'])
    expect(splitRow('| a |  |')).toEqual(['a', ''])
    expect(splitRow('a | b')).toEqual(['a', 'b'])
  })

  it('honours escaped pipes', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a \\| b', 'c'])
  })
})

describe('displayWidth', () => {
  it('counts CJK as two columns', () => {
    expect(displayWidth('ab')).toBe(2)
    expect(displayWidth('中文')).toBe(4)
    expect(displayWidth('a中')).toBe(3)
  })
})

describe('tableAt', () => {
  it('parses a table and its alignments', () => {
    const state = EditorState.create({ doc: '| a | b |\n| :-- | --: |\n| 1 | 2 |' })
    const info = tableAt(state, 0)!
    expect(info.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(info.aligns).toEqual(['left', 'right'])
    expect(info.lineNumbers).toEqual([1, 3])
  })

  it('rejects pipe lines with no delimiter row', () => {
    const state = EditorState.create({ doc: '| a | b |\n| 1 | 2 |' })
    expect(tableAt(state, 0)).toBeNull()
  })

  it('returns null outside a table', () => {
    const state = EditorState.create({ doc: 'plain text' })
    expect(tableAt(state, 0)).toBeNull()
  })
})

describe('renderTable', () => {
  it('pads cells so the pipes line up', () => {
    expect(renderTable([['a', 'long'], ['x', 'y']], [null, null])).toEqual([
      '| a   | long |',
      '| --- | ---- |',
      '| x   | y    |',
    ])
  })

  it('pads CJK by display width, not character count', () => {
    const [head] = renderTable([['中文', 'b']], [null, null])
    expect(head).toBe('| 中文 | b   |')
  })

  it('writes alignment markers back', () => {
    expect(renderTable([['a', 'b', 'c']], ['left', 'center', 'right'])[1]).toBe(
      '| :-- | :-: | --: |',
    )
  })
})

describe('columnAt', () => {
  it('maps an offset to its column', () => {
    expect(columnAt('| a | b |', 2)).toBe(0)
    expect(columnAt('| a | b |', 6)).toBe(1)
    expect(columnAt('a | b', 0)).toBe(0)
    expect(columnAt('a | b', 4)).toBe(1)
  })
})

describe('insertTable', () => {
  it('replaces a blank line', () => {
    const next = apply('', 0, insertTable)!
    expect(next.doc.toString()).toBe('|     |     |\n| --- | --- |\n|     |     |')
    expect(next.selection.main.head).toBe(2)
  })

  it('opens a new line below text', () => {
    const next = apply('hello', 5, insertTable)!
    expect(next.doc.toString().split('\n')[0]).toBe('hello')
    expect(next.doc.toString().split('\n')[1]).toBe('|     |     |')
  })
})

describe('moveCell', () => {
  it('selects the next cell', () => {
    const next = apply(TABLE, 2, (s) => moveCell(s, 1))!
    const sel = next.selection.main
    expect(next.doc.sliceString(sel.from, sel.to)).toBe('b')
  })

  it('wraps to the next row past the last column', () => {
    const next = apply(TABLE, 6, (s) => moveCell(s, 1))! // on 'b'
    const sel = next.selection.main
    expect(next.doc.sliceString(sel.from, sel.to)).toBe('1')
  })

  it('appends a row when tabbing past the last cell', () => {
    const next = apply(TABLE, 30, (s) => moveCell(s, 1))! // on '2', the last cell
    expect(next.doc.toString().split('\n')).toHaveLength(4)
    expect(next.selection.main.empty).toBe(true)
  })

  it('goes backwards and stops before the first cell', () => {
    const back = apply(TABLE, 6, (s) => moveCell(s, -1))!
    expect(back.doc.sliceString(back.selection.main.from, back.selection.main.to)).toBe('a')
    expect(apply(TABLE, 2, (s) => moveCell(s, -1))).toBeNull()
  })

  it('does nothing outside a table', () => {
    expect(apply('plain', 0, (s) => moveCell(s, 1))).toBeNull()
  })
})

describe('nextRow', () => {
  it('moves down the same column', () => {
    const next = apply(TABLE, 6, nextRow)! // 'b' → '2'
    expect(next.doc.sliceString(next.selection.main.from, next.selection.main.to)).toBe('2')
  })

  it('yields on the last row so Enter can leave the table', () => {
    expect(apply(TABLE, 24, nextRow)).toBeNull()
  })
})

describe('formatTable', () => {
  it('lines up ragged pipes and keeps the cursor in its cell', () => {
    const doc = '|a|bbbb|\n|---|---|\n|cc|d|'
    const next = apply(doc, 1, formatTable)!
    // Columns never render narrower than `---`, the conventional delimiter.
    expect(next.doc.toString()).toBe(
      ['| a   | bbbb |', '| --- | ---- |', '| cc  | d    |'].join('\n'),
    )
    const sel = next.selection.main
    expect(next.doc.sliceString(sel.from, sel.to)).toBe('a')
  })
})

describe('editTableStructure', () => {
  it('adds a row below', () => {
    const next = apply(TABLE, 2, (s) => editTableStructure(s, 'row-after'))!
    expect(next.doc.toString().split('\n')).toHaveLength(4)
    expect(next.doc.toString().split('\n')[2]).toBe('|     |     |')
  })

  it('adds a column after the cursor', () => {
    const next = apply(TABLE, 2, (s) => editTableStructure(s, 'col-after'))!
    expect(next.doc.toString().split('\n')[0]).toBe('| a   |     | b   |')
  })

  it('deletes a column', () => {
    const next = apply(TABLE, 2, (s) => editTableStructure(s, 'col-delete'))!
    expect(next.doc.toString().split('\n')[0]).toBe('| b   |')
  })

  it('refuses to delete the header row', () => {
    expect(apply(TABLE, 2, (s) => editTableStructure(s, 'row-delete'))).toBeNull()
  })

  it('deletes a body row', () => {
    const four = `${TABLE}\n| 3 | 4 |`
    const next = apply(four, 24, (s) => editTableStructure(s, 'row-delete'))!
    expect(next.doc.toString().split('\n')).toHaveLength(3)
  })
})
