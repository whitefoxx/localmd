import { describe, it, expect } from 'vitest'
import { renderFileList } from './fileList'

describe('renderFileList', () => {
  it('returns plain paths under the fold threshold', () => {
    const paths = ['index.md', 'wiki/a.md', 'wiki/b.md']
    expect(renderFileList(paths, 400)).toBe('index.md\nwiki/a.md\nwiki/b.md')
  })

  it('folds large listings into a directory summary', () => {
    const paths = [
      'index.md',
      ...Array.from({ length: 20 }, (_, i) => `raw/images/shot-${i}.png`),
      'wiki/topic.md',
    ]
    const out = renderFileList(paths, 10)
    expect(out).toContain('22 files — folded')
    expect(out).toContain('index.md') // root files listed in full
    expect(out).toContain('raw/images/ — 20 files, e.g. shot-0.png')
    expect(out).toContain('…')
    expect(out).not.toContain('shot-19.png') // bulk dropped
    // a small directory lists every file with its full path
    expect(out).toContain('wiki/ — wiki/topic.md')
  })

  it('keeps directory paths drillable (full dir path shown once)', () => {
    const paths = Array.from({ length: 12 }, (_, i) => `a/b/c/f${i}.md`)
    const out = renderFileList(paths, 5)
    expect(out).toContain('a/b/c/ — 12 files')
  })
})
