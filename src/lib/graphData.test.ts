import { describe, it, expect } from 'vitest'
import { buildGraphData, graphDegrees, tagQuery, TAG_PREFIX } from './graphData'

const GRAPH = {
  nodes: ['wiki/a.md', 'wiki/b.md', 'wiki/c.md'],
  links: [{ source: 'wiki/a.md', target: 'wiki/b.md' }],
}
const TYPES = new Map([['wiki/a.md', 'concept']])
const TAGS = new Map([
  ['wiki/a.md', ['llm', 'prompting']],
  ['wiki/b.md', ['llm']],
  ['raw/gone.md', ['orphan-tag']],
])

describe('buildGraphData', () => {
  it('draws pages only when tags are off', () => {
    const g = buildGraphData(GRAPH, TYPES, TAGS, false)
    expect(g.nodes.map((n) => n.id)).toEqual(GRAPH.nodes)
    expect(g.nodes.every((n) => n.kind === 'page')).toBe(true)
    expect(g.links).toEqual(GRAPH.links)
  })

  it('adds one node per distinct tag, and an edge per page carrying it', () => {
    const g = buildGraphData(GRAPH, TYPES, TAGS, true)
    expect(g.nodes.filter((n) => n.kind === 'tag').map((n) => n.tag)).toEqual(['llm', 'prompting'])
    expect(g.links).toEqual([
      { source: 'wiki/a.md', target: 'wiki/b.md' },
      { source: 'wiki/a.md', target: `${TAG_PREFIX}llm` },
      { source: 'wiki/a.md', target: `${TAG_PREFIX}prompting` },
      { source: 'wiki/b.md', target: `${TAG_PREFIX}llm` },
    ])
  })

  /** d3-force throws on an edge to a node that isn't in the list, so a tag on
   *  a file the graph does not draw must not produce one. */
  it('ignores tags on pages the graph does not contain', () => {
    const g = buildGraphData(GRAPH, TYPES, TAGS, true)
    expect(g.links.some((l) => l.source === 'raw/gone.md')).toBe(false)
    expect(g.nodes.some((n) => n.tag === 'orphan-tag')).toBe(false)
  })

  /** Every edge must name nodes that exist — the invariant d3 enforces by
   *  throwing, checked here where the failure is readable. */
  it('never produces an edge to a node that is not in the list', () => {
    const g = buildGraphData(GRAPH, TYPES, TAGS, true)
    const ids = new Set(g.nodes.map((n) => n.id))
    for (const l of g.links) {
      expect(ids.has(l.source)).toBe(true)
      expect(ids.has(l.target)).toBe(true)
    }
  })

  it('carries page types through and leaves tags untyped', () => {
    const g = buildGraphData(GRAPH, TYPES, TAGS, true)
    expect(g.nodes.find((n) => n.id === 'wiki/a.md')?.type).toBe('concept')
    expect(g.nodes.find((n) => n.kind === 'tag')?.type).toBeUndefined()
  })
})

describe('graphDegrees', () => {
  it('counts both ends and relates them both ways', () => {
    const { degree, neighbors } = graphDegrees(buildGraphData(GRAPH, TYPES, TAGS, true).links)
    expect(degree.get('wiki/a.md')).toBe(3) // b, llm, prompting
    expect(degree.get(`${TAG_PREFIX}llm`)).toBe(2)
    expect(neighbors.get(`${TAG_PREFIX}llm`)).toEqual(new Set(['wiki/a.md', 'wiki/b.md']))
  })
})

describe('tagQuery', () => {
  it('quotes only when the tag has a space', () => {
    expect(tagQuery('llm')).toBe('tag:llm')
    expect(tagQuery('deep learning')).toBe('tag:"deep learning"')
  })
})
