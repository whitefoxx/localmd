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
 * A clip's pictures stay as the URLs the page served them from. They used to
 * be downloaded and rewritten to local files, which is the local-first answer
 * — a note that survives the page coming down — and it was dropped anyway,
 * because of what actually arrives: a clip of a busy page is twenty avatars,
 * icons and buttons, and filing those next to the note buries it. The cost is
 * real and is the reader's to carry: when the page goes, or the CDN moves the
 * file, the pictures go with it. The words do not.
 *
 * So `images` on the payload is data we deliberately do not act on. The
 * extension still sends the bytes; nothing here reads them.
 *
 * The pure half (naming, frontmatter, rendering) is exported for tests; the
 * only I/O is in writeClip().
 */
import * as fs from '@/lib/fs'
import { landingPathFor, resolveUniquePath, usesRawLayout } from '@/lib/capture'
import { colorHexFor, saveWebSidecar, type WebAnnotation } from '@/lib/annotations'

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

/** A highlight the user had made on the page before clipping it, as the
 *  extension reports it (colour by NAME; the sidecar stores hex). */
export interface ClipHighlight {
  id: string
  text: string
  color?: string
  note?: string
  date: string
  anchor: ClipSelection
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
  /** Browser highlights on the page, arriving WITH the clip so the note and
   *  its annotations are never apart. */
  highlights?: ClipHighlight[]
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

/**
 * The note. A heading, one line saying where it came from, then the page.
 *
 * The source line is duplicated from the frontmatter on purpose: frontmatter is
 * metadata for the machinery, and a reader who opens this note in six months
 * should not have to know the dialect to find out what they were reading.
 */
export function renderClipNote(payload: ClipPayload): string {
  const title = payload.title || clipSlug(payload)
  const url = payload.canonical || payload.url
  const body = (payload.markdown ?? '').trim()
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
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

function isClipHighlight(v: unknown): v is ClipHighlight {
  const h = v as ClipHighlight | null
  return (
    !!h &&
    typeof h === 'object' &&
    typeof h.text === 'string' &&
    !!h.anchor &&
    typeof h.anchor.exact === 'string'
  )
}

/**
 * The sidecar entries for a clip's highlights. Pure. The extension names its
 * colours; sidecars store hex — the same five on both sides, so the archived
 * highlight looks like the one on the page.
 */
export function webAnnotationsFor(payload: ClipPayload): WebAnnotation[] {
  const url = payload.canonical || payload.url
  return (payload.highlights ?? []).map((h) => ({
    anchor: {
      exact: h.anchor.exact,
      prefix: h.anchor.prefix ?? '',
      suffix: h.anchor.suffix ?? '',
    },
    url,
    color: colorHexFor(h.color),
    text: h.text,
    createdAt: h.date,
    ...(h.note ? { note: h.note } : {}),
    ...(h.id ? { id: h.id } : {}),
  }))
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
    highlights: Array.isArray(o.highlights)
      ? (o.highlights as unknown[]).filter(isClipHighlight)
      : [],
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
 * A KB path as a Markdown link destination.
 *
 * A bare destination may not contain spaces or unbalanced parentheses — a
 * title like "(99+ 封私信) 首页 - 知乎" made `![](…)` that CommonMark reads as
 * plain text, and a note whose twenty pictures all rendered as their own
 * source was the result. Only the characters that break the syntax are
 * encoded (plus `%`, so the encoding round-trips); everything else, CJK
 * included, stays readable in the raw file. The app's link resolver decodes
 * with decodeURIComponent, as browsers do.
 */
export function markdownTarget(path: string): string {
  return path.replace(/[ ()%]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * Write a clip into the KB: one note, and its highlights beside it. Returns
 * the note's path. The pictures are left as the URLs the page served, for the
 * reason at the top of this file.
 */
export async function writeClip(payload: ClipPayload): Promise<string> {
  const stem = clipSlug(payload)
  const rawLayout = await usesRawLayout()
  const notePath = await resolveUniquePath(landingPathFor(`${stem}.md`, rawLayout))
  await fs.writeFile(notePath, renderClipNote(payload))
  // The highlights go beside the note in the sidecar format the annotations
  // viewer and the agent digest already read — written AFTER the note, so a
  // sidecar never exists without the file it annotates.
  const annotations = webAnnotationsFor(payload)
  if (annotations.length) await saveWebSidecar(notePath, annotations)
  return notePath
}
