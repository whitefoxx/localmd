import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

/**
 * Preview support for the formats a browser can show but not cite: CSV/TSV
 * tables, audio/video playback, Excel workbooks and PowerPoint outlines.
 * The OOXML fixtures are built here rather than committed as binaries, so what
 * the parsers are asked to handle stays readable (same pattern as docx.spec).
 */

const SPREADSHEET_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
const RELS_DOC = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const RELS_PKG = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'

async function makeXlsx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0"?><workbook ${SPREADSHEET_NS} ${RELS_DOC}><sheets>` +
      `<sheet name="Budget" sheetId="1" r:id="rId1"/>` +
      `<sheet name="Notes" sheetId="2" r:id="rId2"/>` +
      `</sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0"?><Relationships ${RELS_PKG}>` +
      `<Relationship Id="rId1" Type="w" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="w" Target="worksheets/sheet2.xml"/>` +
      `</Relationships>`,
  )
  zip.file(
    'xl/sharedStrings.xml',
    `<?xml version="1.0"?><sst ${SPREADSHEET_NS}>` +
      `<si><t>Item</t></si>` +
      `<si><r><t xml:space="preserve">Amount </t></r><r><t>(USD)</t></r></si>` + // rich runs concatenate
      `<si><t>Rent</t></si>` +
      `</sst>`,
  )
  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0"?><styleSheet ${SPREADSHEET_NS}>` +
      `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>` +
      `<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs>` +
      `</styleSheet>`,
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0"?><worksheet ${SPREADSHEET_NS}><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
      // B2 number, C2 skipped, D2 boolean — the gap must stay a gap.
      `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1250.5</v></c><c r="D2" t="b"><v>1</v></c></row>` +
      // Row 3 skipped entirely; A4 date-styled serial, B4 formula with cached value.
      `<row r="4"><c r="A4" s="1"><v>45658</v></c><c r="B4"><f>SUM(B2)</f><v>1250.5</v></c></row>` +
      `</sheetData></worksheet>`,
  )
  zip.file(
    'xl/worksheets/sheet2.xml',
    `<?xml version="1.0"?><worksheet ${SPREADSHEET_NS}><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>hello notes</t></is></c></row>` +
      `</sheetData></worksheet>`,
  )
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
}

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function makePptx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0"?><p:presentation ${P} ${RELS_DOC}><p:sldIdLst>` +
      `<p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/>` +
      `</p:sldIdLst></p:presentation>`,
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0"?><Relationships ${RELS_PKG}>` +
      `<Relationship Id="rId1" Type="s" Target="slides/slide1.xml"/>` +
      `<Relationship Id="rId2" Type="s" Target="slides/slide2.xml"/>` +
      `</Relationships>`,
  )
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0"?><p:sld ${P} ${A} ${RELS_DOC}><p:cSld><p:spTree>` +
      `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
      `<p:txBody><a:p><a:r><a:t>Quarterly Review</a:t></a:r></a:p></p:txBody></p:sp>` +
      `<p:sp><p:txBody>` +
      `<a:p><a:r><a:t>Revenue grew 40%</a:t></a:r></a:p>` +
      `<a:p><a:pPr lvl="1"/><a:r><a:t>Driven by connector sales</a:t></a:r></a:p>` +
      `</p:txBody></p:sp>` +
      `</p:spTree></p:cSld></p:sld>`,
  )
  zip.file(
    'ppt/slides/slide2.xml',
    `<?xml version="1.0"?><p:sld ${P} ${A} ${RELS_DOC}><p:cSld><p:spTree>` +
      `<p:graphicFrame><a:graphic><a:graphicData><a:tbl>` +
      `<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Metric</a:t></a:r></a:p></a:txBody></a:tc>` +
      `<a:tc><a:txBody><a:p><a:r><a:t>Value</a:t></a:r></a:p></a:txBody></a:tc></a:tr>` +
      `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>` +
      `<p:pic><p:blipFill><a:blip r:embed="rId7"/></p:blipFill></p:pic>` +
      `</p:spTree></p:cSld></p:sld>`,
  )
  zip.file(
    'ppt/slides/_rels/slide2.xml.rels',
    `<?xml version="1.0"?><Relationships ${RELS_PKG}>` +
      `<Relationship Id="rId7" Type="i" Target="../media/image1.png"/>` +
      `</Relationships>`,
  )
  zip.file('ppt/media/image1.png', PNG_1PX)
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
}

/** A valid 1-second silent 16-bit mono WAV. */
function makeWav(): Buffer {
  const sampleRate = 8000
  const dataSize = sampleRate * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  return buf
}

/** Open a fresh KB (?e2e=1) and import the given files via the capture input. */
async function openWith(page: Page, files: Array<[string, Buffer | string]>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'browser-md-preview-'))
  const paths: string[] = []
  for (const [name, content] of files) {
    const p = path.join(dir, name)
    await writeFile(p, content)
    paths.push(p)
  }
  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await page.locator('input[type="file"]').first().setInputFiles(paths)
}

async function openFromTree(page: Page, name: string): Promise<void> {
  const entry = page.locator('aside').getByText(name, { exact: true })
  await expect(entry).toBeVisible({ timeout: 10_000 })
  await entry.click()
}

test('a CSV renders as a table in preview and stays editable text in edit', async ({ page }) => {
  await openWith(page, [['expenses.csv', 'name,amount\n"Ma, Long",12\nRent,1250\n']])
  await openFromTree(page, 'expenses.csv')

  // Quoted comma stays one field; first row is the sticky header.
  await expect(page.locator('thead th', { hasText: 'amount' })).toBeVisible()
  await expect(page.locator('tbody td', { hasText: 'Ma, Long' })).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(2)

  // The same bytes, as text, behind the Edit toggle.
  await page.getByRole('button', { name: 'Edit' }).click()
  await expect(page.locator('.cm-editor')).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText('"Ma, Long",12')
})

test('frontmatter keeps both its fences, and is not read as markdown', async ({ page }) => {
  await openWith(page, [
    [
      'skill.md',
      '---\nname: hn-top-stories\ndescription: Fetch the top stories.\n---\n\n# Body\n\nSome **bold** prose.\n',
    ],
  ])
  await openFromTree(page, 'skill.md')
  await page.getByRole('button', { name: 'Edit' }).click()
  await expect(page.locator('.cm-editor')).toBeVisible()

  // The editor hides markdown syntax on every line the cursor is not on. A
  // frontmatter block is not markdown, but markdown's parser reads its closing
  // fence as a setext heading's underline — so the fence was hidden, and a
  // skill file looked like it had lost its delimiter.
  const fences = await page
    .locator('.cm-content')
    .evaluate((el) => (el.textContent ?? '').split('---').length - 1)
  expect(fences).toBe(2)
  // Markdown BELOW the block is still rendered, syntax and all.
  await expect(page.locator('.cm-content')).not.toContainText('**bold**')
  await expect(page.locator('.cm-content')).toContainText('bold')
})

test('an audio file gets the browser player', async ({ page }) => {
  await openWith(page, [['memo.wav', makeWav()]])
  await openFromTree(page, 'memo.wav')

  const player = page.locator('audio')
  await expect(player).toHaveCount(1)
  await expect(player).toHaveAttribute('src', /^blob:/)
  await expect(player).toHaveAttribute('controls', '')
})

test('an Excel workbook shows its sheets, values, dates and gaps', async ({ page }) => {
  await openWith(page, [['budget.xlsx', await makeXlsx()]])
  await openFromTree(page, 'budget.xlsx')

  // Rich-run shared string concatenated; number and boolean rendered.
  await expect(page.locator('td', { hasText: 'Amount (USD)' })).toBeVisible()
  await expect(page.locator('td', { hasText: '1250.5' }).first()).toBeVisible()
  await expect(page.locator('td', { hasText: 'TRUE' })).toBeVisible()
  // The date-styled serial 45658 reads as a date, not a number.
  await expect(page.locator('td', { hasText: '2025-01-01' })).toBeVisible()
  // The skipped C2 is an empty cell between B2 and D2, not a shift.
  const row2 = page.locator('tbody tr').nth(1)
  await expect(row2.locator('td').nth(3)).toHaveText('')

  // The second sheet is a click away.
  await page.getByRole('button', { name: 'Notes' }).click()
  await expect(page.locator('td', { hasText: 'hello notes' })).toBeVisible()
})

test('a legacy .xls explains itself instead of failing silently', async ({ page }) => {
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
  await openWith(page, [['old-budget.xls', ole]])
  await openFromTree(page, 'old-budget.xls')

  await expect(page.getByText('Legacy .xls format')).toBeVisible()
  await expect(page.getByText(/save a copy as \.xlsx/)).toBeVisible()
})

test('a PowerPoint deck previews as an outline with pictures', async ({ page }) => {
  await openWith(page, [['kickoff.pptx', await makePptx()]])
  await openFromTree(page, 'kickoff.pptx')

  // Slide 1: title placeholder and body lines, the second one indented.
  await expect(page.getByText('Quarterly Review')).toBeVisible()
  await expect(page.getByText('Revenue grew 40%')).toBeVisible()
  const indented = page.getByText('Driven by connector sales')
  await expect(indented).toBeVisible()
  await expect(indented).toHaveCSS('padding-left', '20px') // lvl 1 × 1.25rem

  // Slide 2: table row joined visibly, embedded picture resolved to a blob.
  await expect(page.getByText('Metric · Value')).toBeVisible()
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(1)

  // And the header is honest about what this view is.
  await expect(page.getByText(/Outline view/)).toBeVisible()
})

test('a name nobody recognises opens as text, and only real bytes say binary', async ({ page }) => {
  await openWith(page, [
    ['.env', 'OPENAI_API_KEY=sk-test\n'],
    // Same unknown extension, bytes that are not text (a zip header with NULs).
    ['blob.unknown', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x41, 0x42])],
  ])

  await openFromTree(page, '.env')
  await expect(page.locator('.cm-content')).toContainText('OPENAI_API_KEY=sk-test')

  await openFromTree(page, 'blob.unknown')
  await expect(page.locator('.cm-editor')).toHaveCount(0)
  await expect(page.getByText('Binary file — no preview')).toBeVisible()
})
