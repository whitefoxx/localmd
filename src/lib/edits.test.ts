import { describe, it, expect } from 'vitest'
import { applyEdit } from './edits'

describe('applyEdit', () => {
  it('replaces a unique occurrence', () => {
    const r = applyEdit('a b c', 'b', 'X')
    expect(r).toEqual({ ok: true, content: 'a X c', count: 1 })
  })
  it('rejects a missing old_string', () => {
    const r = applyEdit('a b c', 'z', 'X')
    expect(r.ok).toBe(false)
  })
  it('rejects ambiguous matches without replace_all', () => {
    const r = applyEdit('x y x', 'x', 'z')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('2 times')
  })
  it('replaces all occurrences with replace_all', () => {
    const r = applyEdit('x y x', 'x', 'z', true)
    expect(r).toEqual({ ok: true, content: 'z y z', count: 2 })
  })
  it('rejects empty and no-op edits', () => {
    expect(applyEdit('a', '', 'b').ok).toBe(false)
    expect(applyEdit('a', 'a', 'a').ok).toBe(false)
  })
  it('is literal, not regex', () => {
    const r = applyEdit('price is $1.00 (x)', '$1.00 (x)', '$2.00 [y]')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content).toBe('price is $2.00 [y]')
  })
})
