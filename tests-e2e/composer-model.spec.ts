import { test, expect, type Page } from '@playwright/test'

/**
 * The model line under the composer, from the outside.
 *
 * It is a second door onto the roles that Settings → Models owns, and a second
 * door is exactly where the two get to disagree: this one used to list every
 * configured profile flat, so an image-generation endpoint could be made the
 * primary with one click and then answered every message with an error about
 * its address. The store was green throughout — both menus call the same
 * `setSlot`, and what differed was only which profiles each offered.
 *
 * So what is asserted here is agreement with Settings: the same split, the same
 * question before an unmarked profile counts, and the same nothing-happens on a
 * no. Plus the two things this line has that Settings does not — a heading, because one menu now serves two
 * roles, and an eye that opens the vision one.
 */

async function openKb(page: Page): Promise<void> {
  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
}

/** Add a Custom profile with exactly these capability boxes ticked, through the
 *  real editor — the marks are what this file is about, so they are not faked
 *  into the store. */
async function addProfile(page: Page, model: string, caps: string[]): Promise<void> {
  await page.locator('nav button:has(.codicon-settings-gear)').click()
  await page.locator('aside button:has-text("Models")').first().click()
  await page.getByRole('button', { name: /Add model/ }).click()
  await page.locator('select').first().selectOption('custom')
  await page.locator('input[placeholder="https://api.example.com/v1"]').fill('https://x.test/v1')
  await page.locator('input[type=password]').fill('sk-test')
  await page.locator('input[list=model-suggestions]').fill(model)
  for (const label of ['Chat', 'Reads images', 'Generates images']) {
    const box = page.locator('label', { hasText: label }).getByRole('checkbox')
    if ((await box.isChecked()) !== caps.includes(label)) await box.click()
  }
  await page.locator('.codicon-arrow-left').click()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Model profiles')).toBeHidden()
}

/** The open menu's rows, in order, so "which side of the heading" is answerable
 *  rather than merely "is it present somewhere". */
async function menuRows(page: Page): Promise<string[]> {
  return (await page.locator('.absolute.bottom-full button, .absolute.bottom-full div').allTextContents())
    .map((t) => t.trim())
    .filter(Boolean)
}

const openPrimaryMenu = (page: Page) => page.locator('button[aria-label="Switch model"]').click()
const openVisionMenu = (page: Page) =>
  page.locator('button[aria-label="Choose which model reads images"]').click()

test('the composer names the role it is filling', async ({ page }) => {
  await openKb(page)
  await openPrimaryMenu(page)
  await expect(page.getByText('Use for: Primary')).toBeVisible()
  // Same panel, other door. Without the heading these are indistinguishable,
  // and picking from the vision one looks like a switcher that did not switch.
  await page.keyboard.press('Escape').catch(() => {})
  await page.locator('.fixed.inset-0').click()
  await openVisionMenu(page)
  await expect(page.getByText('Use for: Vision')).toBeVisible()
  // Vision is the role allowed to be empty — the primary usually reads images
  // itself, and there has to be a way back to that.
  await expect(page.getByText('Not set', { exact: true })).toBeVisible()
})

test('an image-only profile is not offered as the primary without a question', async ({ page }) => {
  await openKb(page)
  await addProfile(page, 'image-only', ['Generates images'])
  await openPrimaryMenu(page)

  const rows = await menuRows(page)
  const heading = rows.findIndex((t) => t === 'Not marked for this')
  const target = rows.findIndex((t) => t.includes('image-only'))
  expect(heading).toBeGreaterThan(-1)
  // Listed, not hidden — a menu that silently omitted someone's endpoint is how
  // "this app doesn't support my provider" starts — but below the line.
  expect(target).toBeGreaterThan(heading)
})

test('picking an unmarked profile asks, and a no changes nothing', async ({ page }) => {
  await openKb(page)
  await addProfile(page, 'image-only', ['Generates images'])

  const before = await page.locator('button[aria-label="Switch model"]').textContent()
  const messages: string[] = []
  page.on('dialog', (d) => {
    messages.push(d.message())
    void d.dismiss()
  })

  await openPrimaryMenu(page)
  await page.locator('.absolute.bottom-full button', { hasText: 'image-only' }).click()
  expect(messages.length).toBe(1)
  expect(messages[0]).toContain('not marked as a chat model')
  // A no leaves the slot alone, which is the whole difference from a menu that
  // assigns whatever was clicked.
  await expect(page.locator('button[aria-label="Switch model"]')).toHaveText(before!.trim())
})
