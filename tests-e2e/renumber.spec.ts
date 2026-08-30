import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

/**
 * Opening a document the notes already cite, with no index to inherit block
 * ids from — the second-machine case, since `.localmd/` is gitignored and a
 * clone brings the notes without it.
 *
 * Worth an end-to-end test rather than only unit ones because the hazard is
 * precisely that nothing visible happens: the viewer indexes on open, the
 * build renumbers, and every citation still resolves — to the wrong paragraph.
 * What is asserted here is the absence of that silence.
 *
 * EPUB is the fixture because it needs no committed binary. The gate itself is
 * shared (lib/renumber); what differs per viewer is only the wiring.
 */

async function makeEpub(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:localmd-renumber-fixture</dc:identifier>
<dc:title>A Cited Book</dc:title><dc:language>en</dc:language>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="c1"/></spine>
</package>`,
  )
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Chapter 1</a></li></ol></nav></body></html>`,
  )
  zip.file(
    'OEBPS/c1.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head>
<body><h1>Chapter 1</h1>
${Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i + 1} of the cited book.</p>`).join('\n')}
</body></html>`,
  )
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
}

/** A KB holding the book and a page that cites two passages in it. */
async function openCitedBook(page: Page): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'localmd-renumber-'))
  const book = path.join(dir, 'cited-book.epub')
  const note = path.join(dir, 'reading-note.md')
  await writeFile(book, await makeEpub())
  await writeFile(
    note,
    'Sources: [[epub1:cited-book.epub]]\n\nIt says so at [[1:b1-3]], and again at [[1:b1-7]].\n',
  )

  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await page.locator('input[type="file"]').first().setInputFiles([book, note])
  const entry = page.locator('aside').getByText('cited-book.epub', { exact: true })
  await expect(entry).toBeVisible({ timeout: 10_000 })
  await entry.click()
}

test('indexing on open stops when it would renumber cited passages', async ({ page }) => {
  // Any dialog here would be a failure of the premise: the automatic path must
  // never prompt. Accepting keeps a mistake visible as a failed assertion
  // rather than a hung test.
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.accept()
  })

  await openCitedBook(page)

  const paused = page.getByRole('button', { name: 'Indexing paused' })
  await expect(paused).toBeVisible({ timeout: 15_000 })
  expect(dialogs).toEqual([])

  // The badge is the only way past, and it says what is at stake in numbers.
  await paused.click()
  await expect(paused).toBeHidden({ timeout: 15_000 })
  expect(dialogs).toHaveLength(1)
  expect(dialogs[0]).toContain('2 passage(s)')
  expect(dialogs[0]).toContain('1 page(s)')
})

test('a document nobody cites is indexed on open as before', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.accept()
  })

  const dir = await mkdtemp(path.join(tmpdir(), 'localmd-renumber-'))
  const book = path.join(dir, 'uncited-book.epub')
  await writeFile(book, await makeEpub())

  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await page.locator('input[type="file"]').first().setInputFiles(book)
  await page.locator('aside').getByText('uncited-book.epub', { exact: true }).click()

  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Indexing paused' })).toBeHidden()
  expect(dialogs).toEqual([])
})

/**
 * The agent reaches the same hazard by the likelier route — asked a question
 * about a book on a freshly cloned KB, it indexes first. It may not answer
 * this one on the user's behalf, so the turn pauses on a card.
 */
test('the agent asks before an index build that would renumber', async ({ page }) => {
  page.on('dialog', (d) => void d.dismiss())
  await openCitedBook(page)
  await expect(page.getByRole('button', { name: 'Indexing paused' })).toBeVisible({
    timeout: 15_000,
  })

  // Imported into whatever the tree has selected, which straight after
  // initializing is the scaffold's wiki/ — the citation finds it by basename
  // either way, but the tool is given a real path.
  const input = page.getByPlaceholder(/Ask the agent/)
  await input.fill('index wiki/cited-book.epub')
  await input.press('Enter')

  const card = page.locator('.rounded-xl').filter({ hasText: 'wiki/cited-book.epub' })
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toContainText('2 passage(s)')
  await expect(card.getByRole('button', { name: 'Approve' })).toBeVisible()

  // Rejecting is an answer: the card becomes a record of it, and the model is
  // told it was refused rather than left to retry. (The tool result is behind
  // a collapsed block, so it is read rather than looked at.)
  await card.getByRole('button', { name: 'Reject' }).click()
  await expect(card).toContainText('Rejected', { timeout: 15_000 })
  await expect(page.locator('pre').filter({ hasText: 'User declined indexing' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Indexing paused' })).toBeVisible()
})
