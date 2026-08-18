<script setup lang="ts">
import { onMounted, onBeforeUnmount, nextTick, ref, watch } from 'vue'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
} from 'd3-force'
import { select } from 'd3-selection'
import { zoom, zoomIdentity } from 'd3-zoom'
import { drag } from 'd3-drag'
import { useKbIndexStore } from '@/stores/kbIndex'
import { useFilesStore } from '@/stores/files'
import { useUiStore } from '@/stores/ui'
import { fileStem } from '@/lib/wiki'
import { typeColor } from '@/lib/typeColor'

interface GraphNode {
  id: string
  type?: string | null
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
/** Alpha below which the graph has stopped visibly moving. The simulation runs
 *  on to ~0.001, long after it is readable; waiting for that would hold the
 *  line up over a graph that has plainly arrived. */
const SETTLED_ALPHA = 0.2

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
  el.innerHTML = ''
  const width = el.clientWidth
  const height = el.clientHeight

  const nodes: GraphNode[] = index.graph.nodes.map((id) => ({ id, type: index.types.get(id) ?? null }))
  const links: GraphLink[] = index.graph.links.map((l) => ({ ...l }))
  const degree = new Map<string, number>()
  for (const l of index.graph.links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
  }

  const svg = select(el)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [0, 0, width, height])

  const g = svg.append('g')

  svg.call(
    zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (e) => g.attr('transform', e.transform)) as never,
  )
  svg.call((sel) => sel.property('__zoom', zoomIdentity))

  const link = g
    .append('g')
    .attr('stroke', 'rgb(var(--c-border))')
    .attr('stroke-width', 1)
    .selectAll('line')
    .data(links)
    .join('line')

  const node = g
    .append('g')
    .selectAll<SVGGElement, GraphNode>('g')
    .data(nodes)
    .join('g')
    .attr('cursor', 'pointer')
    .on('click', (_e, d) => {
      ui.graphOpen = false
      void files.openFile(d.id)
    })

  const nodeRadius = (d: GraphNode): number => radiusOf(degree.get(d.id) ?? 0)

  node
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
    .append('text')
    .text((d) => fileStem(d.id))
    .attr('font-size', 10)
    .attr('dx', (d) => nodeRadius(d) + 5)
    .attr('dy', 3)
    .attr('fill', 'rgb(var(--c-fg-2))')

  node.call(
    drag<SVGGElement, GraphNode>()
      .on('start', (e, d) => {
        if (!e.active) sim?.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (e, d) => {
        d.fx = e.x
        d.fy = e.y
      })
      .on('end', (e, d) => {
        if (!e.active) sim?.alphaTarget(0)
        d.fx = null
        d.fy = null
      }) as never,
  )

  sim = forceSimulation<GraphNode>(nodes)
    .force(
      'link',
      forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance(70),
    )
    .force('charge', forceManyBody().strength(-180))
    .force('center', forceCenter(width / 2, height / 2))
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

watch(
  () => index.graph,
  () => void renderMaybeSlow(),
)

onBeforeUnmount(() => {
  sim?.stop()
  sim = null
})
</script>

<template>
  <div class="relative h-full w-full">
    <div ref="host" class="h-full w-full" />
    <!-- Near the top of the graph area, not in its middle: forceCenter pulls
         every node into the centre, so that is the one place a line of text
         cannot be read. Same chip as the PDF reader's. -->
    <div v-if="laying" class="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
      <span
        class="flex items-center gap-2 rounded-full border border-border bg-bg-1/95 px-3 py-1.5 text-xs text-fg-2 shadow-lg"
      >
        <span class="codicon codicon-sm codicon-loading codicon-modifier-spin" />
        {{ $t('graph.laying') }}
      </span>
    </div>
  </div>
</template>
