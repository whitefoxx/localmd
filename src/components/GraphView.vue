<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, nextTick, ref, watch } from 'vue'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
} from 'd3-force'
import { select } from 'd3-selection'
import { zoom, zoomIdentity } from 'd3-zoom'
import { drag } from 'd3-drag'
import { useKbIndexStore } from '@/stores/kbIndex'
import { useFilesStore } from '@/stores/files'
import { useUiStore } from '@/stores/ui'
import { fileStem } from '@/lib/wiki'
import { buildGraphData, graphDegrees, tagQuery, type GraphDatum } from '@/lib/graphData'
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
let sim: Simulation<GraphNode, GraphLink> | null = null

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
 * Whether tags are drawn as nodes of their own.
 *
 * Off by default: the link graph answers "what did I connect", and mixing in
 * a second kind of edge changes the shape of the answer — worth seeing when
 * you ask for it, wrong to impose on someone who opened the graph to look at
 * their links. A tag node is not a file; clicking one searches for it rather
 * than opening anything.
 */
const showTags = ref(false)

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
const DIM_NODES = 0.3
const DIM_LINKS = 0.2

/** How big a node is drawn: the more it is linked, the bigger. Square-rooted
 *  so a hub stands out without swallowing the page — area, not radius, tracks
 *  the degree — and capped so one runaway index page stays a circle. */
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

  const built = buildGraphData(index.graph, index.types, index.tags, showTags.value)
  const nodes: GraphNode[] = built.nodes
  const links: GraphLink[] = built.links.map((l) => ({ ...l }))
  const { degree, neighbors } = graphDegrees(built.links)

  const svg = select(el)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [0, 0, width, height])

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

  svg.call(
    zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (e) => g.attr('transform', e.transform)) as never,
  )
  svg.call((sel) => sel.property('__zoom', zoomIdentity))

  const link = linkLayer.selectAll<SVGLineElement, GraphLink>('line').data(links).join('line')

  const node = nodeLayer
    .selectAll<SVGGElement, GraphNode>('g')
    .data(nodes)
    .join('g')
    .attr('cursor', 'pointer')
    .on('click', (_e, d) => {
      // A tag is not a file: clicking it asks the question it stands for, and
      // the answer arrives ON TOP of the graph (the palette is z-50, this is
      // z-40) — you are looking at the neighbourhood, so leaving it to read
      // the list would put the thing you were comparing against away.
      if (d.kind === 'tag') {
        ui.searchFor(tagQuery(d.tag ?? ''))
        return
      }
      ui.graphOpen = false
      // The graph is reachable from inside the full-window agent panel, so the
      // file has to be uncovered as well as opened — see lib/openInEditor.
      void openInEditor(d.id)
    })

  const nodeRadius = (d: GraphNode): number =>
    d.kind === 'tag'
      ? Math.min(11, 4 + 1.6 * Math.sqrt(degree.get(d.id) ?? 0))
      : radiusOf(degree.get(d.id) ?? 0)

  // Pages are circles; tags are diamonds. Shape rather than colour alone, so
  // the two kinds stay apart for anyone who cannot rely on hue — and because
  // colour here already means the page's `type:`.
  node
    .filter((d) => d.kind === 'page')
    .append('circle')
    .attr('r', nodeRadius)
    .attr('fill', (d) =>
      d.id === files.currentPath
        ? 'rgb(var(--c-accent))'
        : d.type
          ? typeColor(d.type)
          : 'rgb(var(--c-fg-3))',
    )

  node
    .filter((d) => d.kind === 'tag')
    .append('rect')
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
  // The node the graph is currently about — hovered, or held by a drag. Null is
  // the resting state, where everything is drawn at full strength; a dense graph
  // is otherwise unreadable one node at a time.
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

  const endId = (e: string | GraphNode): string => (typeof e === 'string' ? e : e.id)

  // id → its element, and id → the lines that touch it. Built once per render,
  // which is the only place they can go stale.
  const nodeEl = new Map<string, SVGGElement>()
  node.each(function (d) {
    nodeEl.set(d.id, this)
  })
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
      return
    }
    baseLinks.style.opacity = String(DIM_LINKS)
    baseNodes.style.opacity = String(DIM_NODES)
    const raise = (el: Element, home: SVGGElement, to: SVGGElement): void => {
      lifted.push([el, home, el.nextSibling])
      to.appendChild(el)
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
  }

  node
    .on('mouseenter', (_e, d) => setFocus(d.id))
    // A drag keeps its node: the pointer routinely outruns the node it is
    // pulling, and the graph re-lighting mid-drag is exactly the flicker this
    // is meant to remove. The pointer is still over it when the drag ends, so
    // the leave that clears the focus is the one after the user lets go.
    .on('mouseleave', () => {
      if (!dragging) setFocus(null)
    })

  node.call(
    drag<SVGGElement, GraphNode>()
      .on('start', (e, d) => {
        if (!e.active) sim?.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
        dragging = true
        setFocus(d.id)
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
        setFocus(d.id)
      }) as never,
  )

  sim = forceSimulation<GraphNode>(nodes)
    .force(
      'link',
      forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance(70),
    )
    // Repulsion with a range: past this it contributes nothing, so a node with
    // no links is not shoved to the far corner by every other node at once.
    .force('charge', forceManyBody().strength(-180).distanceMax(420))
    .force('center', forceCenter(width / 2, height / 2))
    // A slack tether to the middle. forceCenter only translates the whole
    // cloud — it cannot pull a stray back in, because it moves everything
    // equally. These two can, and weakly enough that a linked cluster still
    // arranges itself.
    .force('x', forceX<GraphNode>(width / 2).strength(0.06))
    .force('y', forceY<GraphNode>(height / 2).strength(0.06))
    // Collision follows the drawn size, or the big nodes overlap each other.
    .force('collide', forceCollide<GraphNode>((d) => nodeRadius(d) + 8))
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
}

onMounted(() => {
  // Paint immediately from the cached index; refresh in the background — the
  // graph watch below re-renders only if something actually changed (refresh
  // keeps the same Map reference when nothing did).
  void renderMaybeSlow()
  void index.refresh()
})

watch([() => index.graph, showTags], () => void renderMaybeSlow())

onBeforeUnmount(() => {
  sim?.stop()
  sim = null
})
</script>

<template>
  <div class="relative h-full w-full">
    <div ref="host" class="h-full w-full" />

    <!-- Top-left, out of forceCenter's way (see the busy chip below). -->
    <button
      class="btn absolute left-4 top-4 text-xs shadow-sm"
      :class="{ '!text-added !border-added/50': showTags }"
      :title="$t('graph.showTagsHint')"
      @click="showTags = !showTags"
    >
      <span class="codicon codicon-sm codicon-tag" />
      {{ $t('graph.showTags') }}
    </button>
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
