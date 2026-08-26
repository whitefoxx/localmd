import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { gate, toolRestricted, restrictedToolResult } from './gate'

/**
 * The seam's shape, which every edition owes and no edition may restate.
 *
 * These look trivial and are not. The gate is read from two places with
 * different unwrapping rules — a template, which unwraps a ref, and plain
 * script, which does not — and TypeScript cannot tell the two apart inside a
 * truthiness test: `gate.restricted && …` on a ref object compiles clean and is
 * always true. When `restricted` was briefly an exported ComputedRef, every
 * installed tool row read "needs a licence" while a valid licence sat in
 * Settings, and typecheck, 1141 unit tests and 52 e2e runs all stayed green.
 * Only opening the app showed it.
 *
 * So the contract is the primitive, not the box: whatever answers this seam
 * must answer with a `boolean`.
 */
describe('the edition gate', () => {
  beforeEach(() => {
    globalThis.localStorage ??= {
      getItem: () => null,
      setItem: () => {},
    } as unknown as Storage
    setActivePinia(createPinia())
  })

  it('answers `restricted` with a boolean, not something holding one', () => {
    expect(typeof gate.restricted).toBe('boolean')
  })

  it('answers `toolRestricted` with a boolean for a licensed and a free tool alike', () => {
    expect(typeof toolRestricted('git_push')).toBe('boolean')
    expect(typeof toolRestricted('read_file')).toBe('boolean')
  })

  it('never gates a tool the paid tier does not cover', () => {
    // True in every edition: one has no paid tier, the other does not charge
    // for spending your own key in your own folder.
    expect(toolRestricted('read_file')).toBe(false)
    expect(toolRestricted('run_subagent')).toBe(false)
    expect(toolRestricted('git_commit')).toBe(false)
  })

  it('names the tool it refused, so the model can say which one', () => {
    expect(restrictedToolResult('git_push')).toContain('git_push')
  })
})
