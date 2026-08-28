/**
 * What the graph view draws, as data.
 *
 * Pulled out of the component so the shape of the graph can be tested without
 * a browser: the view owns d3, the forces and the paint order, this owns what
 * is in the picture.
 *
 * Two kinds of node share one list. `kind` — never the shape of the id —
 * decides how one behaves, so a page that happens to be named like a tag id
 * is still a page. The prefix only keeps the Maps apart.
 */
export const TAG_PREFIX = 'tag::'

export interface GraphDatum {
  id: string
  kind: 'page' | 'tag'
  /** Pages carry their OKF `type:`; tags carry the bare tag. */
  type?: string | null
  tag?: string
}

export interface GraphEdge {
  source: string
  target: string
}

export interface GraphInput {
  nodes: readonly string[]
  links: readonly GraphEdge[]
}

/**
 * @param tags path → its frontmatter tags. Only pages already in the graph
 *   are joined: a tag on a file the graph does not draw would be an edge to
 *   nowhere, and d3-force throws on those rather than ignoring them.
 */
export function buildGraphData(
  graph: GraphInput,
  types: ReadonlyMap<string, string>,
  tags: ReadonlyMap<string, string[]>,
  showTags: boolean,
): { nodes: GraphDatum[]; links: GraphEdge[] } {
  const nodes: GraphDatum[] = graph.nodes.map((id) => ({
    id,
    kind: 'page',
    type: types.get(id) ?? null,
  }))
  const links: GraphEdge[] = graph.links.map((l) => ({ ...l }))
  if (!showTags) return { nodes, links }

  // Spellings are kept apart on purpose — `kb_health` reports near-duplicate
  // tags, and quietly merging them here would hide what it is trying to show.
  const pages = new Set(graph.nodes)
  const seen = new Set<string>()
  for (const [path, list] of tags) {
    if (!pages.has(path)) continue
    for (const tag of list) {
      const id = TAG_PREFIX + tag
      if (!seen.has(id)) {
        seen.add(id)
        nodes.push({ id, kind: 'tag', tag })
      }
      links.push({ source: path, target: id })
    }
  }
  return { nodes, links }
}

/** Undirected degree and adjacency, over whatever the graph currently holds. */
export function graphDegrees(links: readonly GraphEdge[]): {
  degree: Map<string, number>
  neighbors: Map<string, Set<string>>
} {
  const degree = new Map<string, number>()
  const neighbors = new Map<string, Set<string>>()
  const relate = (a: string, b: string): void => {
    let set = neighbors.get(a)
    if (!set) neighbors.set(a, (set = new Set()))
    set.add(b)
  }
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
    relate(l.source, l.target)
    relate(l.target, l.source)
  }
  return { degree, neighbors }
}

/** The search a tag node stands for. Quoted when the tag has a space, since
 *  the palette's grammar splits an unquoted filter at the first one. */
export function tagQuery(tag: string): string {
  return `tag:${/\s/.test(tag) ? `"${tag}"` : tag}`
}
