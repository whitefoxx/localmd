import { describe, it, expect } from 'vitest'
import {
  buildGraphData,
  graphDegrees,
  graphPreview,
  litAround,
  tagQuery,
  PREVIEW_CHARS,
  TAG_PREFIX,
  type GraphDatum,
} from './graphData'

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

describe('litAround', () => {
  const { neighbors } = graphDegrees([
    { source: 'a.md', target: 'b.md' },
    { source: 'b.md', target: 'c.md' },
  ])

  it('lights the selected node and everything it touches', () => {
    expect([...litAround('b.md', neighbors)].sort()).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('does not reach a node two hops away', () => {
    expect(litAround('a.md', neighbors).has('c.md')).toBe(false)
  })

  it('lights a node nothing links — itself, and only itself', () => {
    expect([...litAround('lonely.md', neighbors)]).toEqual(['lonely.md'])
  })

  it('lights nothing when nothing is selected', () => {
    expect(litAround(null, neighbors).size).toBe(0)
  })
})

describe('graphPreview', () => {
  const page = (id: string): GraphDatum => ({ id, kind: 'page' })
  const from = (
    content: string | null,
    tagged: string[] = [],
  ): { content: () => string | null; tagged: () => string[] } => ({
    content: () => content,
    tagged: () => tagged,
  })

  it('takes the title from frontmatter and keeps it out of the body', () => {
    const p = graphPreview(
      page('wiki/a.md'),
      from('---\ntitle: Scaling laws\ntype: concept\n---\n\nThe body.\n'),
    )
    expect(p).toEqual({
      kind: 'page',
      path: 'wiki/a.md',
      title: 'Scaling laws',
      body: 'The body.',
      truncated: false,
    })
  })

  it('falls back to the file stem when the page names no title', () => {
    const p = graphPreview(page('wiki/notes/no-title.md'), from('just text'))
    expect(p.kind === 'page' && p.title).toBe('no-title')
  })

  it('reads as an empty page, not an error, when the index has no text for it', () => {
    const p = graphPreview(page('wiki/gone.md'), from(null))
    expect(p).toMatchObject({ kind: 'page', body: '', truncated: false })
  })

  it('cuts a long page at a line boundary, so a fence cannot be left open', () => {
    const p = graphPreview(page('wiki/long.md'), from(`${'x'.repeat(40)}\n`.repeat(400)))
    expect(p.kind === 'page' && p.truncated).toBe(true)
    expect(p.kind === 'page' && p.body.length).toBeLessThanOrEqual(PREVIEW_CHARS)
    expect(p.kind === 'page' && p.body.endsWith('x')).toBe(true)
  })

  it('keeps a page that is exactly at the cap whole', () => {
    const p = graphPreview(page('wiki/edge.md'), from('y'.repeat(PREVIEW_CHARS)))
    expect(p.kind === 'page' && p.truncated).toBe(false)
  })

  it('says a non-text file is not text instead of showing its bytes', () => {
    const p = graphPreview(page('raw/books/思考.pdf'), from('%PDF-1.4 binary junk'))
    expect(p).toEqual({
      kind: 'binary',
      path: 'raw/books/思考.pdf',
      title: '思考',
      format: 'PDF',
    })
  })

  it('names a file by its extension, and by its kind when it has none', () => {
    const fmt = (path: string): string => {
      const p = graphPreview(page(path), from(null))
      return p.kind === 'binary' ? p.format : 'not binary'
    }
    expect(fmt('assets/shot.PNG')).toBe('PNG')
    expect(fmt('raw/book.epub')).toBe('EPUB')
    expect(fmt('notes/README')).toBe('not binary') // no extension reads as text
  })

  it('answers a tag with the pages carrying it, never with content', () => {
    const node: GraphDatum = { id: `${TAG_PREFIX}llm`, kind: 'tag', tag: 'llm' }
    expect(graphPreview(node, from(null, ['wiki/a.md']))).toEqual({
      kind: 'tag',
      tag: 'llm',
      pages: ['wiki/a.md'],
    })
  })
})
