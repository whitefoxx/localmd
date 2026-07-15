import { describe, it, expect } from 'vitest'
import { parseTypeSchema, resolveType, schemaColor } from './kbTypes'

const SCHEMA = `
types:
  - name: concept
    dir: wiki/concepts
    color: "#7c9cff"
  - name: source
    dir: wiki/sources/
  - name: entity
`

describe('parseTypeSchema', () => {
  it('parses entries, trims dir slashes, keeps optional fields', () => {
    const s = parseTypeSchema(SCHEMA)!
    expect(s.entries).toEqual([
      { name: 'concept', dir: 'wiki/concepts', color: '#7c9cff' },
      { name: 'source', dir: 'wiki/sources' },
      { name: 'entity' },
    ])
  })

  it('is tolerant: bad YAML → null, typeless doc → empty, nameless entries skipped', () => {
    expect(parseTypeSchema('a: [1, 2\n  bad: :')).toBeNull()
    expect(parseTypeSchema('other: 1')!.entries).toEqual([])
    expect(parseTypeSchema('types:\n  - dir: x\n  - name: ok')!.entries).toEqual([{ name: 'ok' }])
  })
})

describe('resolveType', () => {
  const s = parseTypeSchema(SCHEMA)

  it('frontmatter type wins over the schema dir', () => {
    expect(resolveType('wiki/concepts/a.md', 'source', s)).toBe('source')
  })

  it('falls back to the deepest matching schema dir', () => {
    const nested = parseTypeSchema(
      'types:\n  - {name: a, dir: wiki}\n  - {name: b, dir: wiki/concepts}',
    )
    expect(resolveType('wiki/concepts/x.md', null, nested)).toBe('b')
    expect(resolveType('wiki/notes/x.md', null, nested)).toBe('a')
  })

  it('returns null when nothing matches, or with no schema', () => {
    expect(resolveType('raw/x.md', null, s)).toBeNull()
    expect(resolveType('wiki/concepts/a.md', null, null)).toBeNull()
    expect(resolveType('wiki/concepts/a.md', 'concept', null)).toBe('concept')
  })
})

describe('schemaColor', () => {
  const s = parseTypeSchema(SCHEMA)
  it('returns the schema color or null', () => {
    expect(schemaColor('concept', s)).toBe('#7c9cff')
    expect(schemaColor('source', s)).toBeNull()
    expect(schemaColor('concept', null)).toBeNull()
  })
})
