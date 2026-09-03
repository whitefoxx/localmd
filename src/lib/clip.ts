/**
 * A web clip becoming a note.
 *
 * localmd Connect hands over a page as DATA — metadata the page declared, its
 * main content as Markdown, its images as URLs or bytes — and deliberately
 * decides nothing about the knowledge base. That is this file's job, because
 * the extension cannot see the folder: where a clip lands, what its
 * frontmatter says, what its images are called.
 *
 * Placement follows the same rule as every other intake (lib/capture): a KB
 * with a `raw/` tree buckets by type, any other folder gets the neutral
 * `inbox/`. Opening someone's existing folder must never graft our layout onto
 * it, and a clip is not special enough to be the exception.
 *
 * Images land BESIDE the note with a bare-filename link, which is the
 * convention already set by pasting into the editor (lib/editor/paste). The
 * alternative — the shared `raw/images/` bucket — is for files that arrive
 * without an owner; a clip's images belong to their note, and a relative path
 * out of the note's directory is one more thing that can break when either
 * moves.
 *
 * The pure half (naming, frontmatter, rendering) is exported for tests; the
 * only I/O is in writeClip().
 */
import * as fs from '@/lib/fs'
import { landingPathFor, resolveUniquePath, usesRawLayout } from '@/lib/capture'

export interface ClipImage {
  src: string
  dataUrl?: string
  bytes?: number
  mime?: string
  error?: string
}

/** W3C TextQuoteSelector — what makes a clipped passage findable again in the
 *  live page, long after the page has been re-rendered around it. */
export interface ClipSelection {
  exact: string
  prefix: string
  suffix: string
}

export interface ClipPayload {
  title: string
  url: string
  canonical?: string
  site?: string
  description?: string
  author?: string
  published?: string
  modified?: string
  image?: string
  lang?: string
  mode: 'article' | 'full' | 'selection'
  markdown: string
  truncated?: boolean
  images?: ClipImage[]
  selection?: ClipSelection
  clipped_at?: string
}

const MAX_STEM = 60

/** Characters that are illegal in a filename, plus the ones that would make a
 *  name awkward to reference from a wikilink or a heading. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\x00-\x1f<>:"|?*/\\[\]#^]/g

/**
 * The note's filename stem, from the page's title. CJK is kept — half the KBs
 * this serves are Chinese, and transliterating would make every note harder to
 * find than the title it came from.
 */
export function clipSlug(payload: { title?: string; url?: string }): string {
  const fromTitle = (payload.title ?? '').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
  let stem = fromTitle
  if (!stem) {
    try {
      stem = new URL(payload.url ?? '').hostname.replace(/^www\./, '')
    } catch {
      stem = ''
    }
  }
  if (stem.length > MAX_STEM) {
    // Cut at a word boundary when one is near the limit — a filename ending
    // mid-word ("…Perplex") reads like a truncated file, not a short title.
    const cut = stem.slice(0, MAX_STEM)
    const space = cut.lastIndexOf(' ')
    stem = space >= MAX_STEM * 0.6 ? cut.slice(0, space) : cut
  }
  stem = stem.replace(/[\s.,;:!?-]+$/, '')
  return stem || 'clip'
}

/**
 * A frontmatter scalar, quoted only where YAML actually needs it — a colon is
 * special only before a space, so `url: https://x/y` is a plain value and
 * quoting it would just make every clipped note harder to read.
 *
 * Newlines are folded to spaces rather than escaped: nothing this writes is
 * multi-line by nature (a title, a site, a date), and a value that arrived with
 * a newline in it is a page misbehaving, not a structure to preserve.
 */
export function yamlValue(v: string): string {
  const s = v.replace(/\r?\n/g, ' ').trim()
  if (!s) return '""'
  const needsQuotes =
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || s.includes(': ') || s.includes(' #') || s.endsWith(':')
  if (!needsQuotes) return s
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * The note's frontmatter. `type: source` is the house word for material the KB
 * cites rather than authors, and the rest is only ever what the page itself
 * declared — an absent field means the page did not say, never a guess.
 *
 * A selection clip additionally carries its anchor as one JSON line: the three
 * parts belong together, and a nested mapping is more structure than this
 * frontmatter dialect reads.
 */
export function clipFrontmatter(payload: ClipPayload, now = new Date()): string {
  const lines: string[] = ['---', `title: ${yamlValue(payload.title || clipSlug(payload))}`, 'type: source']
  const url = payload.canonical || payload.url
  if (url) lines.push(`url: ${yamlValue(url)}`)
  if (payload.site) lines.push(`site: ${yamlValue(payload.site)}`)
  if (payload.author) lines.push(`author: ${yamlValue(payload.author)}`)
  if (payload.published) lines.push(`published: ${yamlValue(payload.published)}`)
  if (payload.lang) lines.push(`lang: ${yamlValue(payload.lang)}`)
  lines.push(`clipped: ${yamlValue(payload.clipped_at || now.toISOString())}`)
  if (payload.selection) {
    lines.push(`anchor: ${JSON.stringify(JSON.stringify(payload.selection))}`)
  }
  lines.push('---')
  return lines.join('\n')
}

/** Rewrite the Markdown's image targets to the files written beside the note.
 *  An image that could not be fetched keeps its remote URL rather than becoming
 *  a broken local link. */
export function rewriteImages(markdown: string, byUrl: Map<string, string>): string {
  if (!byUrl.size) return markdown
  return markdown.replace(/(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (all, open, src, close) => {
    const local = byUrl.get(src)
    return local ? `${open}${local}${close}` : all
  })
}

/**
 * The note. A heading, one line saying where it came from, then the page.
 *
 * The source line is duplicated from the frontmatter on purpose: frontmatter is
 * metadata for the machinery, and a reader who opens this note in six months
 * should not have to know the dialect to find out what they were reading.
 */
export function renderClipNote(
  payload: ClipPayload,
  byUrl: Map<string, string> = new Map(),
): string {
  const title = payload.title || clipSlug(payload)
  const url = payload.canonical || payload.url
  const body = rewriteImages(payload.markdown ?? '', byUrl).trim()
  const label = payload.site || hostOf(url) || url
  const parts: string[] = [clipFrontmatter(payload)]
  // Only add a heading when the page did not bring one. Plenty of pages put
  // their H1 inside the main content (MDN does), and a note that opens with the
  // same title twice reads like a bug — which it was.
  if (!/^#\s/.test(body)) parts.push(`# ${title}`)
  // The author is dropped when it merely repeats the site — plenty of
  // publications set both meta tags to their own name.
  const author = payload.author && payload.author !== payload.site ? payload.author : null
  const bits = [url ? `Clipped from [${label}](${url})` : null, author, payload.published]
  const source = bits.filter(Boolean).join(' · ')
  if (source) parts.push(`> ${source}`)
  if (payload.mode === 'selection') parts.push('> A selected passage, not the whole page.')
  if (payload.truncated) parts.push('> The page was longer than the clip limit and is cut off.')
  if (body) parts.push(body)
  return parts.join('\n\n') + '\n'
}

/** Image targets the Markdown actually references. */
export function markdownRefs(markdown: string): Set<string> {
  const out = new Set<string>()
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.add(m[1])
  return out
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
}

/** data: URL → Blob, or null when it is not one we can decode. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) return null
  try {
    const bin = atob(m[2])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: m[1] })
  } catch {
    return null
  }
}

/** Shape-check a clip that arrived as JSON from a tool result. Anything that is
 *  not recognisably a clip is rejected rather than half-written. */
export function parseClip(value: unknown): ClipPayload | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (typeof o.markdown !== 'string' || typeof o.url !== 'string') return null
  const mode = o.mode === 'full' || o.mode === 'selection' ? o.mode : 'article'
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined
  const sel = o.selection as Record<string, unknown> | undefined
  return {
    title: str(o.title) ?? '',
    url: o.url,
    canonical: str(o.canonical),
    site: str(o.site),
    description: str(o.description),
    author: str(o.author),
    published: str(o.published),
    modified: str(o.modified),
    image: str(o.image),
    lang: str(o.lang),
    mode,
    markdown: o.markdown,
    truncated: o.truncated === true,
    images: Array.isArray(o.images) ? (o.images as ClipImage[]) : [],
    ...(sel && typeof sel.exact === 'string'
      ? {
          selection: {
            exact: sel.exact,
            prefix: typeof sel.prefix === 'string' ? sel.prefix : '',
            suffix: typeof sel.suffix === 'string' ? sel.suffix : '',
          },
        }
      : {}),
    clipped_at: str(o.clipped_at),
  }
}

/**
 * Write a clip into the KB: its images first (so the note never links a file
 * that is not there yet), then the note. Returns the note's path.
 *
 * An image that fails to write is skipped and its Markdown keeps the remote
 * URL — a clip is worth having with one picture missing, and the alternative
 * is losing the text because a CDN returned something odd.
 */
export async function writeClip(payload: ClipPayload): Promise<string> {
  const stem = clipSlug(payload)
  const notePath = await resolveUniquePath(landingPathFor(`${stem}.md`, await usesRawLayout()))
  const dir = notePath.slice(0, notePath.lastIndexOf('/') + 1)
  const noteStem = notePath.slice(dir.length, notePath.length - 3)

  const byUrl = new Map<string, string>()
  let n = 0
  for (const img of payload.images ?? []) {
    if (!img.dataUrl) continue
    // Only pictures the note will actually show. The clipper also hands over
    // the page's social-card image (og:image), which usually appears nowhere in
    // the content — saving it would leave a file in the folder that nothing
    // points at, and an orphan is exactly what a knowledge base must not
    // accumulate.
    if (!markdownRefs(payload.markdown ?? '').has(img.src)) continue
    const blob = dataUrlToBlob(img.dataUrl)
    if (!blob) continue
    n++
    const ext = EXT_BY_MIME[img.mime ?? blob.type] ?? 'png'
    const name = `${noteStem}-${n}.${ext}`
    try {
      await fs.writeFile(`${dir}${name}`, blob)
      byUrl.set(img.src, name)
    } catch {
      /* keep the remote URL in the Markdown */
    }
  }
  await fs.writeFile(notePath, renderClipNote(payload, byUrl))
  return notePath
}
