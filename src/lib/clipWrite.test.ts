/**
 * Where a clip's pictures land and how the note points at them.
 *
 * Two things went wrong at once on a real clip of a busy page: twenty images
 * were written INTO raw/articles/ beside the note, and the note referenced
 * them as `![]((99+ 封私信) 首页 - 知乎-2-1.webp)` — a destination with spaces and
 * parentheses, which CommonMark does not read as a link at all. The folder
 * looked like a pile of duplicates and every picture rendered as its own
 * source text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { marked } from 'marked'

const written = new Map<string, Blob | string>()
vi.mock('@/lib/fs', () => ({
  exists: async (p: string) => written.has(p) || p === 'raw',
  writeFile: async (p: string, c: Blob | string) => {
    written.set(p, c)
  },
}))
vi.mock('@/lib/annotations', () => ({ saveWebSidecar: async () => {} }))

import { writeClip, relativePath, markdownTarget, type ClipPayload } from '@/lib/clip'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

const page: ClipPayload = {
  title: '(99+ 封私信) 首页 - 知乎',
  url: 'https://www.zhihu.com/',
  mode: 'article',
  markdown: 'Feed\n\n![](https://pic.zhimg.com/a.png)\n\n![cover](https://pic.zhimg.com/b.png)',
  images: [
    { src: 'https://pic.zhimg.com/a.png', mime: 'image/png', dataUrl: PNG },
    { src: 'https://pic.zhimg.com/b.png', mime: 'image/png', dataUrl: PNG },
    { src: 'https://pic.zhimg.com/og.png', mime: 'image/png', dataUrl: PNG }, // not in the body
  ],
  clipped_at: '2026-09-03T00:00:00.000Z',
}

describe('relativePath', () => {
  it('walks up and across', () => {
    expect(relativePath('raw/articles/', 'raw/images/x.png')).toBe('../images/x.png')
    expect(relativePath('inbox/', 'inbox/x.png')).toBe('x.png')
    expect(relativePath('', 'x.png')).toBe('x.png')
    expect(relativePath('a/b/c/', 'd.png')).toBe('../../../d.png')
  })
})

describe('markdownTarget', () => {
  it('encodes only what breaks a bare destination, and keeps CJK readable', () => {
    expect(markdownTarget('../images/(99+ 封私信) 首页 - 知乎-2-1.webp')).toBe(
      '../images/%2899+%20封私信%29%20首页%20-%20知乎-2-1.webp',
    )
    expect(markdownTarget('100%.png')).toBe('100%25.png')
  })

  it('produces something marked reads as an image, which the raw name is not', () => {
    const raw = '![]((99+ 封私信) 首页 - 知乎-2-1.webp)'
    expect(String(marked.parse(raw))).not.toContain('<img')
    const encoded = `![](${markdownTarget('../images/(99+ 封私信) 首页 - 知乎-2-1.webp')})`
    expect(String(marked.parse(encoded))).toContain('<img')
  })

  it('round-trips through the decoder the link resolver uses', () => {
    const p = '../images/(a) b 100%.png'
    expect(decodeURIComponent(markdownTarget(p))).toBe(p)
  })
})

describe('writeClip', () => {
  beforeEach(() => written.clear())

  it('files the pictures where pictures go, not beside the note', async () => {
    const notePath = await writeClip(page)
    expect(notePath).toBe('raw/articles/(99+ 封私信) 首页 - 知乎.md')
    const files = [...written.keys()].sort()
    expect(files).toEqual([
      'raw/articles/(99+ 封私信) 首页 - 知乎.md',
      'raw/images/(99+ 封私信) 首页 - 知乎-1.png',
      'raw/images/(99+ 封私信) 首页 - 知乎-2.png',
    ])
  })

  it('points the note at them with a relative, parseable destination', async () => {
    const notePath = await writeClip(page)
    const note = String(written.get(notePath))
    expect(note).toContain('![](../images/%2899+%20封私信%29%20首页%20-%20知乎-1.png)')
    expect(note).toContain('![cover](../images/%2899+%20封私信%29%20首页%20-%20知乎-2.png)')
    expect(note).not.toContain('https://pic.zhimg.com/a.png')
    expect((String(marked.parse(note)).match(/<img /g) ?? []).length).toBe(2)
  })

  it('skips the social-card image the body never shows', async () => {
    await writeClip(page)
    expect([...written.keys()].some((p) => p.endsWith('-3.png'))).toBe(false)
  })

  it('numbers a second clip of the same page and its pictures apart', async () => {
    await writeClip(page)
    const second = await writeClip(page)
    expect(second).toBe('raw/articles/(99+ 封私信) 首页 - 知乎-2.md')
    expect(written.has('raw/images/(99+ 封私信) 首页 - 知乎-2-1.png')).toBe(true)
  })
})
