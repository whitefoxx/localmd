import { describe, it, expect } from 'vitest'
import { diffLines } from './diff'

describe('diffLines', () => {
  it('marks identical content as same', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
    ])
  })

  it('detects an added line', () => {
    const d = diffLines('a\nc', 'a\nb\nc')
    expect(d).toEqual([
      { type: 'same', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'same', text: 'c' },
    ])
  })

  it('detects a removed line', () => {
    const d = diffLines('a\nb\nc', 'a\nc')
    expect(d).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'same', text: 'c' },
    ])
  })

  it('handles a full replacement', () => {
    const d = diffLines('old', 'new')
    expect(d).toContainEqual({ type: 'del', text: 'old' })
    expect(d).toContainEqual({ type: 'add', text: 'new' })
  })

  it('treats a new file (empty before) as all additions plus the empty line', () => {
    const d = diffLines('', 'x\ny')
    expect(d.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['x', 'y'])
  })
})
