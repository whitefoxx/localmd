import { test, expect } from '@playwright/test'

/**
 * Core flows against the in-memory KB + mock provider (?e2e=1):
 * scaffold → chat streaming → agent write + review approve.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?e2e=1')
  // The e2e bootstrap opens the memory KB; the empty-folder scaffold offer
  // is the first thing we should see.
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
})

test('scaffold initializes the KB and opens the index', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  // The scaffolded index opens (file name in the editor tab bar — the old
  // title bar became a VS Code-style activity bar) and the tree gained the
  // starter structure.
  await expect(page.locator('main').getByRole('button', { name: 'index.md' })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.locator('aside').getByText('wiki', { exact: true })).toBeVisible()
  await expect(page.locator('aside').getByText('AGENTS.md', { exact: true })).toBeVisible()
})

test('chat streams a mock reply', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask or instruct/)
  await input.fill('echo 流式测试成功')
  await input.press('Enter')
  await expect(page.getByText('流式测试成功').last()).toBeVisible({ timeout: 10_000 })
})

test('agent write shows up in review and can be approved', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask or instruct/)
  await input.fill('write wiki/e2e-note.md # E2E 写入测试')
  await input.press('Enter')
  // The review badge appears in the title bar once the tool ran.
  const reviewBadge = page.getByTitle('Review agent changes')
  await expect(reviewBadge).toBeVisible({ timeout: 10_000 })
  await reviewBadge.click()
  await expect(page.getByText('wiki/e2e-note.md').first()).toBeVisible()
  await page.getByRole('button', { name: 'Approve all' }).click()
  await expect(reviewBadge).toBeHidden()
})

test('agent delete is undoable from the review panel', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const tree = page.locator('aside')
  await expect(tree.getByText('index.md', { exact: true }).first()).toBeVisible()

  const input = page.getByPlaceholder(/Ask or instruct/)
  await input.fill('delete wiki/index.md')
  await input.press('Enter')

  // Gone from the tree, and recorded as a restorable deletion.
  await expect(tree.getByText('index.md', { exact: true }).first()).toBeHidden({ timeout: 10_000 })
  const reviewBadge = page.getByTitle('Review agent changes')
  await reviewBadge.click()
  await expect(page.getByText('Discard restores the file')).toBeVisible()

  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(reviewBadge).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(tree.getByText('index.md', { exact: true }).first()).toBeVisible()
})

test('deleting a folder asks first, in the conversation, and honors Reject', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const tree = page.locator('aside')
  await expect(tree.getByText('wiki', { exact: true })).toBeVisible()

  const input = page.getByPlaceholder(/Ask or instruct/)
  await input.fill('delete wiki')
  await input.press('Enter')

  // The decision card appears in the transcript itself — warning, doomed file
  // listing, and the two buttons; the turn hangs on them.
  await expect(page.getByText('everything listed below is gone for good')).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByText('wiki/index.md')).toBeVisible()
  await page.getByRole('button', { name: 'Reject' }).click()

  // Rejected: the folder survives, the card becomes a receipt, and the model
  // is told it was declined.
  await expect(page.getByText('Rejected', { exact: true })).toBeVisible()
  await expect(page.getByText(/Done: User declined/)).toBeVisible()
  await expect(tree.locator('[data-tree-path="wiki"]')).toBeVisible()
})

test('switching tabs reveals and selects the file in the tree', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const tree = page.locator('aside')
  // Two tabs: the scaffolded wiki/index.md, plus AGENTS.md from the root.
  await tree.getByText('AGENTS.md', { exact: true }).click()
  await expect(page.locator('main').getByRole('button', { name: /AGENTS\.md/ })).toBeVisible()

  // Collapse everything, so wiki/index.md is not even rendered any more.
  await tree.getByTitle('Collapse all').click()
  const indexRow = tree.locator('[data-tree-path="wiki/index.md"]')
  await expect(indexRow).toBeHidden()

  // Clicking its tab expands wiki/ again and moves the highlight onto the row.
  await page.locator('main').getByRole('button', { name: /index\.md/ }).click()
  await expect(indexRow).toBeVisible()
  await expect(indexRow).toHaveClass(/bg-accent/)
  await expect(tree.locator('[data-tree-path="AGENTS.md"]')).not.toHaveClass(/bg-accent/)
})

test('artifact tool renders a card that opens the sandboxed viewer', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask or instruct/)
  await input.fill('artifact 学习指南')
  await input.press('Enter')
  // Clickable card in the transcript.
  const card = page.getByRole('button', { name: /学习指南/ })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  // Opens in a sandboxed iframe — and crucially WITHOUT allow-same-origin.
  const frame = page.locator('iframe[sandbox]')
  await expect(frame).toBeVisible()
  const sandbox = await frame.getAttribute('sandbox')
  expect(sandbox).not.toContain('allow-same-origin')
})

test('plan tool renders the checklist card', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask or instruct/)
  await input.fill('plan')
  await input.press('Enter')
  await expect(page.getByText('Step three')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('2/3', { exact: true })).toBeVisible()
})

/** The thinking block, whole while it streams, gone once the reply starts. */
const thinkingBlock = (page: import('@playwright/test').Page) =>
  page.locator('details:has(summary:has-text("Thinking"))').first()

test('a thinking block streams in full, then folds itself away', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask or instruct/)
  await input.fill('think ' + '推理中。'.repeat(300))
  await input.press('Enter')

  const block = thinkingBlock(page)
  await expect(block).toHaveAttribute('open', '', { timeout: 10_000 })
  // No clamp any more: what is written is what is on screen.
  const clipped = await block.locator('div').first().evaluate((el) => el.scrollHeight > el.clientHeight + 2)
  expect(clipped).toBe(false)

  await expect(page.getByText('Done thinking')).toBeVisible({ timeout: 10_000 })
  await expect(block).not.toHaveAttribute('open', '')
})

test('clicking a streaming thinking block keeps it open past the stream', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask or instruct/)
  // Long trail: the click below must land while the stream is still going, and
  // on a loaded machine (parallel suites) a short one can finish first — the
  // block folds and the click misses.
  await input.fill('think ' + '推理中。'.repeat(900))
  await input.press('Enter')

  const block = thinkingBlock(page)
  await expect(block).toHaveAttribute('open', '', { timeout: 10_000 })
  await block.locator('div').first().click() // in the trail, not on the summary
  await expect(page.getByText('Done thinking')).toBeVisible({ timeout: 20_000 })
  await expect(block).toHaveAttribute('open', '')
})

test('stop settles the transcript even when the tool ignores it', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask or instruct/)
  await input.fill('hang 5000')
  await input.press('Enter')

  const spinner = page.locator('.codicon-modifier-spin')
  await expect(spinner.first()).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'Stop' }).click()
  // Immediately — the tool runs on in the background for another 5s, but the
  // conversation is over as far as the user is concerned.
  await expect(spinner).toHaveCount(0, { timeout: 1_000 })
  await expect(page.getByRole('button', { name: /Send/ })).toBeVisible()
})

test('scrolling up during a stream detaches auto-follow', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask or instruct/)
  await input.fill('echo ' + '前置内容。'.repeat(80))
  await input.press('Enter')
  await expect(page.getByRole('button', { name: /Send/ })).toBeVisible({ timeout: 10_000 })
  await input.fill('echo ' + '长流式输出。'.repeat(400))
  await input.press('Enter')
  await page.waitForTimeout(500) // stream underway
  const scroller = page.locator('.panel-scroll', { hasText: '前置内容' }).first()
  await scroller.evaluate((el) => {
    el.scrollTop = 0
    el.dispatchEvent(new Event('scroll'))
  })
  await page.waitForTimeout(1200) // stream keeps growing meanwhile
  const top = await scroller.evaluate((el) => el.scrollTop)
  expect(top).toBeLessThan(50) // not yanked back to the bottom
})

test('e2e mode never persists to real storage', async ({ page }) => {
  // Regression guard: the mock profile once leaked through the settings
  // watcher into localStorage and wiped the user's real API keys.
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const stored = await page.evaluate(() => localStorage.getItem('browser-md:settings'))
  expect(stored).toBeNull()
})

test('WebCLI is presented as a permission to grant, not an id to copy', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  // The activity bar is icon-only (title, no text), so locate by its icon.
  await page.locator('nav button:has(.codicon-settings-gear)').click()
  await page.locator('button:has(.codicon-plug)').click()

  // Install it the way a user does — from the recommended list.
  await page.getByRole('button', { name: /Browse recommended/ }).click()
  // WebCLI leads the list (it is the one featured entry); the row's checkbox is
  // icon-only, so take the first one.
  await expect(page.getByText('WebCLI browser extension')).toBeVisible()
  await page.getByRole('checkbox').first().click()
  await page.locator('button:has(.codicon-arrow-left)').click()

  // No extension is present under Playwright, so the row must read as unfinished
  // setup rather than as a failed connection.
  const row = page.getByRole('button', { name: /WebCLI browser extension/ })
  await expect(row).toContainText('Setup needed')
  await row.click()

  // The panel asks for the one thing only the user can do, and names the exact
  // address to add — including the port, which is the usual reason it fails.
  await expect(page.getByText('Let WebCLI talk to this site')).toBeVisible()
  const allowStep = page.locator('li', { hasText: 'Web app access' })
  await expect(allowStep).toBeVisible()
  await expect(allowStep).toContainText(`localhost:${new URL(page.url()).port}`)
  await expect(page.getByRole('button', { name: 'Reload this page' })).toBeVisible()
  // And nothing to copy: the id is the extension's to announce, not ours to pin.
  await expect(page.getByText('Chrome extension ID')).toHaveCount(0)
})

test('a relay on the page is not the same as WebCLI answering', async ({ page }) => {
  // WebCLI injects its relay per HOST but gates the connection on the exact
  // ORIGIN, so on another port of an allowed host the marker is present and every
  // call goes unanswered. Faking just the marker reproduces that exactly.
  await page.addInitScript(() => {
    const mark = (): void => {
      if (document.documentElement) document.documentElement.dataset.webcliRelay = 'a'.repeat(32)
    }
    mark()
    document.addEventListener('DOMContentLoaded', mark)
  })
  await page.goto('/?e2e=1')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.webcliRelay ?? null))
    .not.toBeNull()
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await page.locator('nav button:has(.codicon-settings-gear)').click()
  await page.locator('button:has(.codicon-plug)').click()
  await page.getByRole('button', { name: /Browse recommended/ }).click()
  await page.getByRole('checkbox').first().click()
  await page.locator('button:has(.codicon-arrow-left)').click()
  await page.getByRole('button', { name: /WebCLI browser extension/ }).click()

  // Still the setup panel — and it names the reason, which is the address, not
  // the install.
  await expect(page.getByText('Let WebCLI talk to this site')).toBeVisible()
  await expect(page.getByText(/is not answering it/)).toBeVisible()
  await expect(page.getByText(/Connected — WebCLI is answering/)).toHaveCount(0)
})
