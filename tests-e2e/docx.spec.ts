import { test, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

/**
 * Word (.docx) support against the in-memory KB (?e2e=1): import a document,
 * see it rendered with its structure intact, and confirm it was indexed for
 * the agent. The fixture is built here rather than committed as a binary, so
 * what the parser is asked to handle stays readable.
 */

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

function para(text: string, style?: string, numId?: string): string {
  const pPr = style
    ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`
    : numId
      ? `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>`
      : ''
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
}

async function makeDocx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document ${W} ${R}><w:body>` +
      para('Quarterly Field Notes', 'Title') +
      para('Findings', 'Heading1') +
      para('The pilot ran for six weeks across two teams.') +
      para('First observation', undefined, '1') +
      para('Second observation', undefined, '1') +
      `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold lead-in</w:t></w:r><w:r><w:t xml:space="preserve"> and plain tail.</w:t></w:r></w:p>` +
      `<w:tbl><w:tr><w:tc>${para('Metric')}</w:tc><w:tc>${para('Value')}</w:tc></w:tr>` +
      `<w:tr><w:tc>${para('Retention')}</w:tc><w:tc>${para('62%')}</w:tc></w:tr></w:tbl>` +
      `<w:p/>` + // empty spacer paragraph — must not become a block
      `</w:body></w:document>`,
  )
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0"?><w:styles ${W}>` +
      `<w:style w:styleId="Title"><w:name w:val="Title"/></w:style>` +
      `<w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
  )
  zip.file(
    'word/numbering.xml',
    `<?xml version="1.0"?><w:numbering ${W}>` +
      `<w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="7"/></w:num></w:numbering>`,
  )
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
}

test('a legacy .doc explains itself instead of failing silently', async ({ page }) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'browser-md-doc-'))
  const file = path.join(dir, 'legacy-report.doc')
  // OLE2 compound-file magic — what a real Word 97–2003 file starts with.
  await writeFile(file, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]))

  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await page.locator('input[type="file"]').first().setInputFiles(file)
  const entry = page.locator('aside').getByText('legacy-report.doc', { exact: true })
  await expect(entry).toBeVisible({ timeout: 10_000 })
  await entry.click()

  await expect(page.getByText('Legacy .doc format')).toBeVisible()
  await expect(page.getByText(/save a copy as \.docx/)).toBeVisible()
})

test('a .docx renders with its structure and is indexed for the agent', async ({ page }) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'browser-md-docx-'))
  const file = path.join(dir, 'field-notes.docx')
  await writeFile(file, await makeDocx())

  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()

  // Import through the file tree's hidden input, the same path a drop takes.
  await page.locator('input[type="file"]').first().setInputFiles(file)
  const treeEntry = page.locator('aside').getByText('field-notes.docx', { exact: true })
  await expect(treeEntry).toBeVisible({ timeout: 10_000 })
  await treeEntry.click()

  // Structure survived the round trip: heading levels, list, table, emphasis.
  const reader = page.locator('.docx-reader')
  // Title and Heading 1 are both top-level headings, in document order.
  await expect(reader.locator('h1[data-bid]')).toHaveText(['Quarterly Field Notes', 'Findings'])
  await expect(reader.locator('ul li')).toHaveCount(2)
  await expect(reader.locator('table td, table th')).toHaveCount(4)
  await expect(reader.locator('strong')).toHaveText('Bold lead-in')
  // The empty spacer paragraph is dropped rather than becoming a citeable block.
  await expect(reader.locator('p[data-bid]')).toHaveCount(2)

  // Auto-indexed on open — the agent reads the document through .trace/.
  await expect(page.getByText(/Indexed · \d+ blocks/)).toBeVisible({ timeout: 15_000 })

  // A [[docx1:…]] citation chip jumps back into the document and flashes the
  // cited block — the same contract the PDF and EPUB indexes carry.
  const input = page.getByPlaceholder(/Ask or instruct/)
  await input.fill('echo [[docx1:field-notes.docx]] The pilot ran six weeks [[1:b1-3]].')
  await input.press('Enter')
  const chip = page.locator('a.citation[data-block="b1-3"]')
  await expect(chip).toBeVisible({ timeout: 10_000 })
  await chip.click()
  await expect(reader.locator('[data-bid="b1-3"]')).toHaveClass(/docx-flash/)
})
