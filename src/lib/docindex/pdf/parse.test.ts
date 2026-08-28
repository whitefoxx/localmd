import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdfIndexManifest } from './types'

const fs = { readBinary: vi.fn(), tryReadFile: vi.fn() }
vi.mock('@/lib/fs', () => ({
  readBinary: (...a: unknown[]) => fs.readBinary(...a),
  tryReadFile: (...a: unknown[]) => fs.tryReadFile(...a),
}))

const extractPdf = vi.fn()
const extractPdfViaOcr = vi.fn()
vi.mock('./extract', () => ({
  extractPdf: (...a: unknown[]) => extractPdf(...a),
  extractPdfViaOcr: (...a: unknown[]) => extractPdfViaOcr(...a),
}))

const buildIndex = vi.fn()
vi.mock('./build', () => ({ buildIndex: (...a: unknown[]) => buildIndex(...a) }))

import { parsePdf } from './index'

const EMPTY = { title: 'doc', pageCount: 1, pageSizes: [{ w: 595, h: 842 }], blocks: [], outline: { tree: [], flat: [] } }

/** What a previous build left on disk. */
function manifestOnDisk(m: Partial<PdfIndexManifest>): void {
  fs.tryReadFile.mockImplementation((p: string) =>
    Promise.resolve(p.endsWith('manifest.json') ? JSON.stringify(m) : null),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  fs.readBinary.mockResolvedValue(new ArrayBuffer(8))
  fs.tryReadFile.mockResolvedValue(null)
  extractPdf.mockResolvedValue(EMPTY)
  extractPdfViaOcr.mockResolvedValue(EMPTY)
  buildIndex.mockImplementation((i: { textSource?: string; ocrLang?: string }) =>
    Promise.resolve({ ...i, sections: [] }),
  )
})

describe('parsePdf · which extractor runs', () => {
  it('reads the text layer when nothing says otherwise', async () => {
    await parsePdf('a.pdf')
    expect(extractPdf).toHaveBeenCalled()
    expect(extractPdfViaOcr).not.toHaveBeenCalled()
  })

  it('reads the pictures when the caller asks', async () => {
    await parsePdf('a.pdf', undefined, { ocr: { lang: 'chi_sim' } })
    expect(extractPdfViaOcr).toHaveBeenCalled()
    expect(extractPdf).not.toHaveBeenCalled()
  })

  // The bug this guards: a rebuild of a recognised document would otherwise run
  // the text-layer extractor, and a scan has no text layer — half an hour of the
  // user's CPU replaced by zero blocks, and every citation into it dangling.
  it('keeps reading the pictures when an OCR index is rebuilt', async () => {
    manifestOnDisk({ textSource: 'ocr', ocrLang: 'chi_sim+eng' })
    await parsePdf('a.pdf', undefined, { force: true })
    expect(extractPdf).not.toHaveBeenCalled()
    expect(extractPdfViaOcr).toHaveBeenCalledWith(
      expect.anything(),
      'a',
      expect.objectContaining({ lang: 'chi_sim+eng' }),
    )
  })

  it('records that the rebuilt index is still recognised text', async () => {
    manifestOnDisk({ textSource: 'ocr', ocrLang: 'chi_sim' })
    await parsePdf('a.pdf', undefined, { force: true })
    expect(buildIndex).toHaveBeenCalledWith(
      expect.objectContaining({ textSource: 'ocr', ocrLang: 'chi_sim' }),
    )
  })

  it('does not turn a text-layer document into an OCR one', async () => {
    manifestOnDisk({ textSource: 'layer' })
    await parsePdf('a.pdf', undefined, { force: true })
    expect(extractPdf).toHaveBeenCalled()
    expect(extractPdfViaOcr).not.toHaveBeenCalled()
  })

  // Indexes written before the field existed predate OCR entirely.
  it('treats a manifest with no textSource as a text-layer one', async () => {
    manifestOnDisk({ title: 'old' })
    await parsePdf('a.pdf', undefined, { force: true })
    expect(extractPdf).toHaveBeenCalled()
  })

  // The user picked that language once, for this scan; new bytes are still the
  // same scan.
  it('carries the language forward even when the file has changed', async () => {
    manifestOnDisk({ textSource: 'ocr', ocrLang: 'jpn', contentHash: 'stale' })
    await parsePdf('a.pdf', undefined, { force: true })
    expect(extractPdfViaOcr).toHaveBeenCalledWith(
      expect.anything(),
      'a',
      expect.objectContaining({ lang: 'jpn' }),
    )
  })
})
