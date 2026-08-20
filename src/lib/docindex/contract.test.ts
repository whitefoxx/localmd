/**
 * The read contract, as executable statements. These numbers and shapes are
 * what every existing KB's on-disk indexes — and every block-id citation
 * already written into users' notes — were produced against. Changing a value
 * here is not a refactor; it strands indexes or re-points citations. The test
 * exists so that doing it by accident is impossible and doing it on purpose
 * forces this paragraph into your diff.
 */
import { describe, it, expect } from 'vitest'
// Node runtime only — node types intentionally absent (see sourceBytes.test.ts).
// @ts-expect-error node types are intentionally not installed
import { readFileSync } from 'node:fs'
// @ts-expect-error node types are intentionally not installed
import { fileURLToPath } from 'node:url'
import * as pdf from './pdf/types'
import * as epub from './epub/types'
import * as docx from './docx/types'
import { inheritIds } from './pdf/inherit'

describe('read contract', () => {
  it('INDEX_VERSION values are pinned — bumping strands every index on disk', () => {
    expect(pdf.INDEX_VERSION).toBe(11)
    expect(epub.INDEX_VERSION).toBe(3)
    expect(docx.INDEX_VERSION).toBe(1)
  })

  it('BUILDER only ever moves forward from 1', () => {
    for (const b of [pdf.BUILDER, epub.BUILDER, docx.BUILDER]) {
      expect(Number.isInteger(b)).toBe(true)
      expect(b).toBeGreaterThanOrEqual(1)
    }
  })

  it('published block ids keep the b<page>-<n> syntax', () => {
    const dir = fileURLToPath(new URL('./pdf/__fixtures__/', import.meta.url))
    const golden = JSON.parse(readFileSync(`${dir}fed-report-p21-26.blocks.json`, 'utf8')) as {
      id: string
      page: number
    }[]
    for (const b of golden) {
      expect(b.id).toMatch(/^b\d+-\d+$/)
      expect(b.id.startsWith(`b${b.page}-`)).toBe(true)
    }
  })

  it('inheritance is wired into the PDF pipeline, not just available', async () => {
    // parsePdf must consult the prior locations before building — this
    // import-level check keeps a refactor from quietly dropping the call.
    const src = readFileSync(
      fileURLToPath(new URL('./pdf/index.ts', import.meta.url)),
      'utf8',
    )
    expect(src).toContain('inheritIds(')
    expect(src).toContain('loadPriorIds(')
    expect(typeof inheritIds).toBe('function')
  })
})
