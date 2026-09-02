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
import { fileKind, isTextName } from '@/lib/filetypes'
import { extractTitle, fileStem, splitFrontmatter } from '@/lib/wiki'

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

/** The nodes a selection lights up: itself, and everything it touches.
 *
 *  What is NOT in here is dimmed, and a dimmed node answers nothing — pointing
 *  at one while a selection is held leaves the card showing what it showed.
 *  Otherwise a sweep across a dense graph would flip the card through every
 *  unrelated page between the pointer and where it was going. */
export function litAround(
  selected: string | null,
  neighbors: ReadonlyMap<string, Set<string>>,
): Set<string> {
  if (selected === null) return new Set()
  return new Set([selected, ...(neighbors.get(selected) ?? [])])
}

/** How much of a page the card shows. A preview answers "is this the note I
 *  think it is", which the first screens settle; the whole file is one click
 *  away, and rendering an arbitrarily long note on every hover is not. */
export const PREVIEW_CHARS = 8000

export type GraphPreview =
  | { kind: 'page'; path: string; title: string; body: string; truncated: boolean }
  | { kind: 'binary'; path: string; title: string; format: string }
  | { kind: 'tag'; tag: string; pages: string[] }

export interface PreviewSources {
  /** A page's text as the index already holds it — no file read. Null when the
   *  index has none, which is what a node whose file has just gone away looks
   *  like; it renders as an empty preview rather than as an error. */
  content: (path: string) => string | null
  /** Every page carrying a tag. */
  tagged: (tag: string) => string[]
}

/**
 * What the card says about one node.
 *
 * Pure: the component resolves the node and hands over the text the index
 * already has, so what the card shows can be tested without a browser — the
 * same split as the rest of this file, where the view owns d3 and this owns
 * what is in the picture.
 */
export function graphPreview(node: GraphDatum, src: PreviewSources): GraphPreview {
  if (node.kind === 'tag') {
    const tag = node.tag ?? ''
    return { kind: 'tag', tag, pages: src.tagged(tag) }
  }
  const path = node.id
  // Today every graph node is a markdown page, so this only ever takes the text
  // branch. It asks the question anyway because the answer is a property of the
  // path and nothing else — a card that renders whatever it is handed cannot
  // start showing a PDF's bytes as mojibake if the graph ever draws one.
  if (!isTextName(path)) {
    return { kind: 'binary', path, title: fileStem(path), format: formatLabel(path) }
  }
  const content = src.content(path) ?? ''
  const { body } = splitFrontmatter(content)
  const text = body.trim()
  const truncated = text.length > PREVIEW_CHARS
  return {
    kind: 'page',
    path,
    title: extractTitle(content) ?? fileStem(path),
    // Cut at a line boundary: stopping mid-fence would render the rest of the
    // preview as one unterminated code block.
    body: truncated ? cutAtLine(text, PREVIEW_CHARS) : text,
    truncated,
  }
}

/** This file in one word: its extension, which is what people call it. Falls
 *  back to the classification for a name that has no extension at all — and
 *  upper-cased, so the sentence it lands in needs no article to agree with
 *  (`a PDF` and `an EPUB` would). */
function formatLabel(path: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]
  return ext ? ext.toUpperCase() : fileKind(path)
}

function cutAtLine(text: string, at: number): string {
  const head = text.slice(0, at)
  const nl = head.lastIndexOf('\n')
  return nl > at / 2 ? head.slice(0, nl) : head
}
