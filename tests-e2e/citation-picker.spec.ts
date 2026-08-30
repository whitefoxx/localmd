import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

/**
 * A citation chip that names no source used to open whichever document the
 * section cache had loaded first — silently, and often the wrong book, because
 * block ids are per-document names and every book has a `b1-1`. It also opened
 * a tab onto documents that no longer existed, since an index outlives its
 * source.
 *
 * Both now stop at a picker. This drives it in a real browser: the two states
 * it has, and the fact that neither one navigates on its own.
 */

/** A one-chapter book, distinguishable by its text. */
async function makeEpub(title: string, line: string): Promise<Buffer> {
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
<dc:identifier id="bookid">urn:uuid:${title}</dc:identifier>
<dc:title>${title}</dc:title><dc:language>en</dc:language>
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
<body><h1>Chapter 1</h1><p>${line}</p></body></html>`,
  )
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
}

async function initKb(page: Page): Promise<void> {
  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
}

async function importInto(page: Page, files: string[]): Promise<void> {
  await page.locator('input[type="file"]').first().setInputFiles(files)
}

/** The palette finds a document's text only once its index exists, so it is
 *  also the readiness signal for "this book has been indexed". */
async function waitIndexed(page: Page, phrase: string): Promise<void> {
  await page.getByTitle(/^Search \(/).click()
  const input = page.getByPlaceholder(/Search files and content/)
  await expect(input).toBeVisible()
  await input.fill(phrase)
  await expect(page.locator('[data-palette]').getByText(phrase, { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  })
  await page.keyboard.press('Escape')
}

const picker = (page: Page) => page.locator('[data-citation-picker]')

test('a block id two books both hold is a question, not a jump', async ({ page }) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'localmd-cite-'))
  const a = path.join(dir, 'alpha-book.epub')
  const b = path.join(dir, 'beta-book.epub')
  const note = path.join(dir, 'ambiguous-note.md')
  await writeFile(a, await makeEpub('Alpha', 'Alphabetical opening passage.'))
  await writeFile(b, await makeEpub('Beta', 'Betamax opening passage.'))
  // The note arrives last on purpose: with it already in the folder, indexing
  // these books would (correctly) stop to ask about renumbering.
  await writeFile(note, 'It says so at [[b1-1]].\n')

  await initKb(page)
  await importInto(page, [a, b])

  // Opening a book indexes it; both must be indexed for the id to be ambiguous.
  await page.locator('aside').getByText('alpha-book.epub', { exact: true }).click()
  await waitIndexed(page, 'Alphabetical opening passage')
  await page.locator('aside').getByText('beta-book.epub', { exact: true }).click()
  await waitIndexed(page, 'Betamax opening passage')

  await importInto(page, [note])
  await page.locator('aside').getByText('ambiguous-note.md', { exact: true }).click()

  const chip = page.locator('a.citation').first()
  await expect(chip).toBeVisible({ timeout: 10_000 })
  await chip.click()

  // Both books, named, with the passage each one holds — and no navigation.
  await expect(picker(page)).toBeVisible({ timeout: 10_000 })
  await expect(picker(page)).toContainText('alpha-book.epub')
  await expect(picker(page)).toContainText('beta-book.epub')
  await expect(page.locator('main').getByRole('button', { name: /ambiguous-note\.md/ })).toBeVisible()

  // Picking is the only way it navigates.
  await picker(page).getByText('beta-book.epub').click()
  await expect(picker(page)).toBeHidden()
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 15_000 })
})

test('a citation whose source is gone says so instead of opening a tab', async ({ page }) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'localmd-cite-'))
  const note = path.join(dir, 'orphan-note.md')
  await writeFile(note, 'Sources: [[pdf1:raw/books/deleted.pdf]]\n\nIt says so at [[1:b1-1]].\n')

  await initKb(page)
  await importInto(page, [note])
  await page.locator('aside').getByText('orphan-note.md', { exact: true }).click()

  const chip = page.locator('a.citation').first()
  await expect(chip).toBeVisible({ timeout: 10_000 })
  await chip.click()

  await expect(picker(page)).toBeVisible({ timeout: 10_000 })
  await expect(picker(page)).toContainText('not in this folder')
  // No tab was opened for the missing document.
  await expect(page.locator('main').getByRole('button', { name: /deleted\.pdf/ })).toHaveCount(0)
})


/**
 * An index outlives its document. Deleting the book leaves
 * `.localmd/epub-index/<slug>/` behind, still holding its block ids — which is
 * how a citation into a book that is no longer in the folder goes on looking
 * alive. The Health panel is where that becomes visible.
 */
test('the health panel names an index whose document has left the folder', async ({ page }) => {
  page.on('dialog', (d) => void d.accept()) // the delete confirm

  const dir = await mkdtemp(path.join(tmpdir(), 'localmd-stale-'))
  const book = path.join(dir, 'doomed-book.epub')
  await writeFile(book, await makeEpub('Doomed', 'Doomed opening passage.'))

  await initKb(page)
  await importInto(page, [book])
  await page.locator('aside').getByText('doomed-book.epub', { exact: true }).click()
  await waitIndexed(page, 'Doomed opening passage')

  // The panel is clean while the book is there.
  const pulse = page.getByTitle(/health/i).or(page.locator('button:has(.codicon-pulse)')).first()
  await pulse.click()
  const card = page.locator('section').filter({ hasText: 'Indexes without their document' })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card).toContainText('Nothing found')
  await page.keyboard.press('Escape')

  // Delete the book; its index stays behind.
  // The tree row, by the path it carries — the same name also sits in the
  // Open Files list, and only the tree has a context menu.
  await page.locator('[data-tree-path$="doomed-book.epub"]').click({ button: 'right' })
  await page.getByRole('button', { name: /Delete/ }).click()
  await expect(page.locator('aside').getByText('doomed-book.epub', { exact: true })).toHaveCount(0, {
    timeout: 10_000,
  })

  await pulse.click()
  await expect(card).toContainText('doomed-book.epub', { timeout: 10_000 })
  await expect(card).toContainText('the document is gone')
  await expect(card.getByRole('button', { name: 'Sort these out' })).toBeVisible()
})

/**
 * The same file under two names, which is what a rename looks like from inside
 * `.localmd/`: the index directory is keyed on the source PATH, so the renamed
 * document gets a fresh one and the old directory is left holding the ids every
 * existing citation was written against.
 */
test('a renamed document is recognised by its bytes, not its name', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())

  const dir = await mkdtemp(path.join(tmpdir(), 'localmd-rename-'))
  const bytes = await makeEpub('Twice', 'Identical opening passage.')
  const before = path.join(dir, 'old-name.epub')
  const after = path.join(dir, 'new-name.epub')
  await writeFile(before, bytes)
  await writeFile(after, bytes)

  await initKb(page)
  await importInto(page, [before, after])
  // Index both, so both directories exist — then take the old name away.
  await page.locator('aside').getByText('old-name.epub', { exact: true }).click()
  await waitIndexed(page, 'Identical opening passage')
  await page.locator('aside').getByText('new-name.epub', { exact: true }).click()
  await page.locator('[data-tree-path$="old-name.epub"]').click({ button: 'right' })
  await page.getByRole('button', { name: /Delete/ }).click()
  await expect(page.locator('aside').getByText('old-name.epub', { exact: true })).toHaveCount(0, {
    timeout: 10_000,
  })

  const pulse = page.getByTitle(/health/i).or(page.locator('button:has(.codicon-pulse)')).first()
  await pulse.click()
  const card = page.locator('section').filter({ hasText: 'Indexes without their document' })
  await expect(card).toContainText('old-name.epub', { timeout: 10_000 })
  await expect(card).toContainText('the same file is now')
  await expect(card).toContainText('new-name.epub')
})

/**
 * The quiet one: a page cites [[1:b1-1]] and never says what "1" is, because
 * the declaration lives on the source page it links to. It looks exactly like
 * a precise citation, so the panel is where it becomes visible — with the line
 * that would fix it, taken from that linked page.
 */
test('the health panel offers the declaration a page never made', async ({ page }) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'localmd-undeclared-'))
  const sourcePage = path.join(dir, 'the-book.md')
  const note = path.join(dir, 'a-concept.md')
  await writeFile(sourcePage, '# The book\n\n[[epub1:raw/books/politics.epub]]\n')
  await writeFile(note, 'Per [[wiki/the-book]] it says so at [[1:b10-62]].\n')

  await initKb(page)
  await importInto(page, [sourcePage, note])

  const pulse = page.getByTitle(/health/i).or(page.locator('button:has(.codicon-pulse)')).first()
  await pulse.click()
  const card = page.locator('section').filter({ hasText: 'Citations with no source named' })
  await expect(card).toContainText('a-concept.md', { timeout: 10_000 })
  await expect(card).toContainText('raw/books/politics.epub')
  // The source page itself declares what it cites, so it is not listed.
  await expect(card).not.toContainText('the-book.md')
  await expect(card.getByRole('button', { name: 'Add the missing declarations' })).toBeVisible()
})
