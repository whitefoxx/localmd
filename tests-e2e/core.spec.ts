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
  const input = page.getByPlaceholder(/Ask the agent/)
  await input.fill('echo 流式测试成功')
  await input.press('Enter')
  await expect(page.getByText('流式测试成功').last()).toBeVisible({ timeout: 10_000 })
})

test('agent write shows up in review and can be approved', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask the agent/)
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

  const input = page.getByPlaceholder(/Ask the agent/)
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

  const input = page.getByPlaceholder(/Ask the agent/)
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
  const input = page.getByPlaceholder(/Ask the agent/)
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
  const input = page.getByPlaceholder(/Ask the agent/)
  await input.fill('plan')
  await input.press('Enter')
  // exact: the update_plan tool RESULT also names the open items now, so a
  // loose match would hit the expanded tool call as well as the card.
  await expect(page.getByText('Step three', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('2/3', { exact: true })).toBeVisible()
})

test('re-asking a message forks the conversation instead of overwriting it', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask the agent/)
  await input.fill('echo alpha')
  await input.press('Enter')
  await expect(page.getByText('alpha', { exact: true })).toBeVisible({ timeout: 10_000 })

  // Re-ask: the message comes back to the composer and the pending fork is
  // announced, but nothing has moved yet.
  await page.getByTitle(/Ask this again/).click()
  await expect(input).toHaveValue('echo alpha')
  await expect(page.getByText('Asking again')).toBeVisible()
  await expect(page.getByText('alpha', { exact: true })).toBeVisible()

  // Clicking the same message again must not paste it a second time on top of
  // the edit under way.
  await input.fill('echo alpha, but better')
  await page.getByTitle(/Ask this again/).click()
  await expect(input).toHaveValue('echo alpha, but better')

  await input.fill('echo beta')
  await input.press('Enter')
  await expect(page.getByText('beta', { exact: true })).toBeVisible({ timeout: 10_000 })
  // The first answer is off the branch being read — but not deleted.
  await expect(page.getByText('alpha', { exact: true })).toHaveCount(0)
  await expect(page.getByText('2/2', { exact: true })).toBeVisible()

  // ‹ walks back to the original, whole.
  await page.getByTitle('Previous version of this message').click()
  await expect(page.getByText('alpha', { exact: true })).toBeVisible()
  await expect(page.getByText('beta', { exact: true })).toHaveCount(0)
  await expect(page.getByText('1/2', { exact: true })).toBeVisible()
})

/** The thinking block: folded throughout, with the thought running along its
 *  own line while it streams. */
const thinkingBlock = (page: import('@playwright/test').Page) =>
  page.locator('details:has(summary:has-text("Thinking"))').first()

test('a thinking block streams on one line and never unfolds itself', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask the agent/)
  await input.fill('think ' + '推理中。'.repeat(900))
  await input.press('Enter')

  const block = thinkingBlock(page)
  await expect(block).toBeVisible({ timeout: 10_000 })
  // The thought is legible as it happens — on the summary, not as a wall of
  // text shoving the reply down the panel.
  await expect(block.locator('summary')).toContainText('推理中', { timeout: 10_000 })
  await expect(block).not.toHaveAttribute('open', '')

  await expect(page.getByText('Done thinking')).toBeVisible({ timeout: 20_000 })
  // The stream moved on, and the line went with it: a label and a duration.
  await expect(block).not.toHaveAttribute('open', '')
  await expect(block.locator('summary')).not.toContainText('推理中')
})

test('opening a streaming thinking block keeps it open past the stream', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask the agent/)
  // Long trail: the click below must land while the stream is still going, and
  // on a loaded machine (parallel suites) a short one can finish first.
  await input.fill('think ' + '推理中。'.repeat(900))
  await input.press('Enter')

  const block = thinkingBlock(page)
  await expect(block).toBeVisible({ timeout: 10_000 })
  await block.locator('summary').click()
  await expect(block).toHaveAttribute('open', '')
  await expect(page.getByText('Done thinking')).toBeVisible({ timeout: 20_000 })
  await expect(block).toHaveAttribute('open', '')
})

test('stop settles the transcript even when the tool ignores it', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask the agent/)
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
  const input = page.getByPlaceholder(/Ask the agent/)
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
  const stored = await page.evaluate(() => localStorage.getItem('localmd:settings'))
  expect(stored).toBeNull()
})

test('localmd Connect is presented as a permission to grant, not an id to copy', async ({
  page,
}) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  // The activity bar is icon-only (title, no text), so locate by its icon.
  await page.locator('nav button:has(.codicon-settings-gear)').click()
  await page.locator('button:has(.codicon-plug)').click()

  // Install it the way a user does — its switch on the Tools page, in the
  // Connections group (e2e runs licensed by default, so the group is open).
  await expect(page.getByText('localmd Connect browser extension')).toBeVisible()
  await page
    .locator('label', { hasText: 'localmd Connect browser extension' })
    .getByRole('checkbox')
    .click()

  // Checking the box probed it and, finding nothing, brought us straight here —
  // no going back and noticing "Setup needed" on the way. What is wrong is stated
  // BEFORE the steps that fix it.
  await expect(page.getByText(/Not answering on this page/)).toBeVisible()
  await expect(page.getByText('Set up localmd Connect')).toBeVisible()
  // The way in is the listing — no address to add by hand, because the extension
  // ships allowing this app.
  const store = page.getByRole('link', { name: /Chrome Web Store/ })
  await expect(store).toBeVisible()
  await expect(store).toHaveAttribute('href', /chromewebstore\.google\.com\/detail\/localmd-connect/)
  await expect(page.getByRole('button', { name: 'Reload this page' })).toBeVisible()
  // And nothing to copy: the id is the extension's to announce, not ours to pin.
  await expect(page.getByText('Chrome extension ID')).toHaveCount(0)

  // With no relay on the page, only a navigation can put one there — so Reload is
  // offered and "Check again" is NOT: it could only ever report failure while the
  // real fix sits next to it. (This is the bug the button-feedback pass exposed:
  // enable the extension on an open page, press Reconnect, nothing changes.)
  await expect(page.getByRole('button', { name: 'Check again' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reconnect' })).toHaveCount(0)
  await expect(page.getByText(/attaches to a page as it loads/)).toBeVisible()

  await page.locator('button:has(.codicon-arrow-left)').click()
  await expect(
    page.getByRole('button', { name: /localmd Connect browser extension/ }),
  ).toContainText('Setup needed')

  // "Setup needed" is the way BACK to the fix, not a bigger target for the
  // checkbox it sits inside: aiming at the one thing that names the problem
  // used to uninstall the extension.
  await page.getByRole('button', { name: 'Setup needed', exact: true }).click()
  await expect(page.getByText('Set up localmd Connect')).toBeVisible()
  await page.locator('button:has(.codicon-arrow-left)').click()
  await expect(
    page.locator('label', { hasText: 'localmd Connect browser extension' }).getByRole('checkbox'),
  ).toBeChecked()
})

test('a relay on the page is not the same as localmd Connect answering', async ({ page }) => {
  // The extension injects its relay per HOST but gates the connection on the
  // exact ORIGIN, so on another port of an allowed host the marker is present and
  // every call goes unanswered. Faking just the marker reproduces that exactly.
  await page.addInitScript(() => {
    const mark = (): void => {
      if (document.documentElement) document.documentElement.dataset.localmdConnect = 'a'.repeat(32)
    }
    mark()
    document.addEventListener('DOMContentLoaded', mark)
  })
  await page.goto('/?e2e=1')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.localmdConnect ?? null))
    .not.toBeNull()
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await page.locator('nav button:has(.codicon-settings-gear)').click()
  await page.locator('button:has(.codicon-plug)').click()
  await page
    .locator('label', { hasText: 'localmd Connect browser extension' })
    .getByRole('checkbox')
    .click()
  await page.locator('button:has(.codicon-arrow-left)').click()
  await page.getByRole('button', { name: /localmd Connect browser extension/ }).click()

  // Still the setup panel — and it says the extension is here but silent, which
  // is a different problem from not having it.
  await expect(page.getByText('Set up localmd Connect')).toBeVisible()
  await expect(page.getByText(/on this page but not answering it/)).toBeVisible()
  await expect(page.getByText(/Connected — localmd Connect is answering/)).toHaveCount(0)

  // Here a re-probe CAN succeed — the origin gate is consulted per connection, so
  // adding the address needs no reload — and pressing it has to be visible.
  const check = page.getByRole('button', { name: 'Check again' })
  await expect(check).toBeVisible()
  await check.click()
  // Both the button that started it and the line beside it say so.
  await expect(page.getByText('Checking…').first()).toBeVisible()
  await expect(check).toBeDisabled()
})

test('a citation quoted in code stays literal, while a real one becomes a chip', async ({
  page,
}) => {
  // The agent writes about citation syntax as often as it cites — the tokens
  // used to be rewritten by a pass over the whole text, which cannot tell the
  // two apart and put raw anchor HTML inside the code span.
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask the agent/)
  await input.fill('echo write `[[1:b16-3]]` to cite it, as in this claim [[1:b2-8]].')
  await input.press('Enter')

  const chip = page.locator('a.citation[data-block="b2-8"]')
  await expect(chip).toBeVisible({ timeout: 10_000 })
  // The quoted one is still a token, and did not become a second chip.
  await expect(page.locator('code', { hasText: '[[1:b16-3]]' })).toBeVisible()
  await expect(page.locator('a.citation[data-block="b16-3"]')).toHaveCount(0)
})

test('a file path the agent names is clickable, and only when the file exists', async ({ page }) => {
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  const input = page.getByPlaceholder(/Ask the agent/)
  // One real path (the scaffold wrote it) and one that names nothing.
  await input.fill('echo Wrote `wiki/index.md`, not `wiki/ghost.md`')
  await input.press('Enter')

  const linked = page.locator('a.file-path')
  await expect(linked).toHaveCount(1, { timeout: 10_000 })
  await expect(linked).toHaveAttribute('data-path', 'wiki/index.md')
  // The one that resolves to nothing stays plain code — no broken link, no nag.
  await expect(page.locator('.md-preview code', { hasText: 'wiki/ghost.md' })).toBeVisible()

  // Clicking opens it in the middle pane, like any other way into a file.
  await linked.click()
  await expect(page.locator('main').getByRole('button', { name: 'index.md' })).toBeVisible()
})
