import { describe, it, expect } from 'vitest'
import {
  clipSlug,
  yamlValue,
  clipFrontmatter,
  rewriteImages,
  renderClipNote,
  parseClip,
  markdownRefs,
  dataUrlToBlob,
  webAnnotationsFor,
  type ClipPayload,
} from '@/lib/clip'

const base: ClipPayload = {
  title: 'A Clipped Article',
  url: 'https://ex.test/a?utm=1',
  canonical: 'https://ex.test/a',
  site: 'Example',
  author: 'Ada',
  published: '2026-01-02T03:04:05Z',
  lang: 'en',
  mode: 'article',
  markdown: '# A Clipped Article\n\nBody text.',
  images: [],
  clipped_at: '2026-09-03T00:00:00.000Z',
}

describe('clipSlug', () => {
  it('uses the title, stripped of characters a filename or a wikilink cannot hold', () => {
    expect(clipSlug({ title: 'Why: a/b [note] #1?' })).toBe('Why a b note 1')
  })

  it('keeps CJK', () => {
    expect(clipSlug({ title: '知识库与浏览器' })).toBe('知识库与浏览器')
  })

  it('falls back to the host, then to a constant', () => {
    expect(clipSlug({ title: '', url: 'https://www.ex.test/a' })).toBe('ex.test')
    expect(clipSlug({ title: '   ', url: 'not a url' })).toBe('clip')
  })

  it('caps the length and does not end on punctuation', () => {
    const slug = clipSlug({ title: 'x'.repeat(80) + ' tail.' })
    expect(slug.length).toBeLessThanOrEqual(60)
    expect(slug.endsWith('.')).toBe(false)
  })

  it('cuts a long title at a word boundary rather than mid-word', () => {
    const slug = clipSlug({ title: 'Three sites made 215,128 best software pages for AI. Perplexity cites them' })
    expect(slug).toBe('Three sites made 215,128 best software pages for AI')
  })
})

describe('yamlValue', () => {
  it('leaves an ordinary value bare and quotes one that would be misread', () => {
    expect(yamlValue('Example')).toBe('Example')
    expect(yamlValue('知识库')).toBe('知识库')
    expect(yamlValue('Why: a note')).toBe('"Why: a note"')
    expect(yamlValue('https://ex.test/a?b=1&c=2')).toBe('https://ex.test/a?b=1&c=2')
    // A quote is special only where a value STARTS; mid-value it is just text.
    expect(yamlValue('say "hi"')).toBe('say "hi"')
    expect(yamlValue('"quoted"')).toBe('"\\"quoted\\""')
    expect(yamlValue('- dash first')).toBe('"- dash first"')
    expect(yamlValue('')).toBe('""')
  })

  it('never emits a newline', () => {
    expect(yamlValue('a\nb')).not.toContain('\n')
  })
})

describe('clipFrontmatter', () => {
  it('carries the house type, the canonical url, and only fields the page gave', () => {
    const fm = clipFrontmatter(base)
    expect(fm).toContain('type: source')
    expect(fm).toContain('url: https://ex.test/a')
    expect(fm).toContain('author: Ada')
    expect(fm).toContain('clipped: 2026-09-03T00:00:00.000Z')
    expect(fm).not.toContain('modified:')
  })

  it('falls back to the visited url when there is no canonical', () => {
    expect(clipFrontmatter({ ...base, canonical: undefined })).toContain('url: https://ex.test/a?utm=1')
  })

  it('carries a selection anchor as one JSON line', () => {
    const fm = clipFrontmatter({
      ...base,
      mode: 'selection',
      selection: { exact: 'a\nb', prefix: 'p', suffix: 's' },
    })
    const line = fm.split('\n').find((l) => l.startsWith('anchor: '))!
    expect(JSON.parse(JSON.parse(line.slice(8)))).toEqual({ exact: 'a\nb', prefix: 'p', suffix: 's' })
  })
})

describe('rewriteImages', () => {
  it('points saved images at their local file and leaves the rest alone', () => {
    const md = '![a](https://c.test/a.png) ![b](https://c.test/b.png)'
    const out = rewriteImages(md, new Map([['https://c.test/a.png', 'note-1.png']]))
    expect(out).toContain('![a](note-1.png)')
    expect(out).toContain('![b](https://c.test/b.png)')
  })
})

describe('renderClipNote', () => {
  it('is frontmatter, a heading, a source line, then the page', () => {
    const note = renderClipNote(base)
    expect(note.startsWith('---\n')).toBe(true)
    expect(note).toContain('# A Clipped Article')
    expect(note).toContain('> Clipped from [Example](https://ex.test/a) · Ada · 2026-01-02T03:04:05Z')
    expect(note).toContain('Body text.')
    expect(note.endsWith('\n')).toBe(true)
  })

  it('does not add a second heading when the page brought its own', () => {
    // base.markdown already opens with "# A Clipped Article".
    expect(renderClipNote(base).match(/^# /gm)).toHaveLength(1)
  })

  it('adds the heading when the content starts with prose', () => {
    const note = renderClipNote({ ...base, markdown: 'Straight into the body text.' })
    expect(note).toContain('# A Clipped Article')
    expect(note).toContain('Straight into the body text.')
  })

  it('says when it is a passage and when it was cut off', () => {
    const note = renderClipNote({ ...base, mode: 'selection', truncated: true })
    expect(note).toContain('A selected passage')
    expect(note).toContain('cut off')
  })

  it('does not print the author twice when it just repeats the site', () => {
    const note = renderClipNote({ ...base, author: 'Example' })
    expect(note).toContain('> Clipped from [Example](https://ex.test/a) · 2026-01-02T03:04:05Z')
  })

  it('names the host when the page declares no site', () => {
    expect(renderClipNote({ ...base, site: undefined })).toContain('[ex.test](https://ex.test/a)')
  })
})

describe('markdownRefs', () => {
  it('collects the image targets the content actually shows', () => {
    expect([...markdownRefs('![a](x.png) text ![b](y.png "t") [not an image](z.png)')]).toEqual([
      'x.png',
      'y.png',
    ])
  })
})

describe('parseClip', () => {
  it('accepts a real payload and normalizes the optional fields', () => {
    const clip = parseClip({ ...base, title: '  T  ', site: '   ', mode: 'nonsense' })!
    expect(clip.title).toBe('T')
    expect(clip.site).toBeUndefined()
    expect(clip.mode).toBe('article')
  })

  it('rejects anything that is not recognisably a clip', () => {
    expect(parseClip(null)).toBeNull()
    expect(parseClip({ url: 'https://x.test' })).toBeNull()
    expect(parseClip({ markdown: 'x' })).toBeNull()
    expect(parseClip('a string')).toBeNull()
  })

  it('keeps a selection only when it has the passage itself', () => {
    expect(parseClip({ ...base, selection: { prefix: 'p' } })!.selection).toBeUndefined()
    expect(parseClip({ ...base, selection: { exact: 'e' } })!.selection).toEqual({
      exact: 'e',
      prefix: '',
      suffix: '',
    })
  })
})

describe('dataUrlToBlob', () => {
  it('decodes a base64 data URL and rejects anything else', () => {
    const blob = dataUrlToBlob('data:image/png;base64,QUJD')!
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(3)
    expect(dataUrlToBlob('https://x.test/a.png')).toBeNull()
    expect(dataUrlToBlob('data:image/png;base64,!!!')).toBeNull()
  })
})

describe('webAnnotationsFor', () => {
  const withHighlights: ClipPayload = {
    ...base,
    highlights: [
      {
        id: 'hl_1',
        text: 'a marked line',
        color: 'green',
        note: 'keep',
        date: '2026-09-03T09:00:00.000Z',
        anchor: { exact: 'a marked line', prefix: 'p', suffix: 's' },
      },
      {
        id: 'hl_2',
        text: 'another',
        date: '2026-09-03T09:01:00.000Z',
        anchor: { exact: 'another', prefix: '', suffix: '' },
      },
    ],
  }

  it('turns the clip\'s highlights into sidecar entries against the canonical url', () => {
    const out = webAnnotationsFor(withHighlights)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      anchor: { exact: 'a marked line', prefix: 'p', suffix: 's' },
      url: 'https://ex.test/a',
      color: '#7ED67E',
      text: 'a marked line',
      createdAt: '2026-09-03T09:00:00.000Z',
      note: 'keep',
      id: 'hl_1',
    })
    // No note, no colour → no note key, palette default.
    expect('note' in out[1]).toBe(false)
    expect(out[1].color).toBe('#FFD633')
  })

  it('is empty for a clip with no highlights', () => {
    expect(webAnnotationsFor(base)).toEqual([])
  })

  it('parseClip keeps well-formed highlights and drops the rest', () => {
    const clip = parseClip({
      ...base,
      highlights: [withHighlights.highlights![0], { text: 'no anchor' }, 'junk'],
    })!
    expect(clip.highlights).toHaveLength(1)
  })
})
