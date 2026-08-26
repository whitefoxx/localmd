import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildIndex, splitIntoSections } from './build'
import type { DocxBlock } from './types'

const written = new Map<string, string>()
vi.mock('@/lib/fs', () => ({
  writeFile: (path: string, content: string) => {
    written.set(path, content)
    return Promise.resolve()
  },
  readTreeFrom: () => Promise.reject(new DOMException('no dir', 'NotFoundError')),
  collectFiles: (nodes: { path: string }[]) => nodes.map((n) => n.path),
  removeFile: () => Promise.resolve(),
}))
beforeEach(() => written.clear())

function blocks(spec: { heading?: number; n?: number }[]): DocxBlock[] {
  const out: DocxBlock[] = []
  for (const s of spec) {
    if (s.heading) {
      out.push({
        id: `b1-${out.length + 1}`,
        kind: 'heading',
        level: s.heading,
        text: `H${s.heading}-${out.length + 1}`,
      })
    }
    for (let i = 0; i < (s.n ?? 0); i++) {
      out.push({ id: `b1-${out.length + 1}`, kind: 'text', level: 0, text: 'body' })
    }
  }
  return out
}

describe('splitIntoSections', () => {
  it('keeps a short document in one file', () => {
    const sections = splitIntoSections(blocks([{ heading: 1, n: 5 }, { heading: 2, n: 5 }]), 'Doc')
    expect(sections).toHaveLength(1)
    expect(sections[0].title).toBe('Doc')
  })

  it('splits a long document on its shallowest repeated heading level', () => {
    const sections = splitIntoSections(
      blocks([
        { heading: 1, n: 100 },
        { heading: 2, n: 100 },
        { heading: 3, n: 60 },
        { heading: 2, n: 100 },
      ]),
      'Doc',
    )
    // h1 occurs once, so h2 is the chapter level: [h1 …], [h2 … h3 …], [h2 …].
    expect(sections).toHaveLength(3)
    expect(sections.flatMap((s) => s.blocks)).toHaveLength(364)
    expect(sections[0].title).toMatch(/^H1-/)
    expect(sections[1].title).toMatch(/^H2-/)
  })

  it('keeps a long heading-less document in one file rather than cutting blindly', () => {
    const sections = splitIntoSections(blocks([{ n: 400 }]), 'Doc')
    expect(sections).toHaveLength(1)
    expect(sections[0].blocks).toHaveLength(400)
  })

  it('writes an index the agent can navigate and cite from', async () => {
    const blocks: DocxBlock[] = [
      { id: 'b1-1', kind: 'heading', level: 1, text: 'Field Notes' },
      { id: 'b1-2', kind: 'text', level: 0, text: 'The pilot ran for six weeks.' },
      { id: 'b1-3', kind: 'list', level: 1, text: 'First observation' },
      { id: 'b1-4', kind: 'table', level: 0, text: 'Metric | Value\nRetention | 62%' },
    ]
    const manifest = await buildIndex({
      indexDir: '.localmd/docx-index/notes-abc',
      source: 'raw/articles/notes.docx',
      title: 'Field Notes',
      contentHash: 'hash',
      blocks,
    })

    expect(manifest.blockCount).toBe(4)
    expect(manifest.sections).toHaveLength(1)
    expect([...written.keys()].sort()).toEqual([
      '.localmd/docx-index/notes-abc/_README.md',
      '.localmd/docx-index/notes-abc/manifest.json',
      '.localmd/docx-index/notes-abc/sections/001-field-notes.md',
      '.localmd/docx-index/notes-abc/toc.md',
    ])

    // Every block is citeable, and each kind keeps its markdown shape.
    const section = written.get('.localmd/docx-index/notes-abc/sections/001-field-notes.md') ?? ''
    expect(section).toContain('# [[b1-1]] Field Notes')
    expect(section).toContain('[[b1-2]] The pilot ran for six weeks.')
    expect(section).toContain('- [[b1-3]] First observation')
    expect(section).toContain('| Retention | 62% |')

    // The README teaches the docx-specific declaration form.
    expect(written.get('.localmd/docx-index/notes-abc/_README.md')).toContain(
      '[[docx1:raw/articles/notes.docx]]',
    )
    expect(written.get('.localmd/docx-index/notes-abc/toc.md')).toContain(
      '- [Field Notes](sections/001-field-notes.md)',
    )
  })

  it('never loses or duplicates a block', () => {
    const all = blocks([
      { heading: 2, n: 90 },
      { heading: 2, n: 90 },
      { heading: 2, n: 90 },
    ])
    const ids = splitIntoSections(all, 'Doc').flatMap((s) => s.blocks.map((b) => b.id))
    expect(ids).toEqual(all.map((b) => b.id))
  })
})
