import { test, expect, type Page } from '@playwright/test'

/**
 * Settings → Models, from the outside.
 *
 * Two things live here that no unit test can see. The first is that leaving the
 * profile editor by any route keeps what you typed: five controls close it, they
 * used to disagree about whether an API key survived, and one of them (Esc) was
 * being handled by a listener that could never fire. The second is which model
 * each role will accept — a question the app used to answer from the provider id,
 * which says nothing about a Custom endpoint and goes stale for everyone else.
 *
 * Both are reachable only by driving the real modal: the store beneath it was
 * green throughout.
 */

async function openModels(page: Page): Promise<void> {
  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await page.locator('nav button:has(.codicon-settings-gear)').click()
  await page.locator('aside button:has-text("Models")').first().click()
}

/** Fill the editor with a saveable Custom profile — key and model are what Save
 *  itself requires, so anything less is the "cannot be saved" case. */
async function fillValid(page: Page, model: string): Promise<void> {
  await page.getByRole('button', { name: /Add model/ }).click()
  await page.locator('select').first().selectOption('custom')
  await page.locator('input[placeholder="https://api.example.com/v1"]').fill('https://x.test/v1')
  await page.locator('input[type=password]').fill('sk-test')
  await page.locator('input[list=model-suggestions]').fill(model)
}

/** The row a saved profile gets in the list, by its `provider · model` subtitle
 *  (the role dropdowns carry the *label*, which reads differently). */
const savedRow = (page: Page, model: string) =>
  page.getByText(`custom · ${model}`, { exact: true })

/** A role's select, found through the label beside it rather than by position —
 *  a fourth row on this pane should not silently retarget these tests. */
const roleSelect = (page: Page, label: string) =>
  page.locator(`div:has(> div:text-is("${label}")) > select`)

const reopenSettings = (page: Page) =>
  page.locator('nav button:has(.codicon-settings-gear)').click()

test.describe('leaving the profile editor', () => {
  test('every exit commits a valid edit', async ({ page }) => {
    await openModels(page)

    await fillValid(page, 'exit-back')
    await page.locator('.codicon-arrow-left').click()
    await expect(savedRow(page, 'exit-back')).toBeVisible()

    await fillValid(page, 'exit-sidebar')
    await page.locator('aside button:has-text("General")').first().click()
    await page.locator('aside button:has-text("Models")').first().click()
    await expect(savedRow(page, 'exit-sidebar')).toBeVisible()

    await fillValid(page, 'exit-x')
    await page.getByTitle('Close (Esc)').click()
    await reopenSettings(page)
    await expect(savedRow(page, 'exit-x')).toBeVisible()

    await fillValid(page, 'exit-backdrop')
    await page.mouse.click(20, 20)
    await reopenSettings(page)
    await expect(savedRow(page, 'exit-backdrop')).toBeVisible()

    // Esc is the one App.vue's layer chain owns; it reaches the editor through
    // the guard the modal installs, not through a listener of its own.
    await fillValid(page, 'exit-esc')
    await page.keyboard.press('Escape')
    await reopenSettings(page)
    await expect(savedRow(page, 'exit-esc')).toBeVisible()
  })

  test('an edit Save would refuse asks before it is dropped', async ({ page }) => {
    await openModels(page)
    page.on('dialog', (d) => void d.dismiss())
    await page.getByRole('button', { name: /Add model/ }).click()
    await page.locator('select').first().selectOption('custom')
    await page.locator('input[placeholder="https://api.example.com/v1"]').fill('https://x.test/v1')
    await page.keyboard.press('Escape')
    // Declined: still editing, the modal still up — and nothing underneath it
    // closed instead, which is what folding the question into the layer chain's
    // own condition would have done.
    await expect(page.locator('input[placeholder="https://api.example.com/v1"]')).toHaveValue(
      'https://x.test/v1',
    )
    await expect(page.getByTitle('Close (Esc)')).toBeVisible()
  })

  test('a form nobody typed into leaves without a word', async ({ page }) => {
    await openModels(page)
    let asked = false
    page.on('dialog', (d) => {
      asked = true
      void d.accept()
    })
    await page.getByRole('button', { name: /Add model/ }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Model profiles')).toBeHidden()
    expect(asked).toBe(false)
  })
})

test.describe('what a model is marked for', () => {
  /** Add a Custom profile with exactly these boxes ticked. */
  async function addProfile(page: Page, model: string, caps: string[]): Promise<void> {
    await fillValid(page, model)
    for (const label of ['Chat', 'Reads images', 'Generates images']) {
      const box = page.locator('label', { hasText: label }).getByRole('checkbox')
      if ((await box.isChecked()) !== caps.includes(label)) await box.click()
    }
    await page.locator('.codicon-arrow-left').click()
  }

  test('a Custom profile starts as chat only, and the roles say so', async ({ page }) => {
    await openModels(page)
    await addProfile(page, 'plain-custom', ['Chat'])
    // Chat-marked, so it is a plain option in the primary list…
    await expect(roleSelect(page, 'Primary').locator('optgroup')).toHaveCount(0)
    // …and not image-marked, so the image list files it under the heading. A
    // provider id could not have told us either of those about this endpoint.
    const grouped = await roleSelect(page, 'Image generation')
      .locator('optgroup option')
      .allTextContents()
    expect(grouped.some((t) => t.includes('plain-custom'))).toBe(true)
  })

  test('picking an unmarked profile asks, and a yes writes the mark', async ({ page }) => {
    await openModels(page)
    await addProfile(page, 'draws-actually', ['Chat'])
    const messages: string[] = []
    page.on('dialog', (d) => {
      messages.push(d.message())
      void d.accept()
    })

    const sel = roleSelect(page, 'Image generation')
    const id = await sel
      .locator('optgroup option', { hasText: 'draws-actually' })
      .getAttribute('value')
    await sel.selectOption(id!)
    expect(messages.length).toBe(1)
    expect(messages[0]).toContain('not marked as generating images')
    // The answer is kept, not asked again: it has left the heading for good.
    await expect(sel.locator('optgroup option', { hasText: 'draws-actually' })).toHaveCount(0)
  })

  test('a no leaves the role where it was', async ({ page }) => {
    await openModels(page)
    await addProfile(page, 'stays-chat', ['Chat'])
    page.on('dialog', (d) => void d.dismiss())
    const sel = roleSelect(page, 'Image generation')
    const id = await sel.locator('optgroup option', { hasText: 'stays-chat' }).getAttribute('value')
    await sel.selectOption(id!)
    // Role unset, mark unwritten — and the select itself back where it was,
    // which an unchanged store would not have done on its own.
    await expect(sel).toHaveValue('')
    await expect(sel.locator('optgroup option', { hasText: 'stays-chat' })).toHaveCount(1)
  })

  test('an image-only profile is not offered as a primary without a question', async ({ page }) => {
    // The mix-up the marks exist for: a draw-only endpoint in the primary role,
    // answering every message with an error about the address.
    await openModels(page)
    await addProfile(page, 'image-only', ['Generates images'])
    const grouped = await roleSelect(page, 'Primary').locator('optgroup option').allTextContents()
    expect(grouped.some((t) => t.includes('image-only'))).toBe(true)
  })
})
