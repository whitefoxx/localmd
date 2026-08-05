import { describe, it, expect } from 'vitest'
import { findInlineMath, findBlockMath } from './mathScan'

const scan = (text: string, protectedRanges: { from: number; to: number }[] = []) =>
  findInlineMath(text, 0, protectedRanges)

describe('findInlineMath', () => {
  it('finds inline and single-line display math', () => {
    expect(scan('let $x > 0$ hold').map((s) => s.tex)).toEqual(['x > 0'])
    const [span] = scan('so $$E = mc^2$$ then')
    expect(span.tex).toBe('E = mc^2')
    expect(span.display).toBe(true)
  })

  it('finds CJK-adjacent math with no surrounding spaces', () => {
    expect(scan('当$x > 0$时').map((s) => s.tex)).toEqual(['x > 0'])
  })

  it('leaves dollar amounts alone', () => {
    // The case the preview's rules were written for; the editor must agree.
    expect(scan('这件 $5,那件 $10,都不是公式')).toEqual([])
    expect(scan('价格是 $5 一件')).toEqual([])
  })

  it('reports offsets that cover the delimiters', () => {
    const [span] = scan('a $x$ b')
    expect([span.from, span.to]).toEqual([2, 5])
  })

  it('skips math inside protected ranges', () => {
    // `$x$` written inside a code span is code, not a formula.
    expect(scan('use `$x$` here', [{ from: 4, to: 9 }])).toEqual([])
  })

  it('finds several spans on one line', () => {
    expect(scan('$a$ and $b$').map((s) => s.tex)).toEqual(['a', 'b'])
  })
})

describe('findBlockMath', () => {
  it('spans the lines between $$ fences', () => {
    const lines = ['text', '$$', 'E = mc^2', '$$', 'more']
    expect(findBlockMath(lines)).toEqual([{ fromLine: 1, toLine: 3, tex: 'E = mc^2' }])
  })

  it('handles several blocks and ignores an unclosed one', () => {
    const lines = ['$$', 'a', '$$', '$$', 'b', '$$', '$$', 'dangling']
    const found = findBlockMath(lines)
    expect(found.map((b) => b.tex)).toEqual(['a', 'b'])
  })

  it('ignores single-line $$…$$, which is inline math', () => {
    expect(findBlockMath(['$$E = mc^2$$'])).toEqual([])
  })
})
