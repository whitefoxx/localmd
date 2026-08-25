import { test, expect } from '@playwright/test'

/**
 * The graph view's focus, which is a DOM-order trick and therefore worth a test
 * that reads the DOM.
 *
 * Hovering a node dims the graph and lifts that node, its neighbours and its
 * own links into layers above the dimmed ones. Two invariants come out of that,
 * and both were bugs first:
 *
 *  - the node you are pointing AT ends up on top of everything the hover
 *    raised. Raise a neighbour over it instead and the pointer is handed to
 *    that neighbour, which focuses it, which raises this node back over it —
 *    where labels overlap, the graph flickers between two nodes while you hold
 *    perfectly still.
 *  - leaving puts every element back exactly where it was, so which node is
 *    painted over which never drifts across a hover.
 */
test.describe('focus', () => {
test.beforeEach(async ({ page }) => {
  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await expect(page.locator('main').getByRole('button', { name: 'index.md' })).toBeVisible({
    timeout: 10_000,
  })
  await page.getByTitle('Graph view').click()
  await expect(page.getByText('Click a node to open its file')).toBeVisible()
  // Nodes are drawn from the index; the scaffolded KB has a handful of linked
  // pages, which is all this needs.
  await expect(page.locator('svg g > g:nth-child(2) > g').first()).toBeVisible({ timeout: 10_000 })
})

/** [links, nodes, lifted links, lifted nodes] — the four layers, in paint order. */
const LAYERS = 'svg > g > g'

test('the hovered node is raised above everything else the hover raises', async ({ page }) => {
  const layers = page.locator(LAYERS)
  const nodes = layers.nth(1).locator(':scope > g')

  // A node with at least one neighbour — otherwise nothing else is raised and
  // the ordering this is about never comes up.
  const target = await page.evaluate(() => {
    const layerEls = [...document.querySelectorAll('svg > g > g')]
    const els = [...layerEls[1].querySelectorAll(':scope > g')] as (SVGGElement & { __data__: { id: string } })[]
    const lines = [...layerEls[0].querySelectorAll('line')] as (SVGLineElement & {
      __data__: { source: string | { id: string }; target: string | { id: string } }
    })[]
    const id = (e: string | { id: string }): string => (typeof e === 'string' ? e : e.id)
    const linked = new Set(lines.flatMap((l) => [id(l.__data__.source), id(l.__data__.target)]))
    const hit = els.find((e) => linked.has(e.__data__.id))
    hit?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    return hit?.__data__.id ?? null
  })
  expect(target).not.toBeNull()

  // Dimmed, and the focused node is the LAST thing in the raised-nodes layer.
  await expect(layers.nth(0)).toHaveAttribute('style', /opacity:\s*0\.2/)
  await expect(layers.nth(1)).toHaveAttribute('style', /opacity:\s*0\.3/)
  const topmost = await page.evaluate(() => {
    const layerEls = [...document.querySelectorAll('svg > g > g')]
    const last = layerEls[3].lastElementChild as (SVGGElement & { __data__: { id: string } }) | null
    return { id: last?.__data__.id ?? null, raised: layerEls[3].children.length }
  })
  expect(topmost.id).toBe(target)
  expect(topmost.raised).toBeGreaterThan(1) // a neighbour came up too
  await expect(nodes).not.toHaveCount(0)
})

test('leaving a node puts the graph back exactly as it was', async ({ page }) => {
  const before = await page.evaluate(() => {
    const layerEls = [...document.querySelectorAll('svg > g > g')]
    const order = (el: Element): string =>
      [...el.children].map((c) => (c as { __data__?: { id?: string } }).__data__?.id ?? c.tagName).join(',')
    return { links: order(layerEls[0]), nodes: order(layerEls[1]) }
  })

  const after = await page.evaluate(() => {
    const layerEls = [...document.querySelectorAll('svg > g > g')]
    const els = [...layerEls[1].querySelectorAll(':scope > g')]
    for (const el of [els[0], els[Math.min(2, els.length - 1)], els[els.length - 1]]) {
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
      el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
    }
    const order = (el: Element): string =>
      [...el.children].map((c) => (c as { __data__?: { id?: string } }).__data__?.id ?? c.tagName).join(',')
    return {
      links: order(layerEls[0]),
      nodes: order(layerEls[1]),
      raisedLinks: layerEls[2].children.length,
      raisedNodes: layerEls[3].children.length,
      linkOpacity: (layerEls[0] as HTMLElement).style.opacity,
      nodeOpacity: (layerEls[1] as HTMLElement).style.opacity,
    }
  })

  expect(after.nodes).toBe(before.nodes)
  expect(after.links).toBe(before.links)
  expect(after.raisedLinks).toBe(0)
  expect(after.raisedNodes).toBe(0)
  expect(after.linkOpacity).toBe('')
  expect(after.nodeOpacity).toBe('')
})
})

test('the wait says which half of it you are in', async ({ page }) => {
  // Reading the KB comes first and used to say nothing at all: the panel mounts
  // against an index that is empty until every page has been read.
  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByTitle('Graph view').click()
  await expect(page.getByText('Click a node to open its file')).toBeVisible()
  await expect(page.getByText(/Reading your pages/)).toBeHidden()

  await page.evaluate(async () => {
    const { useKbIndexStore } = await import('/src/stores/kbIndex.ts')
    useKbIndexStore().refreshing = true
  })
  await expect(page.getByText(/Reading your pages/)).toBeVisible()

  await page.evaluate(async () => {
    const { useKbIndexStore } = await import('/src/stores/kbIndex.ts')
    useKbIndexStore().refreshing = false
  })
  await expect(page.getByText(/Reading your pages/)).toBeHidden()
})
