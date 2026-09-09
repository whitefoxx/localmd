/**
 * What a clip leaves in the folder, and how the note points at its pictures.
 *
 * Two things went wrong at once on a real clip of a busy page: twenty images
 * were written INTO raw/articles/ beside the note, and the note referenced
 * them as `![]((99+ 封私信) 首页 - 知乎-2-1.webp)` — a destination with spaces and
 * parentheses, which CommonMark does not read as a link at all. The folder
 * looked like a pile of duplicates and every picture rendered as its own
 * source text.
 *
 * The second half was fixed by encoding the destination (`markdownTarget`,
 * still used wherever a filename becomes a link). The first was fixed by not
 * writing the files: what a clip actually brings is avatars, icons and
 * buttons, and the note keeps the URLs the page served instead.
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

import { writeClip, markdownTarget, type ClipPayload } from '@/lib/clip'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

const page: ClipPayload = {
  title: '(99+ 封私信) 首页 - 知乎',
  url: 'https://www.zhihu.com/',
  mode: 'article',
  markdown: 'Feed\n\n![](https://pic.zhimg.com/a.png)\n\n![cover](https://pic.zhimg.com/b.png)',
  // The extension still sends the bytes. Nothing reads them.
  images: [
    { src: 'https://pic.zhimg.com/a.png', mime: 'image/png', dataUrl: PNG },
    { src: 'https://pic.zhimg.com/b.png', mime: 'image/png', dataUrl: PNG },
    { src: 'https://pic.zhimg.com/og.png', mime: 'image/png', dataUrl: PNG },
  ],
  clipped_at: '2026-09-03T00:00:00.000Z',
}

describe('markdownTarget', () => {
  it('encodes only what breaks a bare destination', () => {
    expect(markdownTarget('../images/(99+ 封私信) 首页 - 知乎-2-1.webp')).toBe(
      '../images/%2899+%20封私信%29%20首页%20-%20知乎-2-1.webp',
    )
    expect(markdownTarget('100%.png')).toBe('100%25.png')
  })

  it('produces a destination CommonMark reads as a link', () => {
    const encoded = `![](${markdownTarget('../images/(99+ 封私信) 首页 - 知乎-2-1.webp')})`
    expect(String(marked.parse(encoded))).toContain('<img ')
  })

  it('round-trips through the decoder the app resolves links with', () => {
    const p = '../images/(99+ 封私信) 首页 - 知乎-2-1.webp'
    expect(decodeURIComponent(markdownTarget(p))).toBe(p)
  })
})

describe('writeClip', () => {
  beforeEach(() => written.clear())

  it('leaves one file behind: the note', async () => {
    const notePath = await writeClip(page)

    expect(notePath).toBe('raw/articles/(99+ 封私信) 首页 - 知乎.md')
    expect([...written.keys()]).toEqual([notePath])
  })

  it('keeps the pictures as the URLs the page served them from', async () => {
    const note = String(written.get(await writeClip(page)))

    expect(note).toContain('![](https://pic.zhimg.com/a.png)')
    expect(note).toContain('![cover](https://pic.zhimg.com/b.png)')
    expect((String(marked.parse(note)).match(/<img /g) ?? []).length).toBe(2)
  })

  it('numbers a second clip of the same page apart', async () => {
    await writeClip(page)

    expect(await writeClip(page)).toBe('raw/articles/(99+ 封私信) 首页 - 知乎-2.md')
  })
})
