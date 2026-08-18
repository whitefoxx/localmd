import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

/**
 * EPUB reading against the in-memory KB (?e2e=1). The book is built here rather
 * than committed as a binary, and is deliberately long enough to paginate into
 * many screens — the things worth testing about a paginated reader only happen
 * once there is more than one page.
 */

const CHAPTERS = 3
const PARAS = 40

function chapterXhtml(n: number): string {
  const paras = Array.from(
    { length: PARAS },
    (_, i) =>
      `<p>Chapter ${n} paragraph ${i + 1}. ` +
      'The quick brown fox jumps over the lazy dog, and keeps jumping for as ' +
      'long as it takes to fill a line of type, then another, then a few more, ' +
      'so that this paragraph occupies a useful fraction of a rendered page. ' +
      `Paragraph ${i + 1} of chapter ${n} ends here.</p>`,
  ).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title></head>
<body><h1>Chapter ${n}</h1>
${paras}
</body></html>`
}

async function makeEpub(): Promise<Buffer> {
  const zip = new JSZip()
  // Uncompressed and first in the archive, as the spec requires.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  )
  const ids = Array.from({ length: CHAPTERS }, (_, i) => i + 1)
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:browser-md-epub-fixture</dc:identifier>
<dc:title>A Long Enough Book</dc:title><dc:language>en</dc:language>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${ids.map((n) => `<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine>${ids.map((n) => `<itemref idref="c${n}"/>`).join('')}</spine>
</package>`,
  )
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
${ids.map((n) => `<li><a href="c${n}.xhtml">Chapter ${n}</a></li>`).join('\n')}
</ol></nav></body></html>`,
  )
  for (const n of ids) zip.file(`OEBPS/c${n}.xhtml`, chapterXhtml(n))
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
}

/** Open a fresh KB with the book imported and rendered, sitting on page one. */
async function openBook(page: Page): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'browser-md-epub-'))
  const file = path.join(dir, 'long-book.epub')
  await writeFile(file, await makeEpub())

  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await page.locator('input[type="file"]').first().setInputFiles(file)
  const entry = page.locator('aside').getByText('long-book.epub', { exact: true })
  await expect(entry).toBeVisible({ timeout: 10_000 })
  await entry.click()
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 15_000 })
}

/** The reader's own position readout — "12 / 340", or a percentage before the
 *  location index finishes. Both are layout-independent, which is the point:
 *  repagination may change how much text a page holds, never where we are. */
async function position(page: Page): Promise<string> {
  return (
    await page.locator('.absolute.inset-x-0.bottom-0').first().textContent()
  )?.trim() as string
}

/** The opening words of every block currently on screen, so a jump is visible
 *  as text rather than inferred from a number. */
async function visibleText(page: Page): Promise<string> {
  return await page.evaluate(() => {
    // A chapter is one iframe as wide as all its columns; the .epub-container
    // scrolls it sideways, so the page on screen is the slice of that width
    // starting at scrollLeft.
    const scroller = document.querySelector('.epub-container') as HTMLElement | null
    const doc = (document.querySelector('iframe') as HTMLIFrameElement | null)?.contentDocument
    if (!scroller || !doc) return '(no reader)'
    const from = scroller.scrollLeft
    const to = from + scroller.clientWidth
    const seen: string[] = []
    for (const el of Array.from(doc.body.querySelectorAll('p, h1'))) {
      const r = el.getBoundingClientRect()
      if (r.right > from + 1 && r.left < to - 1) seen.push((el.textContent ?? '').slice(0, 28))
    }
    return seen.join(' | ') || '(blank page)'
  })
}

test('the book is laid out at its final size before its first page is drawn', async ({
  page,
}) => {
  // The reader holds a strip of height back (HEIGHT_SLACK) so a browser bar
  // cannot repaginate it. Applying that AFTER the first display re-flowed every
  // book ~150ms into every open — long enough for display(cfi) to have landed,
  // so a jump to an annotation was read against a pagination that no longer
  // existed and came up a page short. Sampling from before the reader exists is
  // the only way to see it: by the time a page is on screen it is over.
  const dir = await mkdtemp(path.join(tmpdir(), 'browser-md-epub-'))
  const file = path.join(dir, 'long-book.epub')
  await writeFile(file, await makeEpub())

  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await page.locator('input[type="file"]').first().setInputFiles(file)
  const entry = page.locator('aside').getByText('long-book.epub', { exact: true })
  await expect(entry).toBeVisible({ timeout: 10_000 })
  await entry.click()

  const heights = await page.evaluate(async () => {
    const seen: number[] = []
    const deadline = Date.now() + 15_000
    let firstAt = 0
    while (Date.now() < deadline) {
      const stage = document.querySelector('.epub-container') as HTMLElement | null
      const h = stage?.clientHeight ?? 0
      if (h) {
        firstAt ||= Date.now()
        if (seen[seen.length - 1] !== h) seen.push(h)
        if (Date.now() - firstAt > 1200) break // past the observer's debounce
      }
      await new Promise((r) => setTimeout(r, 40))
    }
    return seen
  })
  expect(heights).toHaveLength(1)
})

test('a strip of viewport lost to a browser bar does not move the reader', async ({ page }) => {
  await openBook(page)
  const size = page.viewportSize()!

  // Read a few pages in, so a jump would have somewhere to jump from.
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(500)
  const page6 = await position(page)
  const text6 = await visibleText(page)
  expect(text6).toContain('paragraph')

  // What a Chrome infobar does to a reader: the viewport loses ~40px and a
  // paginated book reflows under it.
  await page.setViewportSize({ width: size.width, height: size.height - 40 })
  await page.waitForTimeout(1000) // the refit is debounced

  expect(await position(page)).toBe(page6)
  expect(await visibleText(page)).toBe(text6)
})

test('a real change of shape still repaginates, without skipping past the reader', async ({
  page,
}) => {
  await openBook(page)
  const size = page.viewportSize()!
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(500)
  const firstOnPage = (await visibleText(page)).split(' | ')[0]

  // Far more than the slack — this one has to reflow, or the bottom of the
  // page would be cut off and its last lines never read.
  await page.setViewportSize({ width: size.width, height: size.height - 250 })
  await page.waitForTimeout(1000)

  // The page holds less, but the line being read is still on screen: epub.js
  // lands on the page containing it, never past it.
  expect(await visibleText(page)).toContain(firstOnPage)
  const fits = await page.evaluate(() => {
    const stage = document.querySelector('.epub-container') as HTMLElement
    const slot = stage.parentElement as HTMLElement
    return stage.clientHeight <= slot.clientHeight
  })
  expect(fits).toBe(true)
})

test('zen mode leaves the page and nothing else, and the toolbar comes back on approach', async ({
  page,
}) => {
  await openBook(page)
  const chrome = page.locator('aside').getByText('wiki', { exact: true })
  await expect(chrome).toBeVisible()

  await page.getByTitle(/Zen mode/).click()

  // Everything the app puts around the page is gone…
  await expect(chrome).toBeHidden()
  await expect(page.locator('nav')).toHaveCount(0)
  // …including the reader's own toolbar, which is now an overlay at zero opacity
  // rather than a gap in the layout.
  const toolbar = page.locator('.codicon-list-tree').first().locator('xpath=ancestor::div[1]')
  await page.mouse.move(400, 400)
  await expect
    .poll(() => toolbar.evaluate((el) => getComputedStyle(el).opacity))
    .toBe('0')

  // The cursor going looking for the controls brings them back.
  await page.mouse.move(400, 8)
  await expect.poll(() => toolbar.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')

  // Esc is the way out from anywhere, including with focus inside the chapter.
  await page.keyboard.press('Escape')
  await expect(chrome).toBeVisible()
})
