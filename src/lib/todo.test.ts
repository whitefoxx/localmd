import { describe, it, expect } from 'vitest'
import { appendTodo, emptyTodos } from './todo'

describe('appendTodo', () => {
  it('starts a list that does not exist yet, under a heading', () => {
    expect(appendTodo('', 'buy oat milk')).toBe(`${emptyTodos()}- [ ] buy oat milk\n`)
  })

  it('appends to what is there without disturbing it', () => {
    const before = '# Todos\n\n- [ ] one\n- [x] two\n'
    expect(appendTodo(before, 'three')).toBe('# Todos\n\n- [ ] one\n- [x] two\n- [ ] three\n')
  })

  it('leaves a line that already carries its own marker alone', () => {
    // Pasting `- [x] done` must not become `- [ ] - [x] done`.
    expect(appendTodo('# Todos\n', '- [x] done')).toBe('# Todos\n- [x] done\n')
    expect(appendTodo('# Todos\n', '1. numbered')).toBe('# Todos\n1. numbered\n')
  })

  it('takes several lines at once, one item each, and drops the blanks', () => {
    expect(appendTodo('# Todos\n', 'one\n\n  two  \n')).toBe('# Todos\n- [ ] one\n- [ ] two\n')
  })

  it('can write the box already ticked', () => {
    expect(appendTodo('# Todos\n', 'shipped it', true)).toBe('# Todos\n- [x] shipped it\n')
  })

  it('writes nothing at all for nothing', () => {
    expect(appendTodo('# Todos\n- [ ] one\n', '   \n  ')).toBe('# Todos\n- [ ] one\n')
  })

  it('does not accumulate blank lines when appending repeatedly', () => {
    let s = ''
    for (const t of ['a', 'b', 'c']) s = appendTodo(s, t)
    expect(s).toBe('# Todos\n\n- [ ] a\n- [ ] b\n- [ ] c\n')
  })
})
