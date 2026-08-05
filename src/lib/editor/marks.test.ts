import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { toggleMark, insertLink, type MarkKind } from './marks'

/** Apply a toggle to `doc` with the selection marked by | … | (or a single |
 *  for a cursor), and return the result in the same notation. */
function run(marked: string, kind: MarkKind): string {
  const first = marked.indexOf('|')
  const second = marked.indexOf('|', first + 1)
  const doc =
    second < 0
      ? marked.replace('|', '')
      : marked.slice(0, first) + marked.slice(first + 1, second) + marked.slice(second + 1)
  const anchor = first
  const head = second < 0 ? first : second - 1
  const state = EditorState.create({ doc, selection: EditorSelection.range(anchor, head) })
  const next = state.update(toggleMark(state, kind)).state
  const text = next.doc.toString()
  const sel = next.selection.main
  return sel.empty
    ? text.slice(0, sel.head) + '|' + text.slice(sel.head)
    : text.slice(0, sel.from) + '|' + text.slice(sel.from, sel.to) + '|' + text.slice(sel.to)
}

describe('toggleMark — selection', () => {
  it('wraps and unwraps a selection', () => {
    expect(run('a |word| b', 'bold')).toBe('a **|word|** b')
    expect(run('a |**word**| b', 'bold')).toBe('a |word| b')
  })

  it('unwraps when the marks sit just outside the selection', () => {
    // Double-clicking the word inside **word** selects only the word.
    expect(run('a **|word|** b', 'bold')).toBe('a |word| b')
  })

  it('leaves surrounding whitespace outside the marks', () => {
    // Selecting the word plus the space after it — easy to do by dragging.
    expect(run('a |word |b', 'bold')).toBe('a **|word|** b')
    const state = EditorState.create({ doc: 'a word b', selection: { anchor: 1, head: 7 } })
    expect(state.update(toggleMark(state, 'bold')).state.doc.toString()).toBe('a **word** b')
  })

  it('handles inline code and strikethrough', () => {
    expect(run('a |x| b', 'code')).toBe('a `|x|` b')
    expect(run('a `|x|` b', 'code')).toBe('a |x| b')
    expect(run('a |x| b', 'strike')).toBe('a ~~|x|~~ b')
    expect(run('a ~~|x|~~ b', 'strike')).toBe('a |x| b')
  })
})

describe('toggleMark — nested emphasis', () => {
  it('italic on bold nests instead of eating a star', () => {
    // The bug in the editor we are porting from: this used to yield *word*.
    expect(run('|**word**|', 'italic')).toBe('***|word|***')
  })

  it('italic on bold+italic removes only the italic', () => {
    expect(run('|***word***|', 'italic')).toBe('**|word|**')
  })

  it('bold on bold+italic removes only the bold', () => {
    expect(run('|***word***|', 'bold')).toBe('*|word|*')
  })

  it('bold on italic nests', () => {
    expect(run('|*word*|', 'bold')).toBe('***|word|***')
  })
})

describe('toggleMark — cursor', () => {
  it('expands to the word under the cursor', () => {
    expect(run('a wo|rd b', 'bold')).toBe('a **|word|** b')
  })

  it('unbolds from inside a bolded word', () => {
    expect(run('a **wo|rd** b', 'bold')).toBe('a |word| b')
  })

  it('opens an empty pair when there is no word', () => {
    expect(run('a | b', 'bold')).toBe('a **|** b')
    expect(run('|', 'italic')).toBe('*|*')
  })
})

describe('insertLink', () => {
  const link = (doc: string, from: number, to: number) => {
    const state = EditorState.create({ doc, selection: { anchor: from, head: to } })
    const next = state.update(insertLink(state)).state
    return { text: next.doc.toString(), cursor: next.selection.main.head }
  }

  it('makes the selection the label and waits in the target', () => {
    const { text, cursor } = link('see docs here', 4, 8)
    expect(text).toBe('see [docs]() here')
    expect(cursor).toBe(11) // inside ()
  })

  it('makes a URL selection the target and waits in the label', () => {
    const { text, cursor } = link('https://x.dev', 0, 13)
    expect(text).toBe('[](https://x.dev)')
    expect(cursor).toBe(1) // inside []
  })

  it('inserts an empty link with no selection', () => {
    expect(link('', 0, 0)).toEqual({ text: '[]()', cursor: 1 })
  })
})

describe('toggleMark — multiple selections', () => {
  it('toggles each range independently', () => {
    const doc = 'one two'
    const state = EditorState.create({
      doc,
      // Without this facet CodeMirror collapses the selection to its main range.
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.range(4, 7),
      ]),
    })
    expect(state.update(toggleMark(state, 'bold')).state.doc.toString()).toBe('**one** **two**')
  })
})
