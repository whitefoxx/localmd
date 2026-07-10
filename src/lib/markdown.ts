/**
 * Markdown → HTML for the preview pane: marked with a custom inline extension
 * that renders [[wikilinks]] as clickable anchors. Link resolution (does the
 * target page exist, and where) is injected per render so this module stays
 * store-agnostic.
 */
import { Marked } from 'marked'
import { splitLink, escapeHtml, splitFrontmatter } from './wiki'

export interface WikilinkResolver {
  /** Returns the KB-relative path for a wikilink target, or null if missing. */
  resolve(target: string): string | null
}

interface WikilinkToken {
  type: 'wikilink'
  raw: string
  inner: string
}

export function renderMarkdown(content: string, resolver: WikilinkResolver): string {
  const { body } = splitFrontmatter(content)

  const marked = new Marked({
    gfm: true,
    breaks: false,
  })

  marked.use({
    extensions: [
      {
        name: 'wikilink',
        level: 'inline',
        start(src: string) {
          const i = src.indexOf('[[')
          return i < 0 ? undefined : i
        },
        tokenizer(src: string) {
          const m = /^\[\[([^\[\]]+)\]\]/.exec(src)
          if (!m) return undefined
          return { type: 'wikilink', raw: m[0], inner: m[1] } as WikilinkToken
        },
        renderer(token) {
          const { target, label } = splitLink((token as unknown as WikilinkToken).inner)
          const resolved = resolver.resolve(target)
          const cls = resolved ? 'wikilink' : 'wikilink wikilink-broken'
          const data = resolved ?? target
          return `<a class="${cls}" data-target="${escapeHtml(data)}" data-resolved="${resolved ? '1' : ''}">${escapeHtml(label)}</a>`
        },
      },
    ],
  })

  return marked.parse(body, { async: false }) as string
}
