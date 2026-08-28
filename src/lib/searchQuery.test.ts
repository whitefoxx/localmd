import { describe, it, expect } from 'vitest'
import { parseSearchQuery, matchesFilters } from './searchQuery'

describe('parseSearchQuery', () => {
  it('extracts type and tag filters and leaves the text', () => {
    expect(parseSearchQuery('type:concept scaling')).toEqual({
      typeFilter: 'concept',
      tagFilter: '',
      text: 'scaling',
    })
    expect(parseSearchQuery('tag:llm type:"person page" alice')).toEqual({
      typeFilter: 'person page',
      tagFilter: 'llm',
      text: 'alice',
    })
  })

  it('lowercases filters and handles quoted tags', () => {
    expect(parseSearchQuery('TAG:"Deep Learning"').tagFilter).toBe('deep learning')
  })

  it('returns empty filters for a plain query', () => {
    expect(parseSearchQuery('just words')).toEqual({
      typeFilter: '',
      tagFilter: '',
      text: 'just words',
    })
  })
})

describe('matchesFilters', () => {
  const parsed = { typeFilter: 'concept', tagFilter: 'llm' }
  it('requires both filters to hold', () => {
    expect(matchesFilters(parsed, 'concept', ['llm-agents'])).toBe(true)
    expect(matchesFilters(parsed, 'concept', ['prompting'])).toBe(false)
    expect(matchesFilters(parsed, 'person', ['llm'])).toBe(false)
  })
  it('matches by substring, case-insensitively', () => {
    expect(matchesFilters({ typeFilter: '', tagFilter: 'learn' }, null, ['Deep-Learning'])).toBe(
      true,
    )
  })
  it('passes everything when no filters are set', () => {
    expect(matchesFilters({ typeFilter: '', tagFilter: '' }, null, undefined)).toBe(true)
  })
})
