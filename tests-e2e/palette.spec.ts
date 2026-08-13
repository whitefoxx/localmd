import { test, expect, type Page } from '@playwright/test'

/**
 * The palette (⌘K) and its four modes: fuzzy file search, `>` commands,
 * `@` conversations, and ⇧Enter to hand the query to the agent.
 */

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
  return page.getByPlaceholder(/Search files and content|Run a command|Find a conversation/)
}

/** Result rows, scoped to the panel — the same names live in the file tree. */
function results(page: Page) {
  return page.locator('[data-palette] button')
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
  await expect(page.getByPlaceholder(/Ask or instruct/)).toHaveValue(
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
  await expect(page.getByText('Click a node to open its file')).toBeVisible()

  // A command bound to a hotkey advertises it.
  await page.keyboard.press('Escape')
  await openPalette(page)
  await palette(page).fill('>sidebar')
  await expect(results(page).filter({ hasText: 'Toggle the sidebar' })).toContainText('B')
})

test('@ finds a past conversation by title and reopens it', async ({ page }) => {
  // Give it something to find: one exchange becomes one stored session.
  const input = page.getByPlaceholder(/Ask or instruct/)
  await input.fill('echo wikilink digest')
  await input.press('Enter')
  await expect(page.getByText('wikilink digest').last()).toBeVisible({ timeout: 10_000 })

  // A second conversation, so picking the first one is a real choice.
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
  await expect(results(page).first()).toContainText('wiki/')

  await palette(page).fill('AGENTS')
  await expect(results(page).first()).toContainText('AGENTS.md')

  await palette(page).fill('wiki')
  await expect(results(page).first()).toContainText('wiki/')
})
