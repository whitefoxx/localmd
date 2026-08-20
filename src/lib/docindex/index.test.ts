import { describe, it, expect, vi, beforeEach } from 'vitest'
import { INDEX_VERSION, BUILDER } from './pdf/types'

// indexState reads exactly one file: the manifest. Everything else about the
// index — even whether the source bytes changed — is deliberately not its job.
const manifests = new Map<string, string>()
vi.mock('@/lib/fs', () => ({
  tryReadFile: (path: string) => Promise.resolve(manifests.get(path) ?? null),
}))

import { indexState, indexableKind } from './index'

describe('indexState', () => {
  beforeEach(() => manifests.clear())

  async function stateFor(manifest: unknown): Promise<string> {
    // Resolve the real index dir for the fixed path, then plant the manifest.
    const { indexDirFor } = await import('./util')
    const dir = indexDirFor('pdf', 'raw/x.pdf')
    manifests.set(
      `${dir}/manifest.json`,
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    )
    return indexState('raw/x.pdf')
  }

  it('is absent for a non-indexable path', async () => {
    expect(await indexState('wiki/note.txt')).toBe('absent')
  })

  it('is absent without a manifest', async () => {
    expect(await indexState('raw/x.pdf')).toBe('absent')
  })

  it('is absent on a corrupt manifest', async () => {
    expect(await stateFor('{not json')).toBe('absent')
  })

  it('is incompatible on a version this reader does not speak', async () => {
    expect(await stateFor({ version: INDEX_VERSION + 1 })).toBe('incompatible')
  })

  it('reads a manifest without builder as builder 1', async () => {
    // Pre-split indexes lack the field. While BUILDER was 1 they read as
    // current (the split itself changed no output); the first real algorithm
    // change made them genuinely outdated — usable, rebuild offered.
    expect(await stateFor({ version: INDEX_VERSION })).toBe(
      BUILDER > 1 ? 'outdated' : 'current',
    )
  })

  it('is outdated below the current builder, current at or above it', async () => {
    expect(await stateFor({ version: INDEX_VERSION, builder: BUILDER - 1 })).toBe('outdated')
    expect(await stateFor({ version: INDEX_VERSION, builder: BUILDER })).toBe('current')
    expect(await stateFor({ version: INDEX_VERSION, builder: BUILDER + 9 })).toBe('current')
  })
})

describe('indexableKind', () => {
  it('claims the four kinds and rejects the rest', () => {
    expect(indexableKind('a/b.PDF')).toBe('pdf')
    expect(indexableKind('a/b.epub')).toBe('epub')
    expect(indexableKind('a/b.md')).toBe('md')
    expect(indexableKind('a/b.docx')).toBe('docx')
    expect(indexableKind('a/b.txt')).toBeNull()
  })
})
