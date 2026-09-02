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
  await expect(page.getByText('Click a node to see what it is')).toBeVisible()
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
  // The property, not the numbers: both layers step back, and links go further
  // down than nodes because a thin line at the same opacity still reads as a
  // line (DIM_LINKS / DIM_NODES in GraphView). Pinning the literals is what
  // left this red for three days after they were deliberately deepened.
  const dim = async (n: number): Promise<number> =>
    Number(await layers.nth(n).evaluate((el) => (el as SVGGElement).style.opacity))
  await expect
    .poll(() => dim(0), { message: 'links dim' })
    .toBeGreaterThan(0)
  const [links, nodes_] = [await dim(0), await dim(1)]
  expect(links).toBeLessThan(nodes_)
  expect(nodes_).toBeLessThan(1)
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
  await expect(page.getByText('Click a node to see what it is')).toBeVisible()
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

/**
 * Picking a node.
 *
 * A click used to leave the graph for the file, which threw away the picture it
 * was clicked from. It now pins the node instead: the graph dims around it, a
 * card says what it is, and leaving is that card's own button. While a node is
 * pinned the pointer moves the CARD only, and only across what the pin lit up —
 * a dimmed node is not part of the answer on screen, so pointing at one says
 * nothing.
 */
test.describe('picking a node', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?e2e=1')
    await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
    await expect(page.locator('main').getByRole('button', { name: 'index.md' })).toBeVisible({
      timeout: 10_000,
    })
    await page.getByTitle('Graph view').click()
    await expect(page.locator('svg g > g:nth-child(2) > g').first()).toBeVisible({ timeout: 10_000 })
  })

  /** Pick a node that has at least one neighbour and at least one non-neighbour,
   *  and report all three ids — everything below needs the distinction. */
  async function pickable(page: import('@playwright/test').Page): Promise<{
    hub: string
    neighbor: string
    stranger: string
  }> {
    return await page.evaluate(() => {
      const layers = [...document.querySelectorAll('svg > g > g')]
      const els = [...layers[1].querySelectorAll(':scope > g')] as (SVGGElement & {
        __data__: { id: string }
      })[]
      const lines = [...layers[0].querySelectorAll('line')] as (SVGLineElement & {
        __data__: { source: string | { id: string }; target: string | { id: string } }
      })[]
      const id = (e: string | { id: string }): string => (typeof e === 'string' ? e : e.id)
      const near = new Map<string, Set<string>>()
      for (const l of lines) {
        const [a, b] = [id(l.__data__.source), id(l.__data__.target)]
        for (const [x, y] of [
          [a, b],
          [b, a],
        ]) {
          const s = near.get(x) ?? new Set()
          s.add(y)
          near.set(x, s)
        }
      }
      const hub = els.find((e) => {
        const s = near.get(e.__data__.id)
        return s?.size && els.some((o) => o.__data__.id !== e.__data__.id && !s.has(o.__data__.id))
      })!
      const s = near.get(hub.__data__.id)!
      return {
        hub: hub.__data__.id,
        neighbor: [...s][0],
        stranger: els.find((o) => o.__data__.id !== hub.__data__.id && !s.has(o.__data__.id))!
          .__data__.id,
      }
    })
  }

  /**
   * Wait until the force layout has stopped moving things.
   *
   * Anything that measures a POSITION has to, and creating a file mid-test
   * rebuilds the graph — so the assertion below would otherwise race a
   * simulation still pulling the whole picture apart, and read a node on its
   * way somewhere else.
   */
  async function settled(page: import('@playwright/test').Page): Promise<void> {
    let last = ''
    await expect
      .poll(
        async () => {
          const now = await page.evaluate(() =>
            [...document.querySelectorAll('svg > g > g > g')]
              .map((e) => {
                const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(e.getAttribute('transform') ?? '')
                return m ? `${Math.round(+m[1])},${Math.round(+m[2])}` : '?'
              })
              .join('|'),
          )
          const same = now !== '' && now === last
          last = now
          return same
        },
        { timeout: 20_000 },
      )
      .toBe(true)
  }

  /** Fire a real DOM event at one node — the simulation keeps moving, so
   *  clicking by coordinate would race the layout. */
  async function at(
    page: import('@playwright/test').Page,
    id: string,
    type: 'click' | 'mouseenter' | 'mouseleave',
  ): Promise<void> {
    await page.evaluate(
      ([nodeId, evt]) => {
        const el = [...document.querySelectorAll('svg > g > g > g')].find(
          (e) => (e as unknown as { __data__: { id: string } }).__data__.id === nodeId,
        )
        el?.dispatchEvent(new MouseEvent(evt as string, { bubbles: evt === 'click' }))
      },
      [id, type],
    )
  }

  /** What the card is currently about, or null when there is no card. */
  const shown = (page: import('@playwright/test').Page): Promise<string | null> =>
    page.evaluate(() => document.querySelector('[data-preview]')?.getAttribute('data-preview') ?? null)

  test('the dot is the node — its name is not part of it', async ({ page }) => {
    // A label runs to the right as far as the name is long, and the focused
    // one grows. While it answered to the pointer, the area that counted as a
    // node changed depending on what the pointer had already done.
    const overLabel = await page.evaluate(() => {
      for (const g of document.querySelectorAll('svg > g > g > g')) {
        const label = g.querySelector('text')
        if (!label) continue
        const r = label.getBoundingClientRect()
        if (r.width < 12) continue
        const hit = document.elementFromPoint(r.left + r.width - 3, r.top + r.height / 2)
        if (hit === label) return 'the label itself'
        if (hit?.tagName === 'text') return 'some other label'
        return hit?.tagName ?? 'nothing'
      }
      return 'no label found'
    })
    expect(overLabel).not.toBe('the label itself')
    expect(overLabel).not.toBe('some other label')
  })

  test('a click pins the node and describes it, instead of leaving for it', async ({ page }) => {
    const { hub } = await pickable(page)
    await at(page, hub, 'click')

    // Still on the graph — this is the whole point of the change.
    await expect(page.getByText('Click a node to see what it is')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open this file' })).toBeVisible()
    expect(await shown(page)).toBe(hub)

    // Dimmed exactly as a hover dims it, and it stays dimmed with the pointer
    // nowhere near: that is what pinned means.
    const dim = await page.evaluate(() =>
      [...document.querySelectorAll('svg > g > g')].map((l) => (l as SVGGElement).style.opacity),
    )
    expect(Number(dim[0])).toBeGreaterThan(0)
    expect(Number(dim[0])).toBeLessThan(Number(dim[1]))
    expect(Number(dim[1])).toBeLessThan(1)
  })

  test('a ring marks the node the card is about', async ({ page }) => {
    const { hub, neighbor } = await pickable(page)
    await at(page, hub, 'click')

    /** The id of the node holding the ring, and how many rings exist. */
    const ringed = (): Promise<{ id: string | null; count: number }> =>
      page.evaluate(() => {
        const rings = [...document.querySelectorAll('svg circle[stroke-width="2"]')]
        const owner = rings[0]?.parentElement as unknown as { __data__?: { id: string } } | null
        return { id: owner?.__data__?.id ?? null, count: rings.length }
      })

    expect(await ringed()).toEqual({ id: hub, count: 1 })
    // It follows the card, not the pin: one ring, moved, never a second one.
    await at(page, neighbor, 'mouseenter')
    expect(await ringed()).toEqual({ id: neighbor, count: 1 })
  })

  test('hovering a neighbour moves the card but not the dimming', async ({ page }) => {
    const { hub, neighbor } = await pickable(page)
    await at(page, hub, 'click')
    const raised = (): Promise<string> =>
      page.evaluate(() =>
        [...document.querySelectorAll('svg > g > g')]
          .slice(2)
          .map((l) =>
            [...l.children]
              .map((c) => (c as unknown as { __data__?: { id?: string } }).__data__?.id ?? c.tagName)
              .join(','),
          )
          .join('|'),
      )
    const before = await raised()

    await at(page, neighbor, 'mouseenter')
    expect(await shown(page)).toBe(neighbor)
    expect(await raised()).toBe(before) // the graph did not re-aim under the card

    // And it stays there once the pointer leaves — reading the card means
    // moving off the node to reach it.
    await at(page, neighbor, 'mouseleave')
    expect(await shown(page)).toBe(neighbor)
    expect(await raised()).toBe(before)
  })

  test('the two marks come apart: one on the pin, one on what the card shows', async ({
    page,
  }) => {
    const { hub, neighbor } = await pickable(page)
    await at(page, hub, 'click')

    /** [what the dashed mark is on, what the solid one is on, how many marks]. */
    const marks = (): Promise<[string | null, string | null, number]> =>
      page.evaluate(() => {
        const all = [...document.querySelectorAll('svg circle[stroke][fill="none"]')]
        const on = (dashed: boolean): string | null => {
          const c = all.find((e) => !!e.getAttribute('stroke-dasharray') === dashed)
          return (
            (c?.parentElement as unknown as { __data__?: { id: string } } | null)?.__data__?.id ??
            null
          )
        }
        return [on(true), on(false), all.length]
      })

    // Both on the pinned node while it is also what the card shows.
    expect(await marks()).toEqual([hub, hub, 2])

    // The pointer moves the card's mark only — the pin keeps its own, which is
    // what says the graph is still arranged around the node you clicked.
    await at(page, neighbor, 'mouseenter')
    await at(page, neighbor, 'mouseleave')
    expect(await marks()).toEqual([hub, neighbor, 2])
  })

  test('hovering a dimmed node says nothing at all', async ({ page }) => {
    const { hub, neighbor, stranger } = await pickable(page)
    await at(page, hub, 'click')
    await at(page, neighbor, 'mouseenter')
    // The card is left on the neighbour, so a dimmed node doing nothing is
    // visible as the card NOT moving — rather than as it happening to already
    // show what a reset would have put back.
    await at(page, stranger, 'mouseenter')
    expect(await shown(page)).toBe(neighbor)
  })

  test('clicking the background puts the graph back', async ({ page }) => {
    const { hub } = await pickable(page)
    await at(page, hub, 'click')
    await expect(page.getByRole('button', { name: 'Open this file' })).toBeVisible()

    // A real click at a point that really is empty — found, not guessed, and
    // checked against the hit test rather than assumed from coordinates. A
    // synthetic event aimed at the <svg> would pass even if nothing on screen
    // could ever deliver one there.
    const empty = await page.evaluate(() => {
      const svg = document.querySelector('svg')!
      const box = svg.getBoundingClientRect()
      for (let y = box.bottom - 20; y > box.top + 20; y -= 24) {
        for (let x = box.left + 20; x < box.right - 400; x += 40) {
          if (document.elementFromPoint(x, y) === svg) return { x, y }
        }
      }
      return null
    })
    expect(empty).not.toBeNull()
    await page.mouse.click(empty!.x, empty!.y)
    await expect(page.getByRole('button', { name: 'Open this file' })).toBeHidden()
    const dim = await page.evaluate(() =>
      [...document.querySelectorAll('svg > g > g')].map((l) => (l as SVGGElement).style.opacity),
    )
    expect(dim.slice(0, 2)).toEqual(['', ''])
  })

  test('panning is not a background click — the pin survives it', async ({ page }) => {
    const { hub } = await pickable(page)
    await at(page, hub, 'click')
    const box = (await page.locator('svg').boundingBox())!
    await page.mouse.move(box.x + 80, box.y + box.height - 60)
    await page.mouse.down()
    await page.mouse.move(box.x + 160, box.y + box.height - 140, { steps: 10 })
    await page.mouse.up()
    expect(await shown(page)).toBe(hub)
  })

  test('a link in the card is read in the card, and Back undoes it', async ({ page }) => {
    // A page that links somewhere, and the page it links to.
    const { from, to } = await page.evaluate(async () => {
      const { useFilesStore } = await import('/src/stores/files.ts')
      const { useKbIndexStore } = await import('/src/stores/kbIndex.ts')
      const files = useFilesStore()
      await files.createFile('wiki/from.md', '# From\n\nGo to [[to]].\n')
      await files.createFile('wiki/to.md', '# To\n\nArrived.\n')
      await useKbIndexStore().refresh()
      return { from: 'wiki/from.md', to: 'wiki/to.md' }
    })
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            [...document.querySelectorAll('svg > g > g > g')].some(
              (e) => (e as unknown as { __data__: { id: string } }).__data__.id === id,
            ),
          from,
        ),
      )
      .toBe(true)

    await at(page, from, 'click')
    expect(await shown(page)).toBe(from)
    // No way back from the page you started on.
    await expect(page.getByTitle('Back to the page you came from')).toBeHidden()

    await page.locator('[data-preview] a.wikilink').first().click()
    expect(await shown(page)).toBe(to)
    // The graph did not move: the pin is still where the click put it.
    expect(
      await page.evaluate(async () => {
        const { useUiStore } = await import('/src/stores/ui.ts')
        return useUiStore().graphSelected
      }),
    ).toBe(from)

    await page.getByTitle('Back to the page you came from').click()
    expect(await shown(page)).toBe(from)
    await expect(page.getByTitle('Back to the page you came from')).toBeHidden()
  })

  test('a page the graph is dimming offers to be found on it', async ({ page }) => {
    // A → B → C, so that C is two hops from A and therefore dimmed while A is
    // pinned. Following a link is the only way to land the card there.
    await page.evaluate(async () => {
      const { useFilesStore } = await import('/src/stores/files.ts')
      const { useKbIndexStore } = await import('/src/stores/kbIndex.ts')
      const files = useFilesStore()
      await files.createFile('wiki/aa.md', '# Aa\n\nOn to [[bb]].\n')
      await files.createFile('wiki/bb.md', '# Bb\n\nOn to [[cc]].\n')
      await files.createFile('wiki/cc.md', '# Cc\n\nThe end.\n')
      await useKbIndexStore().refresh()
    })
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll('svg > g > g > g')].some(
            (e) => (e as unknown as { __data__: { id: string } }).__data__.id === 'wiki/cc.md',
          ),
        ),
      )
      .toBe(true)

    const locate = page.getByRole('button', { name: 'Find it on the graph' })
    await at(page, 'wiki/aa.md', 'click')
    // The pin itself is not lost, so there is nothing to find.
    await expect(locate).toBeHidden()

    // One hop: bb is lit, still visible, still nothing to find.
    await page.locator('[data-preview] a.wikilink').first().click()
    expect(await shown(page)).toBe('wiki/bb.md')
    await expect(locate).toBeHidden()

    // Two hops: cc is dimmed, and now the offer appears.
    await page.locator('[data-preview] a.wikilink').first().click()
    expect(await shown(page)).toBe('wiki/cc.md')
    await expect(locate).toBeVisible()

    // Pressing it is exactly what clicking that node would have been.
    await settled(page)
    await locate.click()
    expect(
      await page.evaluate(async () => {
        const { useUiStore } = await import('/src/stores/ui.ts')
        return useUiStore().graphSelected
      }),
    ).toBe('wiki/cc.md')
    expect(await shown(page)).toBe('wiki/cc.md')
    await expect(locate).toBeHidden()
    // A new subject, so the trail it took to get here is gone — same as a click.
    await expect(page.getByTitle('Back to the page you came from')).toBeHidden()

    // And it was brought somewhere it can be read: vertically centred, and in
    // the half of the frame the card is not covering. Polled, because the
    // simulation may still be settling — but a pan that never happened leaves
    // the node nowhere near, so this cannot pass by accident.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const svg = document.querySelector('svg')!.getBoundingClientRect()
          const card = document.querySelector('[data-preview]')!.getBoundingClientRect()
          const el = [...document.querySelectorAll('svg > g > g > g')].find(
            (e) => (e as unknown as { __data__: { id: string } }).__data__.id === 'wiki/cc.md',
          )!
          const dot = el.querySelector('circle')!.getBoundingClientRect()
          const x = dot.left + dot.width / 2 - svg.left
          const y = dot.top + dot.height / 2 - svg.top
          const free = card.left - svg.left
          return {
            centredInFreeHalf: Math.abs(x - free / 2) < 40,
            clearOfTheCard: x < free,
            centredDown: Math.abs(y - svg.height / 2) < 40,
          }
        }),
      )
      .toEqual({ centredInFreeHalf: true, clearOfTheCard: true, centredDown: true })
  })

  test('the card can be written in, through the editor’s own buffer', async ({ page }) => {
    const { hub, neighbor } = await pickable(page)
    await at(page, hub, 'click')
    await page.getByTitle('Write in this file').click()

    const box = page.locator('[data-preview] textarea')
    await expect(box).toBeVisible()
    await box.click()
    await page.keyboard.press('End')
    await page.keyboard.type('\n\nWritten from the graph.')

    // The pointer must not swap the subject out from under a caret.
    await at(page, neighbor, 'mouseenter')
    expect(await shown(page)).toBe(hub)

    // One buffer, one autosave — not a second write path of the card's own.
    const state = async (): Promise<{ path: string | null; dirty: boolean; text: boolean }> =>
      page.evaluate(async () => {
        const { useFilesStore } = await import('/src/stores/files.ts')
        const f = useFilesStore()
        return {
          path: f.currentPath,
          dirty: f.saveState !== 'saved',
          text: f.content.includes('Written from the graph.'),
        }
      })
    expect(await state()).toMatchObject({ path: hub, text: true })
    await expect.poll(async () => (await state()).dirty).toBe(false)
    expect(
      await page.evaluate(async (p) => {
        const fs = await import('/src/lib/fs.ts')
        return (await fs.readFile(p)).includes('Written from the graph.')
      }, hub),
    ).toBe(true)

    // Reading it again shows what was just written, not the index's snapshot.
    await page.getByTitle('Stop writing').click()
    await expect(page.locator('[data-preview] .md-preview')).toContainText(
      'Written from the graph.',
    )
  })

  test('the card can take the frame, and give it back', async ({ page }) => {
    const { hub } = await pickable(page)
    await at(page, hub, 'click')
    const width = async (): Promise<number> =>
      (await page.locator('[data-preview]').boundingBox())!.width

    const docked = await width()
    await page.getByTitle('Fill the window').click()
    const filled = await width()
    expect(filled).toBeGreaterThan(docked)
    // Bigger, but not the whole view: the graph stays visible around it.
    const frame = (await page.locator('svg').boundingBox())!
    expect(filled).toBeLessThan(frame.width - 80)

    await page.getByTitle('Back to the side').click()
    expect(await width()).toBe(docked)
  })

  test('a page can be found by name, and Esc gives the box up before the graph', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const { useFilesStore } = await import('/src/stores/files.ts')
      const { useKbIndexStore } = await import('/src/stores/kbIndex.ts')
      await useFilesStore().createFile('wiki/needle.md', '# Needle\n\nIn a haystack.\n')
      await useKbIndexStore().refresh()
    })
    const box = page.getByPlaceholder('Find a page…')
    await box.click()
    await box.fill('needle')
    // The dropdown row, named by both halves it shows — the tree and the tab
    // bar also hold a "needle" button, since creating the file opened it.
    await expect(page.getByRole('button', { name: 'needle wiki/needle.md' })).toBeVisible()

    await settled(page)
    await box.press('Enter')
    expect(await shown(page)).toBe('wiki/needle.md')
    expect(
      await page.evaluate(async () => {
        const { useUiStore } = await import('/src/stores/ui.ts')
        const ui = useUiStore()
        return { pinned: ui.graphSelected, query: ui.graphQuery, request: ui.graphGoTo }
      }),
    ).toEqual({ pinned: 'wiki/needle.md', query: '', request: '' })

    // Found means brought into view, the same as the card's own button.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const svg = document.querySelector('svg')!.getBoundingClientRect()
          const card = document.querySelector('[data-preview]')!.getBoundingClientRect()
          const el = [...document.querySelectorAll('svg > g > g > g')].find(
            (e) => (e as unknown as { __data__: { id: string } }).__data__.id === 'wiki/needle.md',
          )!
          const dot = el.querySelector('circle')!.getBoundingClientRect()
          return (
            Math.abs(dot.left + dot.width / 2 - svg.left - (card.left - svg.left) / 2) < 40 &&
            Math.abs(dot.top + dot.height / 2 - svg.top - svg.height / 2) < 40
          )
        }),
      )
      .toBe(true)

    await box.click()
    await box.fill('zzzznothing')
    await expect(page.getByText('No page here goes by that name.')).toBeVisible()

    // Esc gives up the half-typed search first — the graph is a layer below it.
    await page.keyboard.press('Escape')
    await expect(page.getByText('No page here goes by that name.')).toBeHidden()
    await expect(page.getByText('Click a node to see what it is')).toBeVisible()
  })

  test('the card is the way out: its button opens the file', async ({ page }) => {
    const { hub } = await pickable(page)
    await at(page, hub, 'click')
    await page.getByRole('button', { name: 'Open this file' }).click()
    await expect(page.getByText('Click a node to see what it is')).toBeHidden()
    const opened = await page.evaluate(async () => {
      const { useFilesStore } = await import('/src/stores/files.ts')
      return useFilesStore().currentPath
    })
    expect(opened).toBe(hub)
  })
})
