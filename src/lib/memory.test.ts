import { describe, it, expect } from 'vitest'
import { normalizeMemory, MEMORY_FILE } from './memory'

describe('memory', () => {
  it('lives at a fixed path in the KB root', () => {
    expect(MEMORY_FILE).toBe('MEMORY.md')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeMemory('\n\n# Memory\n\n- likes tea\n')).toBe('# Memory\n\n- likes tea')
  })

  it('treats absent, empty, and whitespace-only files as no memory', () => {
    expect(normalizeMemory(null)).toBeNull()
    expect(normalizeMemory('')).toBeNull()
    expect(normalizeMemory('   \n\t\n')).toBeNull()
  })
})
