import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Driving the app's own dialog, which replaced the browser's.
 *
 * These used to be `page.on('dialog', …)`: Playwright answering a native
 * confirm out of band, which meant a spec could only ever assert on the
 * message string. Ours is markup, so it can be looked at — and has to be
 * clicked, which is closer to what a user does anyway.
 */
export const dialog = (page: Page): Locator => page.locator('[data-dialog]')

/** Press the confirm button, whatever this caller labelled it, and return what
 *  the dialog said — the string the old `d.message()` used to give. */
export async function acceptDialog(page: Page): Promise<string> {
  return settle(page, '[data-dialog-accept]')
}

/** Press Cancel. */
export async function dismissDialog(page: Page): Promise<string> {
  return settle(page, '[data-dialog-cancel]')
}

async function settle(page: Page, button: string): Promise<string> {
  const box = dialog(page)
  await expect(box).toBeVisible({ timeout: 10_000 })
  const said = (await box.innerText()).trim()
  await box.locator(button).click()
  await expect(box).toBeHidden()
  return said
}

/** Nothing is being asked. The assertion a spec makes when the whole point is
 *  that a path went through without stopping anyone. */
export async function expectNoDialog(page: Page): Promise<void> {
  await expect(dialog(page)).toHaveCount(0)
}
