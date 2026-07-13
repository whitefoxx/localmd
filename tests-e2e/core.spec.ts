import { test, expect } from '@playwright/test'

/**
 * Core flows against the in-memory KB + mock provider (?e2e=1):
 * scaffold → chat streaming → agent write + review approve.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?e2e=1')
  // The e2e bootstrap opens the memory KB; the empty-folder scaffold offer
  // is the first thing we should see.
  await expect(page.getByText('这个文件夹还是空的')).toBeVisible({ timeout: 10_000 })
})

test('scaffold initializes the KB and opens the index', async ({ page }) => {
  await page.getByRole('button', { name: /初始化知识库/ }).click()
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
  await page.getByRole('button', { name: /初始化知识库/ }).click()
  const input = page.getByPlaceholder(/Ask or instruct/)
  await input.fill('echo 流式测试成功')
  await input.press('Enter')
  await expect(page.getByText('流式测试成功').last()).toBeVisible({ timeout: 10_000 })
})

test('agent write shows up in review and can be approved', async ({ page }) => {
  await page.getByRole('button', { name: /初始化知识库/ }).click()
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

test('plan tool renders the checklist card', async ({ page }) => {
  await page.getByRole('button', { name: /初始化知识库/ }).click()
  const input = page.getByPlaceholder(/Ask or instruct/)
  await input.fill('plan')
  await input.press('Enter')
  await expect(page.getByText('第三步')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('2/3', { exact: true })).toBeVisible()
})

test('scrolling up during a stream detaches auto-follow', async ({ page }) => {
  await page.getByRole('button', { name: /初始化知识库/ }).click()
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
  await page.getByRole('button', { name: /初始化知识库/ }).click()
  const stored = await page.evaluate(() => localStorage.getItem('browser-md:settings'))
  expect(stored).toBeNull()
})
