import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * What the knowledge base can say about itself without anyone reading a page:
 * the health findings as filters, the links a page should have and does not,
 * and the count a folder of documents shows before anything is opened.
 *
 * All three are computed views. None of them writes, so what these tests pin
 * is that the answers reach a person — which was the whole complaint they were
 * built from: a finding nobody can ask for is one nobody meets.
 */

/** A minimal one-page PDF (the fixture from pdf-keys, kept byte-identical in
 *  spirit: hand-built so it stays readable, offsets computed not guessed). */
function makePdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    null as string | null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const stream = 'BT /F1 18 Tf 40 100 Td (Tiny fixture) Tj ET'
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefAt = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const at of offsets) body += `${String(at).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

async function freshKb(page: Page): Promise<void> {
  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await expect(page.locator('main').getByRole('button', { name: 'index.md' })).toBeVisible({
    timeout: 10_000,
  })
}

/** Write one page through the agent and approve it, so the index has it.
 *  The mock's `write` script is one line, so the content is too. */
async function agentWrite(page: Page, file: string, content: string): Promise<void> {
  const input = page.getByPlaceholder(/Ask the agent/)
  await input.fill(`write ${file} ${content}`)
  await input.press('Enter')
  const review = page.getByTitle('Review agent changes')
  await expect(review).toBeVisible({ timeout: 10_000 })
  await review.click()
  await page.getByRole('button', { name: 'Approve all' }).click()
  await expect(review).toBeHidden()
  // Approving empties the review but leaves its panel up, and the panel is a
  // full-screen overlay — anything clicked next would land on it.
  await page.keyboard.press('Escape')
  await expect(page.locator('.fixed.inset-0.z-50')).toHaveCount(0)
}

test('a health finding can be asked for in the palette', async ({ page }) => {
  await freshKb(page)
  // A page with no frontmatter is the cheapest finding to produce, and until
  // now the only way to see it was to ask the agent for a whole health pass.
  await agentWrite(page, 'wiki/bare.md', 'no frontmatter here, just a line')

  await page.getByTitle(/^Search \(/).click()
  // The placeholder changes with the mode, so the box is located by the panel.
  const box = page.locator('[data-palette] input')
  await expect(box).toBeVisible()

  // `?` alone advertises the new keys — typing a filter is how anyone finds
  // out it exists.
  await box.fill('?')
  const rows = page.locator('[data-palette] button')
  await expect(rows.filter({ hasText: 'stale:' })).toBeVisible()
  await expect(rows.filter({ hasText: 'no-frontmatter:' })).toBeVisible()

  await box.fill('?no-frontmatter:true')
  await expect(rows.filter({ hasText: 'bare.md' })).toBeVisible()
  // The scaffolded pages all have frontmatter, so this is a filter and not a
  // list of everything.
  await expect(rows.filter({ hasText: 'wiki/index.md' })).toHaveCount(0)
})

test('the agent is handed the links a page should have and does not', async ({ page }) => {
  await freshKb(page)
  await agentWrite(page, 'wiki/attention.md', '# Attention')
  // No heading: a page's own H1 is its title, and the longest-match rule
  // rightly swallows a page naming itself — which would leave nothing behind
  // it to find in a file whose only line is its own title.
  await agentWrite(page, 'wiki/notes.md', 'the attention mechanism matters here')

  const input = page.getByPlaceholder(/Ask the agent/)
  await input.fill('health')
  await input.press('Enter')

  // The reply IS the tool result (see agent/mock), so this reads what the
  // agent was actually given rather than that a tool ran.
  // Scoped to the streamed reply: the tool-result block above it holds the
  // same text, and matching both is a strict-mode violation rather than a
  // stronger assertion.
  const reply = page.getByRole('paragraph').filter({ hasText: 'Pages named without a link' })
  await expect(reply).toBeVisible({ timeout: 20_000 })
  await expect(reply).toContainText('wiki/attention.md ← "Attention"')
  await expect(reply).toContainText('wiki/notes.md:1')
})

test('a folder of documents says what has not been read yet', async ({ page }) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'localmd-health-'))
  const file = path.join(dir, 'unread.pdf')
  await writeFile(file, makePdf())

  await freshKb(page)
  await page.locator('input[type="file"]').first().setInputFiles(file)
  await expect(page.locator('aside').getByText('unread.pdf', { exact: true })).toBeVisible({
    timeout: 20_000,
  })

  // Nothing open is the one screen with room to say it — and the honest state
  // for a folder that has no home page of its own.
  await page.getByTitle(/^Search \(/).click()
  const box = page.locator('[data-palette] input')
  await box.fill('>Close all file tabs')
  await page.keyboard.press('Enter')

  await expect(page.getByText(/Nothing has been written yet about 1 of the 1 documents/)).toBeVisible()
  await page.getByRole('button', { name: 'See which' }).click()
  await expect(page.getByText('unread.pdf').first()).toBeVisible()
})
