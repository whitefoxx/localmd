import { describe, it, expect } from 'vitest'
import { diffLines, collapseContext } from './diff'

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

describe('collapseContext', () => {
  const same = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ type: 'same' as const, text: `line ${i}` }))

  it('collapses long unchanged runs around a change', () => {
    const lines = [...same(10), { type: 'add' as const, text: 'NEW' }, ...same(10)]
    const out = collapseContext(lines, 3)
    expect(out[0]).toEqual({ type: 'skip', count: 7 })
    expect(out[out.length - 1]).toEqual({ type: 'skip', count: 7 })
    expect(out.filter((l) => l.type === 'add')).toHaveLength(1)
    // 3 context lines on each side survive
    expect(out.filter((l) => l.type === 'same')).toHaveLength(6)
  })

  it('keeps everything when the file has no changes', () => {
    const lines = same(20)
    expect(collapseContext(lines, 3)).toEqual(lines)
  })

  it('merges overlapping context windows', () => {
    const lines = [
      { type: 'del' as const, text: 'a' },
      ...same(2),
      { type: 'add' as const, text: 'b' },
    ]
    const out = collapseContext(lines, 3)
    expect(out).toEqual(lines) // nothing skipped — windows overlap
  })
})
