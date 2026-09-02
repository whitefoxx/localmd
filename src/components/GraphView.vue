<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, nextTick, ref, shallowRef, watch } from 'vue'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
} from 'd3-force'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, zoomTransform } from 'd3-zoom'
import { drag } from 'd3-drag'
import { useKbIndexStore } from '@/stores/kbIndex'
import { useFilesStore } from '@/stores/files'
import { useUiStore } from '@/stores/ui'
import { fileStem } from '@/lib/wiki'
import {
  buildGraphData,
  graphDegrees,
  graphPreview,
  litAround,
  tagQuery,
  type GraphDatum,
  type GraphPreview,
} from '@/lib/graphData'
import GraphPreviewCard from '@/components/GraphPreviewCard.vue'
import { typeColor } from '@/lib/typeColor'
import { openInEditor } from '@/lib/openInEditor'

interface GraphNode extends GraphDatum {
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}
interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
}

const index = useKbIndexStore()
const files = useFilesStore()
const ui = useUiStore()

const host = ref<HTMLElement | null>(null)
/** The card's frame. Measured, not assumed: its left edge is where the space
 *  the graph still has to itself ends. */
const cardFrame = ref<HTMLElement | null>(null)
let sim: Simulation<GraphNode, GraphLink> | null = null
/** Re-fit the current drawing to the container. Set by render(); calling it
 *  is much cheaper than rebuilding the graph, and it keeps every node where
 *  the user last saw it. */
let refit: (() => void) | null = null
/** Stops the previous render's watch on the legend filter. */
let stopTypeWatch: (() => void) | null = null
/** Bring a node into the part of the frame the card is not covering. Set by
 *  render(), which owns the zoom behaviour it has to move. */
let centerOn: ((id: string) => void) | null = null
/** Push the selection state at the current drawing — dimming and ring. Set by
 *  render(), because everything it needs is built there and thrown away with
 *  it; the watch at the bottom of this file is the only caller. */
let applyFocus: (() => void) | null = null
/** Every node in the current drawing, by id. Outside render() so the card can
 *  hand back a path — drilling into a tag's page list — and be understood, and
 *  reactive because the card also asks whether what it is showing is on the
 *  graph at all. */
const nodesById = shallowRef(new Map<string, GraphNode>())
/** Everything the selection lights up. Written by applyFocus, read both by the
 *  hover handler and by the card, which offers to go and find a node that is
 *  NOT in here. */
const lit = shallowRef(new Set<string>())

/**
 * Whether the layout is still being worked out.
 *
 * It covers both halves of the wait, because both of them look like nothing
 * happening: building the graph blocks the thread (so the line is painted
 * BEFORE that starts, or it would never appear at all), and then the force
 * simulation spends a second or two pulling everything apart. An earlier
 * version cleared this on the simulation's first tick — which arrives
 * immediately after the build — so it flashed for one frame and was gone
 * before the slow part had begun.
 *
 * Only for a graph big enough to be worth saying it about — a handful of nodes
 * lands where it lands and the line would be noise over it.
 */
const laying = ref(false)
const HEAVY_NODES = 25

/**
 * Which node the graph is currently ABOUT, and which one the card is showing.
 *
 * Two ids rather than one, because they answer different questions.
 * `ui.graphSelected` is what a click pinned: it decides the dimming, and it
 * holds still while the pointer wanders, so the neighbourhood you are reading
 * stays the one you asked for. `previewId` is what the card is about, and it
 * follows the pointer across that neighbourhood — hovering a neighbour swaps
 * the card without re-aiming the graph under it, and then STAYS there, because
 * the card has to be reachable by a pointer that is no longer on the node.
 * Both null is the resting state, where hover alone lights the graph up
 * exactly as it always did.
 *
 * Refs and not closure state: render() throws its DOM away and rebuilds it
 * whenever the graph changes, and a selection has to survive that.
 */
const previewId = ref<string | null>(null)
const hoverId = ref<string | null>(null)
/** The node behind `previewId`. Held beside the id so the card renders from
 *  the index alone — no file read, nothing to await, nothing to go stale. */
const previewNode = ref<GraphDatum | null>(null)

const preview = computed<GraphPreview | null>(() =>
  previewNode.value
    ? graphPreview(previewNode.value, {
        content: (path) => index.pages.get(path)?.content ?? null,
        tagged: (tag) => [...index.tags].filter(([, l]) => l.includes(tag)).map(([p]) => p).sort(),
      })
    : null,
)

/** Pages entered by following a link inside the card, oldest first. Only link
 *  navigation is recorded: pointing at a node is a new subject rather than a
 *  step in a trail, so it starts one over. */
const trail = ref<string[]>([])

/** Point the card at a node — or at nothing — as a fresh subject. */
function show(id: string | null): void {
  trail.value = []
  goto(id)
}

function goto(id: string | null): void {
  previewId.value = id
  // A link can leave the graph: wikilinks resolve to any file, and the graph
  // draws only markdown pages. The card describes the path either way — it is
  // the `kind: 'binary'` branch that says a PDF has no text to show — and the
  // solid mark simply has no node to sit on, which is the truth.
  previewNode.value = id ? (nodesById.value.get(id) ?? { id, kind: 'page' }) : null
}

/** Follow a link out of the card. The graph stays where it is: you asked to
 *  read something, not to move the picture, so only the card and the mark that
 *  says what the card is showing travel. Back undoes exactly this. */
function follow(path: string): void {
  if (previewId.value) trail.value = [...trail.value, previewId.value]
  goto(path)
}

function back(): void {
  const prev = trail.value.at(-1)
  if (prev === undefined) return
  trail.value = trail.value.slice(0, -1)
  goto(prev)
}

/** Pin a node: the graph lights up around it, and the card is about it. */
function pin(id: string): void {
  ui.graphSelected = id
  show(id)
}

/**
 * Whether the card is about a node the graph is currently dimming.
 *
 * Following a link is how you get there: the page it names need not be a
 * neighbour of the pin, and a dimmed node — mark and all — is drawn at an
 * opacity that makes it effectively invisible. So the card stops pretending
 * you can see where it is, and offers to go there instead.
 */
const canLocate = computed(
  () =>
    !!previewId.value &&
    !!ui.graphSelected &&
    nodesById.value.has(previewId.value) &&
    !lit.value.has(previewId.value),
)

/** What the button does: exactly what clicking that node would have done —
 *  plus the part a click never needs, because a click happens where the
 *  pointer already is and this does not. */
function locate(): void {
  if (!previewId.value) return
  pin(previewId.value)
  centerOn?.(previewId.value)
}

function clearSelection(): void {
  ui.graphSelected = null
  show(null)
}

/** Leave the graph for the file the card is showing. The graph is reachable
 *  from inside the full-window agent panel, so the file has to be uncovered as
 *  well as opened — see lib/openInEditor. */
function openFromCard(path: string): void {
  ui.graphOpen = false
  void openInEditor(path)
}

/** A tag has no file to open, so its card offers the question it stands for
 *  instead — the same search a tag node used to run on click. The answer
 *  arrives ON TOP of the graph (the palette is z-50, this is z-40), so the
 *  neighbourhood you were comparing against is still there behind it. */
function searchTag(tag: string): void {
  ui.searchFor(tagQuery(tag))
}

/**
 * What the chip says, or null for nothing to say.
 *
 * Reading the knowledge base is the FIRST half of the wait and used to be the
 * silent one: the panel mounts against whatever the index already has, which on
 * a cold one is nothing, so a KB of any size opened to a blank rectangle and
 * stayed there while every page was read. The chip only came up afterwards, for
 * the part that was already visibly happening.
 *
 * A refresh that runs while a graph is on screen says nothing — the graph is
 * still true, and a chip flashing on every window focus is noise.
 */
const busy = computed<'reading' | 'laying' | null>(() =>
  index.refreshing && index.graph.nodes.length === 0 ? 'reading' : laying.value ? 'laying' : null,
)
/** Alpha below which the graph has stopped visibly moving. The simulation runs
 *  on to ~0.001, long after it is readable; waiting for that would hold the
 *  line up over a graph that has plainly arrived. */
const SETTLED_ALPHA = 0.2

/** How far the graph steps back while one node is focused. Dimmed, not hidden:
 *  the shape of the rest is the context that makes the focused cluster mean
 *  something. Links go further down than nodes because a thin line at the same
 *  opacity still reads as a line. */
const DIM_NODES = 0.12
const DIM_LINKS = 0.07

/** What a node not of the chosen type is drawn in. Opaque, and a colour rather
 *  than a transparency, because the focus above already spends opacity and two
 *  opacities MULTIPLY: with both on, a stepped-back link sat at 0.07 × 0.07,
 *  which is not stepped back, it is gone. At that depth the compositor also
 *  rounds a pixel in or out between frames, which is what made a filtered graph
 *  shimmer while nothing at all was happening. Different channels compose; the
 *  same channel twice does not. */
const MUTED = 'rgb(var(--c-bg-3))'

/** How big a node is drawn: the more it is linked, the bigger. Square-rooted
 *  so a hub stands out without swallowing the page — area, not radius, tracks
 *  the degree — and capped so one runaway index page stays a circle. */
/** How hard the middle of the frame pulls every node toward it.
 *
 *  This replaces forceCenter, which centres on the CENTROID: a few unlinked
 *  nodes drifting to one side move the centroid, and forceCenter then slides
 *  the whole picture the other way — the connected cluster, the thing anyone
 *  opened the graph to look at, ends up against an edge. A tether to the
 *  real middle has no such feedback: it pulls everything to the same point,
 *  weakly enough that links still decide the shape. */
function tether(): number {
  return 0.05
}

function radiusOf(degree: number): number {
  return Math.min(24, 3 + 4.2 * Math.sqrt(degree))
}

/** Paint the "laying out" line before the layout blocks the thread, then
 *  render. Two frames of latency for the heavy case only. */
async function renderMaybeSlow(): Promise<void> {
  if (index.graph.nodes.length <= HEAVY_NODES) {
    laying.value = false
    render()
    return
  }
  laying.value = true
  await nextTick()
  // The frame is what we are waiting for, the timer is so we cannot wait
  // forever: a tab in the background is never animated, and a graph that never
  // renders is a worse answer than one that renders without the line.
  await new Promise((resolve) => {
    const go = (): void => resolve(null)
    requestAnimationFrame(go)
    setTimeout(go, 50)
  })
  render()
}

function render(): void {
  const el = host.value
  if (!el) return
  // Stop the previous run before its elements are thrown away. d3 drives every
  // simulation from one shared timer loop, so a stale one left ticking against
  // detached nodes does not merely waste work — it starves the loop the new
  // simulation is waiting in, and the fresh graph sits frozen on its initial
  // spiral. Nothing re-rendered a live graph until the tag toggle, which is
  // why this went unnoticed.
  sim?.stop()
  sim = null
  el.innerHTML = ''
  const width = el.clientWidth
  const height = el.clientHeight

  const built = buildGraphData(index.graph, index.types, index.tags, ui.graphTags)
  const nodes: GraphNode[] = built.nodes
  const links: GraphLink[] = built.links.map((l) => ({ ...l }))
  const { degree, neighbors } = graphDegrees(built.links)

  const svg = select(el)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [0, 0, width, height])

  // The svg is sized in pixels at render time, so a window resize would
  // otherwise leave it at its old size — a band down one side where nodes
  // can never appear, and a centre force still pulling at the old middle.
  refit = (): void => {
    const w = el.clientWidth
    const h = el.clientHeight
    if (!w || !h) return
    svg.attr('width', w).attr('height', h).attr('viewBox', [0, 0, w, h])
    sim?.force('x', forceX<GraphNode>(w / 2).strength(tether()))
    sim?.force('y', forceY<GraphNode>(h / 2).strength(tether()))
    // A nudge, not a relayout: the graph settles into the new frame from
    // where it is rather than jumping to a fresh arrangement.
    sim?.alpha(0.3).restart()
  }

  const g = svg.append('g')

  /**
   * Four layers, in paint order: every link, every node, then the two the
   * focused subset is lifted into.
   *
   * Focus is opacity on the two BASE LAYERS — one element each — and never on
   * the elements inside them. Group opacity is applied when the layer is
   * painted, so nothing below it is restyled, and the cost stops depending on
   * how big the graph is. Measured on 1200 nodes / 3000 links: ~100ms of style
   * recalculation per hover writing opacity element by element (the first
   * version of this, and enough to make a sweep across a dense graph stutter),
   * ~43ms via a class on the container, 0.5ms this way — with a worst frame
   * indistinguishable from an idle one.
   */
  const linkLayer = g.append('g').attr('stroke', 'rgb(var(--c-border))').attr('stroke-width', 1)
  const nodeLayer = g.append('g')
  const litLinkLayer = g.append('g').attr('stroke', 'rgb(var(--c-border))').attr('stroke-width', 1)
  const litNodeLayer = g.append('g')
  const baseLinks = linkLayer.node() as SVGGElement
  const baseNodes = nodeLayer.node() as SVGGElement
  const topLinks = litLinkLayer.node() as SVGGElement
  const topNodes = litNodeLayer.node() as SVGGElement

  // Kept, rather than called and forgotten: moving the view from code means
  // handing the new transform back to the same behaviour, or the next drag
  // would resume from where the user last left it and jump.
  const zoomer = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 4])
    .on('zoom', (e) => g.attr('transform', e.transform))
  svg.call(zoomer as never)
  svg.call((sel) => sel.property('__zoom', zoomIdentity))

  /**
   * Put a node in the middle of the space the card leaves.
   *
   * Not the middle of the frame: the card is docked over the right of it, and
   * centring a node you were just told to go and find UNDER the thing that
   * told you would be the joke. The card is measured rather than assumed —
   * it has a max-width, so on a narrow window it is not the width it declares.
   *
   * The scale is left alone. Zoom is the user's; this is being asked where to
   * look, not how close.
   */
  centerOn = (id: string): void => {
    const d = nodesById.value.get(id)
    const svgEl = svg.node()
    if (!d || !svgEl || d.x === undefined || d.y === undefined) return
    const free = cardFrame.value
      ? cardFrame.value.getBoundingClientRect().left - el.getBoundingClientRect().left
      : el.clientWidth
    const k = zoomTransform(svgEl).k
    // A window too narrow to have a free half still has a left edge; putting
    // the node against it beats leaving it wherever it happened to be.
    const tx = Math.max(free / 2, 60)
    zoomer.transform(
      svg as never,
      zoomIdentity.translate(tx - k * d.x, el.clientHeight / 2 - k * d.y).scale(k),
    )
  }

  const link = linkLayer.selectAll<SVGLineElement, GraphLink>('line').data(links).join('line')

  const node = nodeLayer
    .selectAll<SVGGElement, GraphNode>('g')
    .data(nodes)
    .join('g')
    .attr('class', 'graph-node')
    .attr('cursor', 'pointer')
    // A click pins the node rather than leaving for it. Opening the file was
    // the old behaviour, and it threw away the picture that was clicked from:
    // the neighbourhood is the reason the graph is open, so pointing at
    // something in it now answers beside it. Leaving is the card's own button,
    // which makes it a decision instead of a side effect of pointing.
    .on('click', (e, d) => {
      e.stopPropagation()
      pin(d.id)
    })

  const nodeRadius = (d: GraphNode): number =>
    d.kind === 'tag'
      ? Math.min(11, 4 + 1.6 * Math.sqrt(degree.get(d.id) ?? 0))
      : radiusOf(degree.get(d.id) ?? 0)

  // Pages are circles; tags are diamonds. Shape rather than colour alone, so
  // the two kinds stay apart for anyone who cannot rely on hue — and because
  // colour here already means the page's `type:`.
  /** A page's own colour: the file you are in, else its `type:`, else nothing
   *  in particular. Named because the legend puts it back after taking it. */
  const pageFill = (d: GraphNode): string =>
    d.id === files.currentPath
      ? 'rgb(var(--c-accent))'
      : d.type
        ? typeColor(d.type)
        : 'rgb(var(--c-fg-3))'

  node
    .filter((d) => d.kind === 'page')
    .append('circle')
    .attr('class', 'node-dot')
    .attr('r', nodeRadius)
    .attr('fill', pageFill)

  node
    .filter((d) => d.kind === 'tag')
    .append('rect')
    .attr('class', 'node-dot')
    .attr('width', (d) => nodeRadius(d) * 1.6)
    .attr('height', (d) => nodeRadius(d) * 1.6)
    .attr('x', (d) => -nodeRadius(d) * 0.8)
    .attr('y', (d) => -nodeRadius(d) * 0.8)
    .attr('rx', 2)
    .attr('transform', 'rotate(45)')
    .attr('fill', 'rgb(var(--c-bg-0))')
    .attr('stroke', 'rgb(var(--c-added))')
    .attr('stroke-width', 1.5)

  node
    .append('text')
    .text((d) => (d.kind === 'tag' ? `#${d.tag}` : fileStem(d.id)))
    .attr('font-size', 10)
    .attr('dx', (d) => nodeRadius(d) + 5)
    .attr('dy', 3)
    .attr('fill', (d) => (d.kind === 'tag' ? 'rgb(var(--c-added))' : 'rgb(var(--c-fg-2))'))

  // --- Focus: point at one node and the rest of the graph steps back ---------
  //
  // What the graph is lit around — the pinned selection if there is one, else
  // whatever the pointer is over. Null is the resting state, where everything
  // is drawn at full strength; a dense graph is otherwise unreadable one node
  // at a time.
  let focus: string | null = null
  let dragging = false
  /** What is currently lifted, and where to put it back: its layer and the
   *  sibling it sat in front of. Restored in reverse so a recorded sibling is
   *  always home before the element that names it — which keeps paint order
   *  across a hover byte-identical, so which node is drawn on top of which
   *  never quietly changes under the pointer. */
  let lifted: [Element, SVGGElement, ChildNode | null][] = []
  /** The label currently drawn large, so it can be put back. */
  let enlarged: SVGTextElement | null = null

  /**
   * The legend's type filter, spent on COLOUR rather than on opacity: the
   * chosen type keeps its own colour and its name, everything else drains to
   * the neutral and goes anonymous. Links are left alone entirely — a link has
   * no type, and dimming the whole mesh because you picked one was what left a
   * filtered graph with no structure visible at all.
   *
   * The focus is exempt. What you are pointing at and what it touches are the
   * answer to the question the pointer is asking, and a filtered-out neighbour
   * is still a neighbour.
   */
  function isMuted(d: GraphNode): boolean {
    if (!ui.graphType || d.type === ui.graphType) return false
    return !(focus !== null && (d.id === focus || neighbors.get(focus)?.has(d.id)))
  }

  /** Redraw every node the way the legend and the focus currently want it.
   *  A whole-graph pass, but it WRITES only where the answer changed — so a
   *  hover with no filter on costs a read per node and nothing else, and one
   *  with a filter costs writes on the handful the focus just exempted. */
  function redress(): void {
    node.each(function (d) {
      const muted = isMuted(d)
      const dot = this.querySelector('.node-dot')
      if (dot) {
        const key = d.kind === 'tag' ? 'stroke' : 'fill'
        const want = muted ? MUTED : d.kind === 'tag' ? 'rgb(var(--c-added))' : pageFill(d)
        if (dot.getAttribute(key) !== want) dot.setAttribute(key, want)
      }
      const label = this.querySelector('text')
      if (label) {
        const want = muted ? 'none' : ''
        if (label.style.display !== want) label.style.display = want
      }
    })
  }
  redress()
  stopTypeWatch?.()
  stopTypeWatch = watch(() => ui.graphType, redress)

  const endId = (e: string | GraphNode): string => (typeof e === 'string' ? e : e.id)

  // id → its element, and id → the lines that touch it. Built once per render,
  // which is the only place they can go stale.
  const nodeEl = new Map<string, SVGGElement>()
  // Filled first, published once: a shallowRef notifies on assignment, so
  // handing out a map that is still being populated would let a reader cache
  // an answer taken from an empty one.
  const byId = new Map<string, GraphNode>()
  node.each(function (d) {
    nodeEl.set(d.id, this)
    byId.set(d.id, d)
  })
  nodesById.value = byId
  const linkEls = new Map<string, SVGLineElement[]>()
  link.each(function (d) {
    for (const end of [endId(d.source), endId(d.target)]) {
      const at = linkEls.get(end)
      if (at) at.push(this)
      else linkEls.set(end, [this])
    }
  })

  function setFocus(id: string | null): void {
    if (focus === id) return
    focus = id
    for (let i = lifted.length - 1; i >= 0; i--) {
      const [el, home, before] = lifted[i]
      home.insertBefore(el, before)
    }
    lifted = []
    if (enlarged) {
      enlarged.setAttribute('font-size', '10')
      enlarged.removeAttribute('font-weight')
      enlarged = null
    }
    if (id === null) {
      baseLinks.style.opacity = ''
      baseNodes.style.opacity = ''
    } else {
      baseLinks.style.opacity = String(DIM_LINKS)
      baseNodes.style.opacity = String(DIM_NODES)
    }
    // Nothing inside a layer carries an opacity of its own any more, so a
    // raise is only ever a re-parent: the layer it lands in decides how it is
    // painted, and the legend decides its colour (redress, below).
    const raise = (el: Element, home: SVGGElement, to: SVGGElement): void => {
      lifted.push([el, home, el.nextSibling])
      to.appendChild(el)
    }
    if (id === null) {
      redress()
      return
    }
    // Only the focused node's OWN lines: one between two lit neighbours is not
    // part of what you are pointing at. Lines first, and in their own layer
    // below the nodes', so a lifted line never covers a circle.
    for (const el of linkEls.get(id) ?? []) raise(el, baseLinks, topLinks)
    // Neighbours before the node itself, so the node you are pointing AT ends
    // up on top of everything this hover raised. Lifting a neighbour over it
    // instead hands the pointer to that neighbour — which focuses the
    // neighbour, which lifts this node back over it, which… the labels overlap,
    // and the graph flickers between two nodes for as long as you hold still.
    for (const nid of neighbors.get(id) ?? []) {
      const el = nodeEl.get(nid)
      if (el) raise(el, baseNodes, topNodes)
    }
    const self = nodeEl.get(id)
    if (self) {
      raise(self, baseNodes, topNodes)
      // The label is the answer to "what is this one" — hovering asks the
      // question, so it is worth reading without leaning in. Restored by the
      // reset at the top of this function.
      const label = self.querySelector('text')
      if (label) {
        enlarged = label
        label.setAttribute('font-size', '14')
        label.setAttribute('font-weight', '600')
      }
    }
    // Last, because it asks what the focus set is.
    redress()
  }

  // --- Two marks, because there are two answers on screen --------------------
  //
  // Solid, inner: the node the CARD is about. Dashed, outer: the node the
  // graph is lit AROUND. They are usually the same node and then read as one
  // double ring; they come apart the moment the pointer wanders onto a
  // neighbour, which is exactly when "why is the card showing this, but the
  // graph arranged around that" needs answering on the picture itself.
  //
  // One element each, moved between nodes, rather than a hidden pair on every
  // node. Each lives INSIDE its node's own `<g>`, so it travels with the node —
  // through every simulation tick, and through the re-parenting `raise()` does
  // when the focus changes. First child, so the label still draws over it.
  function mark(dashed: boolean): SVGCircleElement {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    c.setAttribute('fill', 'none')
    c.setAttribute('stroke', 'rgb(var(--c-accent))')
    c.setAttribute('stroke-width', dashed ? '1.5' : '2')
    if (dashed) c.setAttribute('stroke-dasharray', '2 3')
    c.style.pointerEvents = 'none'
    return c
  }
  const shownRing = mark(false)
  const pinnedRing = mark(true)

  function place(el: SVGCircleElement, id: string | null, pad: number): void {
    const g = id ? nodeEl.get(id) : null
    const d = id ? nodesById.value.get(id) : null
    if (!g || !d) {
      el.remove()
      return
    }
    el.setAttribute('r', String(nodeRadius(d) + pad))
    g.insertBefore(el, g.firstChild)
  }

  // The one place the state above becomes pixels. Everything else sets a ref.
  applyFocus = (): void => {
    lit.value = litAround(ui.graphSelected, neighbors)
    setFocus(ui.graphSelected ?? hoverId.value)
    place(pinnedRing, ui.graphSelected, 7)
    place(shownRing, previewId.value, 4)
  }

  node
    .on('mouseenter', (_e, d) => {
      hoverId.value = d.id
      // While a node is pinned the pointer moves the CARD only, and only across
      // what the pin lit up: a dimmed node is not part of the answer on screen,
      // so pointing at one says nothing rather than swapping the card to a page
      // the pointer was merely passing over.
      if (ui.graphSelected && lit.value.has(d.id)) show(d.id)
    })
    // A drag keeps its node: the pointer routinely outruns the node it is
    // pulling, and the graph re-lighting mid-drag is exactly the flicker this
    // is meant to remove. The pointer is still over it when the drag ends, so
    // the leave that clears the focus is the one after the user lets go.
    // Only the dimming answers to the pointer leaving, and only when nothing is
    // pinned. The card stays on whatever it was last asked about: reading it
    // means moving the pointer off the node to reach it, and a card that
    // emptied itself on the way over would be one you could never actually
    // read. The dashed mark is what keeps that honest — it stays on the pinned
    // node, so a card about a neighbour never looks like the graph moved.
    .on('mouseleave', () => {
      if (dragging) return
      hoverId.value = null
    })

  // Clicking the background puts the graph back as it was. d3's own drag and
  // zoom suppress the click that ends a pan or a node drag, so this only ever
  // hears a real click on empty space.
  svg.on('click', (e: MouseEvent) => {
    if ((e.target as Element | null)?.closest('.graph-node')) return
    clearSelection()
  })

  node.call(
    drag<SVGGElement, GraphNode>()
      .on('start', (e, d) => {
        if (!e.active) sim?.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
        dragging = true
        hoverId.value = d.id
      })
      .on('drag', (e, d) => {
        d.fx = e.x
        d.fy = e.y
      })
      .on('end', (e, d) => {
        if (!e.active) sim?.alphaTarget(0)
        d.fx = null
        d.fy = null
        dragging = false
        hoverId.value = d.id
      }) as never,
  )

  sim = forceSimulation<GraphNode>(nodes)
    .force(
      'link',
      forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance(130),
    )
    // Repulsion with a range: past this it contributes nothing, so a node with
    // no links is not shoved to the far corner by every other node at once.
    // Strong, because the tether below works against it and a graph that
    // reads as one clump is no more useful than one scattered to the edges.
    .force('charge', forceManyBody().strength(-900).distanceMax(700))
    // A tether to the middle, scaled by how alone a node is. forceCenter only
    // translates the whole cloud — it cannot pull a stray back in, because it
    // moves everything equally, and it centres on the CENTROID, so a handful
    // of unlinked nodes drifting off drag the whole picture after them.
    //
    // So the pull is strong for a node nothing links (it has no other reason
    // to be anywhere) and slack for one that does (its links already place
    // it). The cluster keeps its shape and stays in the middle of the frame.
    .force('x', forceX<GraphNode>(width / 2).strength(tether()))
    .force('y', forceY<GraphNode>(height / 2).strength(tether()))
    // Collision follows the drawn size, or the big nodes overlap each other.
    .force('collide', forceCollide<GraphNode>((d) => nodeRadius(d) + 14))
    .on('tick', () => {
      // Cleared when the graph stops moving, not when it starts (see `laying`).
      if (laying.value && (sim?.alpha() ?? 0) < SETTLED_ALPHA) laying.value = false
      link
        .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
        .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
        .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
        .attr('y2', (d) => (d.target as GraphNode).y ?? 0)
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })
    .on('end', () => (laying.value = false))

  // A rebuild throws every element away, so re-assert the selection over the
  // new drawing — and drop what the new graph no longer has. A page deleted
  // while the graph is open, or the tag nodes going away with the toggle, must
  // not leave a card describing something that is not on screen. The pointer is
  // not re-entered either, so a hover left over from the old drawing would dim
  // the graph around a node nothing is pointing at.
  hoverId.value = null
  if (ui.graphSelected && !nodesById.value.has(ui.graphSelected)) clearSelection()
  const keep =
    previewId.value &&
    nodesById.value.has(previewId.value) &&
    (!ui.graphSelected || litAround(ui.graphSelected, neighbors).has(previewId.value))
  show(keep ? previewId.value : ui.graphSelected)
  applyFocus()
}

let observer: ResizeObserver | null = null

onMounted(() => {
  // Paint immediately from the cached index; refresh in the background — the
  // graph watch below re-renders only if something actually changed (refresh
  // keeps the same Map reference when nothing did).
  void renderMaybeSlow()
  void index.refresh()
  if (host.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => refit?.())
    observer.observe(host.value)
  }
})

watch([() => index.graph, () => ui.graphTags], () => void renderMaybeSlow())
// Esc unpins from App.vue's layer chain, which knows the selection and not the
// card; the card follows it down rather than being left describing nothing.
// Declared first so that, within the same synchronous flush, the card is
// already empty by the time the ring is asked where to go.
watch(
  () => ui.graphSelected,
  (id) => {
    if (id === null) show(null)
  },
  { flush: 'sync' },
)
// Dimming and ring, pushed at the drawing the moment the state changes.
// Synchronously, because this is pointer work: hovering used to reach the DOM
// in the same tick as the event, and a queued watcher would put a frame of lag
// between the pointer and the graph lighting up under it.
watch([() => ui.graphSelected, previewId, hoverId], () => applyFocus?.(), { flush: 'sync' })

onBeforeUnmount(() => {
  stopTypeWatch?.()
  stopTypeWatch = null
  ui.graphType = null
  ui.graphTags = false
  clearSelection()
  hoverId.value = null
  applyFocus = null
  centerOn = null
  nodesById.value = new Map()
  lit.value = new Set()
  observer?.disconnect()
  observer = null
  refit = null
  sim?.stop()
  sim = null
})
</script>

<template>
  <div class="relative h-full w-full">
    <div ref="host" class="h-full w-full" />

    <!-- What the pinned node is. Docked rather than following the pointer: the
         card changes as the pointer crosses the neighbourhood, and a panel that
         jumped to each node in turn would be unreadable exactly while it is
         being used. pointer-events-none on the frame, so the graph underneath
         still takes a click everywhere the card itself is not. -->
    <div
      v-if="preview"
      ref="cardFrame"
      class="pointer-events-none absolute right-4 top-4 bottom-4 z-10 flex w-[360px] max-w-[calc(100%-2rem)] flex-col items-stretch"
    >
      <GraphPreviewCard
        :preview="preview"
        :can-go-back="trail.length > 0"
        :can-locate="canLocate"
        class="max-h-full"
        @follow="follow"
        @back="back"
        @locate="locate"
        @open="openFromCard"
        @search="searchTag"
        @select="pin"
        @close="clearSelection"
      />
    </div>
    <!-- Near the top of the graph area, not in its middle: forceCenter pulls
         every node into the centre, so that is the one place a line of text
         cannot be read. Same chip as the PDF reader's. -->
    <div v-if="busy" class="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
      <span
        class="flex items-center gap-2 rounded-full border border-border bg-bg-1/95 px-3 py-1.5 text-xs text-fg-2 shadow-lg"
      >
        <span class="codicon codicon-sm codicon-loading codicon-modifier-spin" />
        {{ busy === 'reading' ? $t('graph.reading') : $t('graph.laying') }}
      </span>
    </div>
  </div>
</template>
