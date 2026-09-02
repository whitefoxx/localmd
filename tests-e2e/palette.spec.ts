import { test, expect, type Page } from '@playwright/test'

/**
 * The palette (⌘K) and its seven modes: fuzzy file search, `>` commands,
 * `@` chats, `?` filters, `:` to jot a line into today's capture page and `[]`
 * to add one to the todo list (either alone opens the file it writes to), and
 * ⇧Enter to hand the query to the agent.
 */

/** Today as the app files it — local calendar day, never UTC. */
function today(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await expect(page.locator('main').getByRole('button', { name: 'index.md' })).toBeVisible({
    timeout: 10_000,
  })
})

async function openPalette(page: Page): Promise<void> {
  await page.getByTitle(/^Search \(/).click()
  await expect(page.getByPlaceholder(/Search files and content/)).toBeVisible()
}

function palette(page: Page) {
  return page.getByPlaceholder(
    /Search files and content|Run a command|Find a chat|Filter the knowledge base|Jot a line|Add something to the todo/,
  )
}

/** Result rows, scoped to the panel — the same names live in the file tree. */
function results(page: Page) {
  return page.locator('[data-palette] button')
}

/** Search hits only — the "ask the agent" offer leads the list and is not one. */
function hits(page: Page) {
  return page.locator('[data-palette] button:not([data-kind="ask"])')
}

test('an inexact query still finds the file, and shows which letters matched', async ({ page }) => {
  await openPalette(page)
  // Not a substring of anything: w-k-i-n are scattered through wiki/index.md.
  await palette(page).fill('wkin')

  const row = results(page).filter({ hasText: 'wiki/index.md' })
  await expect(row).toBeVisible()
  // The matched characters are marked so the match is explainable.
  await expect(row.locator('.fz-hit')).not.toHaveCount(0)

  await row.click()
  await expect(page.locator('main').getByRole('button', { name: 'index.md' })).toBeVisible()
})

test('two words mean both words, in either order — not the phrase', async ({ page }) => {
  await openPalette(page)
  // AGENTS.md's opening line says "This is a knowledge base…" — the words are
  // there, the phrase "knowledge this" is not.
  await palette(page).fill('knowledge this')
  await expect(results(page).filter({ hasText: 'AGENTS.md' }).first()).toBeVisible()

  // Reversing them changes nothing.
  await palette(page).fill('this knowledge')
  await expect(results(page).filter({ hasText: 'AGENTS.md' }).first()).toBeVisible()

  // And every word has to land: one impossible word empties the list.
  await palette(page).fill('knowledge zzzqqq')
  await expect(results(page)).toHaveCount(1)
  await expect(results(page)).toContainText('Ask the agent:')
})

test('a query that matches nothing offers the agent instead', async ({ page }) => {
  await openPalette(page)
  await palette(page).fill('zzzqqq')
  // The offer to ask is the only row: nothing is invented to match it.
  await expect(results(page)).toHaveCount(1)
  await expect(results(page)).toContainText('Ask the agent:')
})

test('shift+enter hands the query to the agent as an editable draft', async ({ page }) => {
  await openPalette(page)
  await palette(page).fill('what did I write about wikilinks')
  await palette(page).press('Shift+Enter')

  // The palette closes and the text lands in the composer — not sent, so it
  // can still be changed.
  await expect(palette(page)).toBeHidden()
  await expect(page.getByPlaceholder(/Ask the agent/)).toHaveValue(
    'what did I write about wikilinks',
  )
})

test('> runs a command, and shows the key binding for the ones that have it', async ({ page }) => {
  await openPalette(page)
  await palette(page).fill('>graph')

  const row = results(page).filter({ hasText: 'Toggle the graph view' })
  await expect(row).toBeVisible()
  await row.click()

  // The command ran: the graph overlay is up.
  await expect(page.getByText('Click a node to see what it is')).toBeVisible()

  // A command bound to a hotkey advertises it.
  await page.keyboard.press('Escape')
  await openPalette(page)
  await palette(page).fill('>sidebar')
  await expect(results(page).filter({ hasText: 'Toggle the sidebar' })).toContainText('B')
})

test('@ finds a past chat by title and reopens it', async ({ page }) => {
  // Give it something to find: one exchange becomes one stored session.
  const input = page.getByPlaceholder(/Ask the agent/)
  await input.fill('echo wikilink digest')
  await input.press('Enter')
  await expect(page.getByText('wikilink digest').last()).toBeVisible({ timeout: 10_000 })

  // A second chat, so picking the first one is a real choice.
  await page.getByTitle('New chat').click()
  await input.fill('echo unrelated chatter')
  await input.press('Enter')
  await expect(page.getByText('unrelated chatter').last()).toBeVisible({ timeout: 10_000 })

  await openPalette(page)
  await palette(page).fill('@wikilink')
  const row = results(page).filter({ hasText: 'wikilink digest' })
  await expect(row).toBeVisible()
  // The unrelated one is filtered out.
  await expect(results(page).filter({ hasText: 'unrelated chatter' })).toHaveCount(0)

  await row.click()
  await expect(palette(page)).toBeHidden()
  await expect(page.getByText('wikilink digest').last()).toBeVisible()
})

test('results keep tracking the query when a document matches many times', async ({ page }) => {
  // Rows used to be keyed by path+line, which collides across the sections of
  // one document; Vue then reused their DOM and the list went stale.
  await openPalette(page)
  // The best match leads, and it has to follow the query — this went stale
  // when several rows collided on a key, which is what the bug looked like.
  await palette(page).fill('wiki')
  await expect(hits(page).first()).toContainText('wiki/')

  await palette(page).fill('AGENTS')
  await expect(hits(page).first()).toContainText('AGENTS.md')

  await palette(page).fill('wiki')
  await expect(hits(page).first()).toContainText('wiki/')
})

test('the offer to ask leads the list, without taking Enter from the top hit', async ({ page }) => {
  // Unbounded results used to bury the offer below a scroll — precisely where
  // someone whose search is not finding it has stopped looking. Leading the
  // list must not cost search its default action, so the highlight starts on
  // the first real hit.
  await openPalette(page)
  await palette(page).fill('AGENTS')
  await expect(results(page).first()).toHaveAttribute('data-kind', 'ask')
  await expect(hits(page).first()).toContainText('AGENTS.md')

  await palette(page).press('Enter')
  await expect(palette(page)).toBeHidden()
  await expect(page.locator('main').getByRole('button', { name: 'AGENTS.md' })).toBeVisible()
})

test(': writes a line into today’s page and stays open for the next one', async ({ page }) => {
  await openPalette(page)
  await palette(page).fill(':')
  // Where a jot lands is on screen BEFORE anything is written — a capture
  // surface that writes somewhere unstated is one you stop trusting.
  await expect(page.locator('[data-palette]')).toContainText(`raw/daily/${today()}.md`)

  await palette(page).fill(': oat milk')
  await expect(results(page).filter({ hasText: 'oat milk' })).toBeVisible()
  await page.keyboard.press('Enter')

  // Still open, and it says where that one went, so a second line costs
  // nothing but typing it.
  await expect(page.locator('[data-palette]')).toContainText(`Saved to raw/daily/${today()}.md`)
  await palette(page).fill(': and a second thought')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-palette]')).toContainText('Saved to')

  // Both lines are in today's page, in the order they were made.
  await palette(page).fill(today())
  await results(page)
    .filter({ hasText: `raw/daily/${today()}.md` })
    .first()
    .click()
  await expect(page.locator('main')).toContainText('oat milk')
  await expect(page.locator('main')).toContainText('and a second thought')
})

test('a jot survives being made while today’s page is open with unsaved edits', async ({
  page,
}) => {
  // The one path where a plain file write would lose the jot: the buffer on
  // screen is dirty, and its next autosave would put the pre-jot text back.
  await openPalette(page)
  await palette(page).fill(': first')
  await page.keyboard.press('Enter')
  await palette(page).fill(today())
  await results(page)
    .filter({ hasText: `raw/daily/${today()}.md` })
    .first()
    .click()

  await page.getByRole('button', { name: 'Edit' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.type('\n- typed by hand')

  await openPalette(page)
  await palette(page).fill(': jotted from the palette')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')

  await expect(page.locator('.cm-content')).toContainText('typed by hand')
  await expect(page.locator('.cm-content')).toContainText('jotted from the palette')
})

test(': alone opens today’s page in edit mode, making it if today has none', async ({ page }) => {
  await openPalette(page)
  await palette(page).fill(':')
  // The row names the file it is about to open — including before it exists.
  await expect(results(page)).toContainText(`raw/daily/${today()}.md`)
  await page.keyboard.press('Enter')

  // Straight into the editor, not the reading view: the point of opening it is
  // to write in it.
  await expect(page.locator('.cm-content')).toContainText(today())
  await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible()
})

test('Enter while an IME is composing does not jot the half-written line', async ({ page }) => {
  await openPalette(page)
  await palette(page).fill(': 这句话还没写完')

  // What a Chinese IME sends when Enter commits a candidate: a keydown the
  // composition owns. Playwright's press() cannot set isComposing, so the
  // event is dispatched as the browser would send it.
  await page.locator('[data-palette] input').evaluate((el) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
  })

  // Nothing written, nothing closed — the sentence is still there to finish.
  await expect(page.locator('[data-palette]')).toBeVisible()
  await expect(page.locator('[data-palette]')).not.toContainText('Saved to')
  await expect(palette(page)).toHaveValue(': 这句话还没写完')

  // And a real Enter still jots, so the guard denies the IME's key only.
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-palette]')).toContainText(`Saved to raw/daily/${today()}.md`)
})


/**
 * What ⌘K opens on, and where the filter grammar went.
 *
 * The empty palette used to list the filters, which was only ever better than
 * the blank it replaced. Behind `?` they keep a front door of their own, and
 * the empty palette can answer what people actually open it for.
 */
test('the empty palette lists what is already open, current file first', async ({ page }) => {
  await page.evaluate(async () => {
    const { useFilesStore } = await import('/src/stores/files.ts')
    const files = useFilesStore()
    await files.createFile('wiki/alpha.md', '# Alpha\n')
    await files.createFile('wiki/beta.md', '# Beta\n')
    await files.openFile('wiki/alpha.md')
    await files.openFile('wiki/beta.md')
  })
  await openPalette(page)
  const rows = await results(page).allTextContents()
  expect(rows[0]).toContain('wiki/beta.md') // the file on screen
  expect(rows.join('|')).toContain('wiki/alpha.md')
  // Files that are not open are not offered — this is the open set, not a list
  // of everything.
  expect(rows.join('|')).not.toContain('AGENTS.md')
})

test('with nothing open the palette says nothing, rather than inventing a list', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { useFilesStore } = await import('/src/stores/files.ts')
    await useFilesStore().closeAllTabs()
  })
  await openPalette(page)
  await expect(results(page)).toHaveCount(0)
  // The prefixes are still named, which is the one thing an empty panel owes.
  await expect(page.locator('[data-palette]')).toContainText('filters')
})

test('`?` opens the filter grammar, and answers what can go in a key', async ({ page }) => {
  await page.evaluate(async () => {
    const { useFilesStore } = await import('/src/stores/files.ts')
    const { useKbIndexStore } = await import('/src/stores/kbIndex.ts')
    await useFilesStore().createFile('wiki/typed.md', '---\ntype: concept\n---\n\n# Typed\n')
    await useKbIndexStore().refresh()
  })
  await openPalette(page)
  await palette(page).fill('?')
  await expect(results(page).filter({ hasText: 'tag:' })).toBeVisible()
  await expect(results(page).filter({ hasText: 'orphan:' })).toBeVisible()

  // A key with nothing after it lists the knowledge base's own vocabulary.
  await palette(page).fill('?type:')
  await expect(results(page).filter({ hasText: 'concept' })).toBeVisible()

  await palette(page).fill('?type:concept')
  await expect(results(page).filter({ hasText: 'wiki/typed.md' })).toBeVisible()
})

test('without `?` a colon is just text, so a search stays a search', async ({ page }) => {
  await page.evaluate(async () => {
    const { useFilesStore } = await import('/src/stores/files.ts')
    const { useKbIndexStore } = await import('/src/stores/kbIndex.ts')
    await useFilesStore().createFile('wiki/notes.md', '# Notes\n\nA line saying type:concept.\n')
    await useKbIndexStore().refresh()
  })
  await openPalette(page)
  await palette(page).fill('type:concept')
  // The words, matched as words — the line that literally contains them.
  await expect(hits(page).filter({ hasText: 'wiki/notes.md' })).toBeVisible()
})


/**
 * `[]` — the same capture bargain as `:`, aimed at one well-known file.
 *
 * The list is `todos.md` at the root and the lines are GFM task items, so
 * nothing here needs this app to be read or ticked off.
 */
test('[] adds an item to the todo list and stays open for the next one', async ({ page }) => {
  const read = (): Promise<string | null> =>
    page.evaluate(async () => (await import('/src/lib/fs.ts')).tryReadFile('todos.md'))

  await openPalette(page)
  await palette(page).fill('[] buy oat milk')
  await expect(results(page).filter({ hasText: 'buy oat milk' })).toBeVisible()
  await palette(page).press('Enter')

  await expect.poll(read).toContain('- [ ] buy oat milk')
  // Still open, and reset to the prefix — several items go in one after another.
  await expect(palette(page)).toBeVisible()
  await expect(palette(page)).toHaveValue('[]')
  await expect(page.getByText('todos.md', { exact: false }).first()).toBeVisible()

  // `[ ]` is the same thought typed slightly differently.
  await palette(page).fill('[ ] and a second one')
  await palette(page).press('Enter')
  await expect.poll(read).toBe('# Todos\n\n- [ ] buy oat milk\n- [ ] and a second one\n')
})

test('[] alone opens the todo list in edit mode, making it if there is none', async ({ page }) => {
  await openPalette(page)
  await palette(page).fill('[]')
  await expect(results(page).filter({ hasText: 'todos.md' })).toBeVisible()
  await palette(page).press('Enter')

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { useFilesStore } = await import('/src/stores/files.ts')
        const files = useFilesStore()
        return { path: files.currentPath, mode: files.mode }
      }),
    )
    .toEqual({ path: 'todos.md', mode: 'edit' })
})
