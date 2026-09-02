import { describe, it, expect } from 'vitest'
import { taskLines, toggleTask } from './tasks'

const DOC = `# Todos

- [ ] one
- [x] two
* [ ] a star counts
  - [ ] and so does a sub-task
1. [ ] and a numbered one

- not a task
- [] no space, not a task

\`\`\`markdown
- [ ] a sample about task lists
\`\`\`

- [ ] after the fence
`

describe('taskLines', () => {
  it('finds every bullet style, indented and numbered', () => {
    expect(taskLines(DOC)).toEqual([2, 3, 4, 5, 6, 15])
  })

  it('does not count a task inside fenced code', () => {
    // Line 12 is the sample; counting it would shift every tick after it.
    expect(taskLines(DOC)).not.toContain(12)
  })

  it('closes a fence only on its own marker', () => {
    const s = '- [ ] a\n~~~\n- [ ] inside\n```\n- [ ] still inside\n~~~\n- [ ] out\n'
    expect(taskLines(s)).toEqual([0, 6])
  })

  it('finds nothing in a document with no tasks', () => {
    expect(taskLines('# Notes\n\nJust prose.\n')).toEqual([])
  })
})

describe('toggleTask', () => {
  it('ticks an empty box and unticks a full one', () => {
    expect(toggleTask(DOC, 0)!.split('\n')[2]).toBe('- [x] one')
    expect(toggleTask(DOC, 1)!.split('\n')[3]).toBe('- [ ] two')
  })

  it('keeps the line’s indentation, bullet and text exactly', () => {
    expect(toggleTask(DOC, 3)!.split('\n')[5]).toBe('  - [x] and so does a sub-task')
  })

  it('changes nothing else in the document', () => {
    const after = toggleTask(DOC, 0)!
    expect(after.split('\n').length).toBe(DOC.split('\n').length)
    expect(after.replace('- [x] one', '- [ ] one')).toBe(DOC)
  })

  it('counts past the fence, so the item after a sample is the right one', () => {
    expect(toggleTask(DOC, 5)!.split('\n')[15]).toBe('- [x] after the fence')
  })

  it('refuses an item that is not there rather than editing something else', () => {
    // A stale render: what was clicked no longer describes the text.
    expect(toggleTask(DOC, 99)).toBeNull()
  })
})
