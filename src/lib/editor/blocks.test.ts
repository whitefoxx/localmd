import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { toggleTaskItem, toggleTaskDone, setHeading, completeFence } from './blocks'

/** Apply a line command to `doc` with the selection spanning `from`..`to`. */
function run(
  doc: string,
  cmd: (s: EditorState) => ReturnType<typeof toggleTaskDone>,
  from = 0,
  to = from,
): string {
  const state = EditorState.create({ doc, selection: { anchor: from, head: to } })
  return state.update(cmd(state) ?? {}).state.doc.toString()
}

describe('toggleTaskItem', () => {
  it('makes a plain line a task', () => {
    expect(run('buy milk', toggleTaskItem)).toBe('- [ ] buy milk')
  })

  it('keeps an existing bullet and its indentation', () => {
    expect(run('  * buy milk', toggleTaskItem)).toBe('  * [ ] buy milk')
  })

  it('turns a task back into a plain bullet', () => {
    expect(run('- [ ] buy milk', toggleTaskItem)).toBe('- buy milk')
    expect(run('  * [x] buy milk', toggleTaskItem)).toBe('  * buy milk')
  })

  it('applies to every line of a multi-line selection', () => {
    expect(run('a\nb\nc', toggleTaskItem, 0, 5)).toBe('- [ ] a\n- [ ] b\n- [ ] c')
  })

  it('promotes a mixed selection rather than inverting it', () => {
    expect(run('- [ ] a\nb', toggleTaskItem, 0, 9)).toBe('- [ ] a\n- [ ] b')
  })

  it('strips only when every touched line is a task', () => {
    expect(run('- [ ] a\n- [x] b', toggleTaskItem, 0, 15)).toBe('- a\n- b')
  })
})

describe('toggleTaskDone', () => {
  it('checks and unchecks', () => {
    expect(run('- [ ] a', toggleTaskDone)).toBe('- [x] a')
    expect(run('- [x] a', toggleTaskDone)).toBe('- [ ] a')
  })

  it('checks all when the selection is mixed', () => {
    expect(run('- [x] a\n- [ ] b', toggleTaskDone, 0, 15)).toBe('- [x] a\n- [x] b')
  })

  it('does nothing on a line that is not a task', () => {
    expect(run('plain', toggleTaskDone)).toBe('plain')
  })
})

describe('setHeading', () => {
  it('adds, changes and toggles off a level', () => {
    expect(run('title', (s) => setHeading(s, 2))).toBe('## title')
    expect(run('# title', (s) => setHeading(s, 3))).toBe('### title')
    expect(run('## title', (s) => setHeading(s, 2))).toBe('title')
    expect(run('### title', (s) => setHeading(s, 0))).toBe('title')
  })

  it('applies across a selection', () => {
    expect(run('a\nb', (s) => setHeading(s, 1), 0, 3)).toBe('# a\n# b')
  })
})

describe('completeFence', () => {
  const fence = (doc: string, pos: number) => {
    const state = EditorState.create({ doc, selection: { anchor: pos } })
    const spec = completeFence(state, pos, pos, '`')
    return spec ? state.update(spec).state : null
  }

  it('closes the fence and parks the cursor inside', () => {
    const next = fence('``', 2)!
    expect(next.doc.toString()).toBe('```\n\n```')
    expect(next.selection.main.head).toBe(4)
  })

  it('ignores the third backtick when closing an open fence', () => {
    // Line 3 is the user typing the closing fence by hand.
    expect(fence('```js\ncode\n``', 13)).toBeNull()
  })

  it('ignores backticks that are not a fence opener', () => {
    expect(fence('`', 1)).toBeNull() // only the second backtick
    expect(fence('a ``', 4)).toBeNull() // not at the line start
    expect(fence('``x', 2)).toBeNull() // text after the cursor
  })
})
