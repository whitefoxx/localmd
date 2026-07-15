<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
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

  node
    .append('circle')
    .attr('r', (d) => 4 + Math.min(6, degree.get(d.id) ?? 0))
    .attr('fill', (d) =>
      d.id === files.currentPath
        ? 'rgb(var(--c-accent))'
        : d.type
          ? index.colorFor(d.type)
          : 'rgb(var(--c-fg-3))',
    )

  node
    .append('text')
    .text((d) => fileStem(d.id))
    .attr('font-size', 10)
    .attr('dx', 10)
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
    .force('collide', forceCollide(14))
    .on('tick', () => {
      link
        .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
        .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
        .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
        .attr('y2', (d) => (d.target as GraphNode).y ?? 0)
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })
}

onMounted(() => {
  // Paint immediately from the cached index; refresh in the background — the
  // graph watch below re-renders only if something actually changed (refresh
  // keeps the same Map reference when nothing did).
  render()
  void index.refresh()
})

watch(
  () => index.graph,
  () => render(),
)

onBeforeUnmount(() => {
  sim?.stop()
  sim = null
})
</script>

<template>
  <div ref="host" class="h-full w-full" />
</template>
