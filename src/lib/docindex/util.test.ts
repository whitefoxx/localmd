import { describe, it, expect, vi } from 'vitest'
import { pad, slugify, fnv1a, indexDirFor, blockPassage } from './util'

describe('pad', () => {
  it('zero-pads to 3 digits', () => {
    expect(pad(7)).toBe('007')
    expect(pad(123)).toBe('123')
  })
})

describe('slugify', () => {
  it('keeps unicode letters so CJK titles survive', () => {
    expect(slugify('毛泽东选集')).toBe('毛泽东选集')
  })
  it('collapses punctuation runs to hyphens and lowercases', () => {
    expect(slugify('Hello, World! (2nd ed.)')).toBe('hello-world-2nd-ed')
  })
  it('never returns an empty slug', () => {
    expect(slugify('!!!')).toBe('section')
  })
})

describe('fnv1a — must stay byte-stable', () => {
  // Golden values taken from index directories in a real knowledge base. The
  // hash names the directory, so changing it does not produce a different name
  // for the same document — it orphans every index already on disk.
  it('matches the index directory hashes existing KBs hold', () => {
    expect(fnv1a('raw/books/毛泽东选集.pdf')).toBe('b03d722c')
    expect(fnv1a('raw/books/全球通史.pdf')).toBe('5178e6ec')
    expect(fnv1a('raw/books/被讨厌的勇气.epub')).toBe('c7f57e57')
  })
})

describe('indexDirFor', () => {
  it('builds the published directory name', () => {
    expect(indexDirFor('pdf', 'raw/books/毛泽东选集.pdf')).toBe(
      '.localmd/pdf-index/毛泽东选集-b03d722c',
    )
    expect(indexDirFor('epub', 'raw/books/被讨厌的勇气.epub')).toBe(
      '.localmd/epub-index/被讨厌的勇气-c7f57e57',
    )
  })
})

describe('writeAll — rebuild survives being killed at any point', () => {
  // The order is the contract: overwrite-in-place first (the old manifest
  // keeps vouching for a complete old index), manifest.json alone after every
  // other write (the flip to "new index, complete"), stale-file deletion
  // strictly after the manifest (a crash may leave orphans, never a lie —
  // and never a moment where locations.json does not exist).
  async function run(files: { path: string; content: string }[], existing: string[] = []) {
    const ops: string[] = []
    vi.doMock('@/lib/gitignore', () => ({ ensureIgnored: () => Promise.resolve() }))
    vi.doMock('@/lib/fs', () => ({
      readTreeFrom: (dir: string) =>
        existing.length
          ? Promise.resolve(existing.map((p) => ({ kind: 'file', path: `${dir}/${p}` })))
          : Promise.reject(new DOMException('no dir', 'NotFoundError')),
      collectFiles: (nodes: { kind: string; path: string }[]) => nodes.map((n) => n.path),
      writeFile: (p: string) => {
        ops.push(`write ${p}`)
        return Promise.resolve()
      },
      removeFile: (p: string) => {
        ops.push(`rm ${p}`)
        return Promise.resolve()
      },
    }))
    vi.resetModules()
    const { writeAll } = await import('./util')
    await writeAll('dir', files)
    vi.doUnmock('@/lib/fs')
    vi.doUnmock('@/lib/gitignore')
    vi.resetModules()
    return ops
  }

  it('writes manifest.json after every other write, regardless of list order', async () => {
    const files = [
      { path: 'manifest.json', content: '{}' },
      ...Array.from({ length: 30 }, (_, i) => ({ path: `sections/${i}.md`, content: '' })),
    ]
    const ops = await run(files)
    expect(ops[ops.length - 1]).toBe('write dir/manifest.json')
    expect(ops.filter((o) => o === 'write dir/manifest.json')).toHaveLength(1)
  })

  it('deletes files the new build no longer produces — after the manifest', async () => {
    const ops = await run(
      [
        { path: 'toc.md', content: '' },
        { path: 'manifest.json', content: '{}' },
      ],
      ['toc.md', 'manifest.json', 'sections/001-old.md'],
    )
    expect(ops).toEqual([
      'write dir/toc.md',
      'write dir/manifest.json',
      'rm dir/sections/001-old.md',
    ])
  })

  it('handles the first build, when the directory does not exist yet', async () => {
    const ops = await run([{ path: 'manifest.json', content: '{}' }])
    expect(ops).toEqual(['write dir/manifest.json'])
  })
})

describe('blockPassage', () => {
  const section = [
    '<!-- section 001 · ch1.xhtml -->',
    '# [[b1-1]] The Origins',
    '',
    '[[b1-2]] Attention replaced recurrence in sequence models.',
    '',
    '## [[b1-3]] A subheading',
    '',
    '[[b1-4]]',
    '```',
    'const x = 1',
    'const y = 2',
    '```',
    '',
    '> [[b1-5]] A quoted line.',
    '',
    '- [[b1-6]] A list item.',
    '',
    '[[b1-7]] (table)',
    '| a | b |',
    '| c | d |',
    '',
  ].join('\n')

  it('reads the text after the tag', () => {
    expect(blockPassage(section, 'b1-2')).toBe(
      'Attention replaced recurrence in sequence models.',
    )
  })
  it('reads headings, quotes and list items without their markers', () => {
    expect(blockPassage(section, 'b1-1')).toBe('The Origins')
    expect(blockPassage(section, 'b1-3')).toBe('A subheading')
    expect(blockPassage(section, 'b1-5')).toBe('A quoted line.')
    expect(blockPassage(section, 'b1-6')).toBe('A list item.')
  })
  it('collects a fenced code block from the lines below its tag', () => {
    expect(blockPassage(section, 'b1-4')).toBe('const x = 1\nconst y = 2')
  })
  it('collects a table as its rows', () => {
    expect(blockPassage(section, 'b1-7')).toBe('a | b\nc | d')
  })
  it('is null for a block this section does not carry', () => {
    expect(blockPassage(section, 'b9-9')).toBeNull()
  })
  it('clips a very long passage', () => {
    const long = `[[b2-1]] ${'x'.repeat(900)}`
    const out = blockPassage(long, 'b2-1')!
    expect(out).toHaveLength(601)
    expect(out.endsWith('…')).toBe(true)
  })
})
