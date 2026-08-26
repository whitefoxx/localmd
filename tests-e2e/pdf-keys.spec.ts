import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * A mounted PDF must not eat the app's keys. EmbedPDF's commands plugin
 * listens on `document` and preventDefaults every combo in its shortcut table
 * (⌘C included) — and PDF viewers stay mounted per open tab (v-show), so
 * before lib/pdfKeys took the table over, one background PDF tab killed ⌘C
 * for the whole app: text selected in the markdown preview or a chat reply
 * could not be copied until the PDF tab was closed. These tests pin the
 * takeover with the real key gesture and the real clipboard.
 */

/** A minimal one-page PDF, built by hand so the fixture stays readable. The
 *  xref offsets are computed, not guessed — pdfium accepts it as-is. */
function makePdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    null, // content stream, built below
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

/** Fresh KB with the fixture PDF imported and RENDERED (canvas on screen) —
 *  rendered matters: the shortcut listener registers on viewer ready. */
async function openKbWithPdf(page: Page): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'localmd-pdf-'))
  const file = path.join(dir, 'tiny.pdf')
  await writeFile(file, makePdf())

  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await page.locator('input[type="file"]').first().setInputFiles(file)
  const entry = page.locator('aside').getByText('tiny.pdf', { exact: true })
  await expect(entry).toBeVisible({ timeout: 10_000 })
  await entry.click()
  // Wait for the SHORTCUT LISTENER, not for pixels: what these tests exercise
  // is the keyboard path, and its readiness has a direct signal — a cancelable
  // synthetic ⌘C comes back defaultPrevented (dispatchEvent returns false)
  // once a document-level handler claims the combo. That is true of the
  // library's own listener and of the takeover alike, so the wait holds on
  // both sides of the fix. (The viewer paints inside nested shadow/iframe
  // structure that locators cannot reach — pixels were the wrong signal
  // anyway.) pdfium wasm boots in a worker, hence the generous timeout.
  await page.waitForFunction(
    () =>
      !document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'c', metaKey: true, cancelable: true, bubbles: true }),
      ),
    { timeout: 30_000 },
  )
}

/** Select the whole of the first element matching `selector` ("css|contains"),
 *  press the real copy key, and return what actually landed on the clipboard.
 *
 *  Select-and-press runs as ATTEMPTS: while the app is still settling (a chat
 *  reply re-rendering, the pdf indexer finishing), a re-render can replace the
 *  selected nodes and silently empty the selection before the key lands — a
 *  race a human never loses, because they select what they can already see
 *  holding still. Each attempt re-selects, presses, and gives the system
 *  clipboard a beat; SENTINEL surviving every attempt means the copy
 *  genuinely never happened, which is what the asserts are for. */
async function copyViaKeyboard(page: Page, selector: string): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText('SENTINEL'))
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.evaluate((sel) => {
      const [css, contains] = sel.split('|')
      const el = [...document.querySelectorAll(css)].find(
        (n) => !contains || n.textContent?.includes(contains),
      )!
      const r = document.createRange()
      r.selectNodeContents(el)
      const g = getSelection()!
      g.removeAllRanges()
      g.addRange(r)
    }, selector)
    await page.keyboard.press('ControlOrMeta+C')
    await page.waitForTimeout(300)
    const clip = (await page.evaluate(() => navigator.clipboard.readText())).trim()
    if (clip !== 'SENTINEL') return clip
  }
  return 'SENTINEL'
}

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  // Real system Chrome: a second test's window can open behind the first's,
  // and an OS-unfocused window never performs the native copy the real ⌘C
  // asks for (clipboard.writeText still works, which makes it look like the
  // key was eaten). Front the window before trusting any key gesture.
  await page.bringToFront()
})

test('⌘C still copies from the preview while a PDF tab sits in the background', async ({ page }) => {
  test.setTimeout(60_000)
  await openKbWithPdf(page)
  // Switch to the scaffolded index — the PDF is now hidden but stays mounted.
  await page.locator('aside').getByText('index.md', { exact: true }).first().click()
  await expect(page.locator('[data-file-selection] .md-preview').first()).toBeVisible()

  const clip = await copyViaKeyboard(page, '[data-file-selection] .md-preview p')
  expect(clip).not.toBe('SENTINEL') // the copy actually happened
  expect(clip.length).toBeGreaterThan(0)
})

test('⌘C over a chat reply wins even while the PDF is on screen', async ({ page }) => {
  test.setTimeout(60_000)
  await openKbWithPdf(page)
  // A mock reply beside the visible PDF — the user's original scenario.
  const input = page.getByPlaceholder(/Ask the agent/)
  await input.fill('echo COPYTARGET from beside the pdf')
  await input.press('Enter')
  await expect(page.locator('.md-preview', { hasText: 'COPYTARGET' }).last()).toBeVisible({
    timeout: 10_000,
  })

  // The user's gesture leaves focus on BODY, not the composer (both the
  // library and the takeover exempt editable targets, so a focused textarea
  // was never part of the bug).
  await input.blur()
  const clip = await copyViaKeyboard(page, '.md-preview|COPYTARGET')
  expect(clip).toContain('COPYTARGET')
})
