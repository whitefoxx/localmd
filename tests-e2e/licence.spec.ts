import { test, expect } from '@playwright/test'

/**
 * The licence gate, from the outside.
 *
 * Its own file rather than a test inside core.spec.ts, and not for tidiness:
 * the gate is the hosted edition's, so this whole file is one of the things
 * the open-source export drops (see scripts/oss-manifest.json). A single test
 * buried among twenty good ones cannot be dropped without dropping them too.
 *
 * The rest of the suite runs with the e2e default licence, the same way it runs
 * with the mock LLM. This is the one flow that runs unlicensed on purpose.
 */
test('without a licence the Connections group is visible, locked, and says why', async ({
  page,
}) => {
  await page.goto('/?e2e=1&e2e-unlicensed=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await page.locator('nav button:has(.codicon-settings-gear)').click()
  await page.locator('button:has(.codicon-plug)').click()

  // Bundled tools stay free and usable — the price is a pill beside the group
  // name now, not a clause inside it.
  await expect(page.getByText('Bundled tools', { exact: true })).toBeVisible()
  await expect(page.getByText('Free', { exact: true })).toBeVisible()
  await expect(
    page.locator('label', { hasText: 'Jina web tools' }).getByRole('checkbox'),
  ).toBeEnabled()

  // …the paid group is present — a hidden feature just looks missing — but
  // locked: the hint says why, and the doors are disabled rather than absent.
  await expect(page.getByText('Connections', { exact: true })).toBeVisible()
  // Two paid groups now: Connections and the Advanced doors below it.
  await expect(page.getByText('Paid', { exact: true })).toHaveCount(2)
  await expect(page.getByText(/needs a licence/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Describe it to the agent' })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Add an MCP server/ })).toBeDisabled()
})
