/**
 * Extract a .docx (Office Open XML) into citeable blocks plus display HTML.
 *
 * A .docx is a zip of XML: `word/document.xml` holds the flow, `styles.xml`
 * names the paragraph styles (that's how a heading announces itself),
 * `numbering.xml` says whether a list is bulleted or numbered, and
 * `document.xml.rels` resolves hyperlink and image targets. We read those
 * directly rather than pulling in a converter — the KB only needs structure
 * (headings, lists, tables, emphasis, images), not Word's layout model.
 *
 * Both the indexer and the viewer call this, so block ids must be a pure
 * function of the bytes: the viewer resolves a citation by looking up
 * `[data-bid]` in the HTML rendered here.
 *
 * Not extracted: footnotes/endnotes, comments, headers/footers, text boxes,
 * and tracked-change deletions (which are skipped on purpose — the index
 * should read like the accepted document).
 */
import JSZip from 'jszip'
import type { DocxBlock } from './types'

export interface DocxExtractResult {
  title: string
  blocks: DocxBlock[]
  /** Semantic HTML for the viewer; every block element carries `data-bid`. */
  html: string
  /** Embedded images keyed by the `data-media` value on their `<img>` tags. */
  media: Map<string, Blob>
}

/** Thrown for the legacy binary .doc format, which is not OOXML at all. */
export class LegacyDocError extends Error {
  constructor() {
    super('Legacy .doc (Word 97–2003) is not supported — open it in Word and save as .docx.')
    this.name = 'LegacyDocError'
  }
}

export async function extractDocx(
  bytes: ArrayBuffer,
  fallbackTitle: string,
  onProgress: (current: number, total: number) => void = () => {},
): Promise<DocxExtractResult> {
  if (isOleCompoundFile(bytes)) throw new LegacyDocError()

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new Error('Not a readable .docx file (the zip container could not be opened).')
  }
  const documentXml = await readText(zip, 'word/document.xml')
  if (documentXml === null) {
    throw new Error('Not a Word document: word/document.xml is missing.')
  }

  const doc = parseXml(documentXml, 'word/document.xml')
  const styles = await parseStyles(zip)
  const numbering = await parseNumbering(zip)
  const rels = await parseRels(zip)

  const body = firstChild(doc.documentElement, 'body') ?? doc.documentElement
  const flow: Element[] = []
  collectFlow(body, flow)

  const ctx: Ctx = { styles, numbering, rels, mediaWanted: new Set() }
  const blocks: DocxBlock[] = []
  const html: string[] = []
  let listRun: ListRun | null = null
  const flushList = (): void => {
    if (listRun) html.push(renderList(listRun))
    listRun = null
  }

  for (let i = 0; i < flow.length; i++) {
    if (i % 50 === 0) onProgress(i + 1, flow.length)
    const el = flow[i]

    if (el.localName === 'tbl') {
      flushList()
      const table = readTable(el, ctx)
      if (!table.rows.length) continue
      const block = addBlock(blocks, 'table', 0, table.rows.map((r) => r.join(' | ')).join('\n'))
      html.push(renderTable(table, block.id))
      continue
    }

    const para = readParagraph(el, ctx)
    if (!para.text && !para.hasImage) continue

    if (para.list) {
      const block = addBlock(blocks, 'list', para.list.level + 1, para.text)
      const item = { level: para.list.level, html: para.html, id: block.id }
      if (listRun && listRun.ordered === para.list.ordered) listRun.items.push(item)
      else {
        flushList()
        listRun = { ordered: para.list.ordered, items: [item] }
      }
      continue
    }
    flushList()

    const block = addBlock(blocks, para.kind, para.level, para.text)
    html.push(renderParagraph(para, block.id))
  }
  flushList()
  onProgress(flow.length, flow.length)

  // Only load the images actually referenced — a docx can carry unused media.
  const media = new Map<string, Blob>()
  for (const path of ctx.mediaWanted) {
    const file = zip.file(path)
    if (file) media.set(path, await file.async('blob'))
  }

  const heading = blocks.find((b) => b.kind === 'heading')
  const title =
    (await readCoreTitle(zip)) || (heading ? heading.text : '') || fallbackTitle || 'Document'

  return { title: title.slice(0, 200), blocks, html: html.join('\n'), media }
}

/* ── document.xml walking ────────────────────────────────────────────────── */

interface Ctx {
  styles: Map<string, string>
  numbering: Map<string, boolean>
  rels: Map<string, string>
  /** Media paths referenced by the document — loaded from the zip at the end. */
  mediaWanted: Set<string>
}

interface Para {
  kind: DocxBlock['kind']
  level: number
  text: string
  html: string
  hasImage: boolean
  list: { level: number; ordered: boolean } | null
}

export interface ListRun {
  ordered: boolean
  items: { level: number; html: string; id: string }[]
}

/**
 * Flatten the body into the paragraphs and tables that make up the document,
 * in reading order. Structured-document tags (`w:sdt`, used by content
 * controls and tables of contents) and other wrappers are transparent; a
 * table is returned whole, since its paragraphs live inside its cells.
 */
function collectFlow(node: Element, out: Element[]): void {
  for (const child of Array.from(node.children)) {
    const name = child.localName
    if (name === 'p' || name === 'tbl') out.push(child)
    else if (name === 'sectPr' || name === 'del') continue
    else if (name === 'AlternateContent') {
      // Choice and Fallback hold the same content twice — take one.
      const pick = firstChild(child, 'Choice') ?? firstChild(child, 'Fallback')
      if (pick) collectFlow(pick, out)
    } else collectFlow(child, out)
  }
}

function readParagraph(p: Element, ctx: Ctx): Para {
  const pPr = firstChild(p, 'pPr')
  const styleId = pPr ? val(firstChild(pPr, 'pStyle')) : null
  const styleName = styleId ? (ctx.styles.get(styleId) ?? styleId) : ''
  const level = headingLevel(styleId, styleName)

  const numPr = pPr ? firstChild(pPr, 'numPr') : null
  let list: Para['list'] = null
  if (numPr) {
    const numId = val(firstChild(numPr, 'numId')) ?? ''
    const ilvl = Number(val(firstChild(numPr, 'ilvl')) ?? '0')
    list = { level: Number.isFinite(ilvl) ? Math.min(5, Math.max(0, ilvl)) : 0, ordered: ctx.numbering.get(`${numId}:${ilvl}`) ?? false }
  }

  const inline = readInline(p, ctx)
  const text = inline.text.replace(/[ \t]+/g, ' ').trim()
  const kind: DocxBlock['kind'] = level > 0
    ? 'heading'
    : list
      ? 'list'
      : /quote/i.test(styleName)
        ? 'quote'
        : /(^|\W)(code|preformatted)/i.test(styleName)
          ? 'code'
          : 'text'

  return { kind, level, text, html: inline.html, hasImage: inline.hasImage, list: level > 0 ? null : list }
}

/** Recursively render one paragraph's runs to text + inline HTML. */
function readInline(node: Element, ctx: Ctx): { text: string; html: string; hasImage: boolean } {
  let text = ''
  let html = ''
  let hasImage = false

  for (const child of Array.from(node.children)) {
    switch (child.localName) {
      case 'pPr':
      case 'rPr':
      case 'instrText': // field codes (PAGEREF, HYPERLINK, …) — not content
      case 'delText':
      case 'del': // tracked deletion
      case 'commentRangeStart':
      case 'commentRangeEnd':
      case 'proofErr':
        continue
      case 't': {
        const s = child.textContent ?? ''
        text += s
        html += escapeHtml(s)
        continue
      }
      case 'tab':
        text += '\t'
        html += ' '
        continue
      case 'br':
      case 'cr':
        text += '\n'
        html += '<br>'
        continue
      case 'noBreakHyphen':
        text += '-'
        html += '-'
        continue
      case 'r': {
        const inner = readInline(child, ctx)
        text += inner.text
        hasImage ||= inner.hasImage
        html += wrapRun(child, inner.html)
        continue
      }
      case 'hyperlink': {
        const inner = readInline(child, ctx)
        text += inner.text
        hasImage ||= inner.hasImage
        const href = safeHref(ctx.rels.get(rid(child) ?? '') ?? '')
        html += href
          ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${inner.html}</a>`
          : inner.html
        continue
      }
      case 'drawing':
      case 'pict':
      case 'object': {
        const img = readImage(child, ctx)
        if (img) {
          hasImage = true
          html += img
        }
        continue
      }
      default: {
        const inner = readInline(child, ctx)
        text += inner.text
        hasImage ||= inner.hasImage
        html += inner.html
      }
    }
  }
  return { text, html, hasImage }
}

/** Wrap a run's HTML in emphasis tags according to its run properties. */
function wrapRun(run: Element, inner: string): string {
  if (!inner) return ''
  const rPr = firstChild(run, 'rPr')
  if (!rPr) return inner
  const on = (name: string): boolean => {
    const el = firstChild(rPr, name)
    return !!el && val(el) !== '0' && val(el) !== 'false' && val(el) !== 'none'
  }
  let out = inner
  if (on('b')) out = `<strong>${out}</strong>`
  if (on('i')) out = `<em>${out}</em>`
  if (on('u')) out = `<u>${out}</u>`
  if (on('strike') || on('dstrike')) out = `<s>${out}</s>`
  if (firstChild(rPr, 'highlight')) out = `<mark>${out}</mark>`
  return out
}

/** `<img>` for an embedded picture, or null when the relationship is missing. */
function readImage(node: Element, ctx: Ctx): string | null {
  const embed = findDeep(node, (el) => el.localName === 'blip' || el.localName === 'imagedata')
  if (!embed) return null
  const target = ctx.rels.get(rid(embed) ?? '')
  if (!target) return null
  const path = target.startsWith('/') ? target.slice(1) : `word/${target}`
  ctx.mediaWanted.add(path)
  const alt = findDeep(node, (el) => el.localName === 'docPr')?.getAttribute('descr') ?? ''
  return `<img data-media="${escapeHtml(path)}" alt="${escapeHtml(alt)}" loading="lazy">`
}

interface Table {
  rows: string[][]
  cells: string[][]
}

function readTable(tbl: Element, ctx: Ctx): Table {
  const rows: string[][] = []
  const cells: string[][] = []
  for (const tr of Array.from(tbl.children).filter((c) => c.localName === 'tr')) {
    const texts: string[] = []
    const htmls: string[] = []
    for (const tc of Array.from(tr.children).filter((c) => c.localName === 'tc')) {
      const paras: Element[] = []
      collectFlow(tc, paras)
      const parts = paras.map((p) => (p.localName === 'tbl' ? readTable(p, ctx) : readParagraph(p, ctx)))
      const text = parts
        .map((p) => ('rows' in p ? p.rows.map((r) => r.join(' / ')).join(' ') : p.text))
        .filter(Boolean)
        .join(' ')
      const html = parts
        .map((p) => ('rows' in p ? '' : p.html))
        .filter(Boolean)
        .join('<br>')
      texts.push(text.replace(/\|/g, '\\|'))
      htmls.push(html)
    }
    if (texts.length) {
      rows.push(texts)
      cells.push(htmls)
    }
  }
  return { rows, cells }
}

/* ── package parts ───────────────────────────────────────────────────────── */

/** styleId → style name (`Heading3` → `heading 3`), for heading detection. */
async function parseStyles(zip: JSZip): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const xml = await readText(zip, 'word/styles.xml')
  if (!xml) return out
  try {
    const doc = parseXml(xml, 'word/styles.xml')
    for (const style of Array.from(doc.documentElement.children).filter((c) => c.localName === 'style')) {
      const id = style.getAttribute('w:styleId') ?? style.getAttribute('styleId')
      const name = val(firstChild(style, 'name'))
      if (id && name) out.set(id, name)
    }
  } catch {
    /* a malformed styles.xml just means we fall back to style ids */
  }
  return out
}

/** `numId:ilvl` → true when that list level is numbered rather than bulleted. */
async function parseNumbering(zip: JSZip): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  const xml = await readText(zip, 'word/numbering.xml')
  if (!xml) return out
  try {
    const doc = parseXml(xml, 'word/numbering.xml')
    const formats = new Map<string, Map<string, boolean>>()
    for (const abs of Array.from(doc.documentElement.children).filter((c) => c.localName === 'abstractNum')) {
      const id = abs.getAttribute('w:abstractNumId') ?? abs.getAttribute('abstractNumId')
      if (!id) continue
      const levels = new Map<string, boolean>()
      for (const lvl of Array.from(abs.children).filter((c) => c.localName === 'lvl')) {
        const ilvl = lvl.getAttribute('w:ilvl') ?? lvl.getAttribute('ilvl') ?? '0'
        levels.set(ilvl, (val(firstChild(lvl, 'numFmt')) ?? 'bullet') !== 'bullet')
      }
      formats.set(id, levels)
    }
    for (const num of Array.from(doc.documentElement.children).filter((c) => c.localName === 'num')) {
      const numId = num.getAttribute('w:numId') ?? num.getAttribute('numId')
      const absId = val(firstChild(num, 'abstractNumId'))
      const levels = absId ? formats.get(absId) : undefined
      if (!numId || !levels) continue
      for (const [ilvl, ordered] of levels) out.set(`${numId}:${ilvl}`, ordered)
    }
  } catch {
    /* unreadable numbering → everything renders as a bullet list */
  }
  return out
}

/** Relationship id → target, for hyperlinks and embedded images. */
async function parseRels(zip: JSZip): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const xml = await readText(zip, 'word/_rels/document.xml.rels')
  if (!xml) return out
  try {
    const doc = parseXml(xml, 'word/_rels/document.xml.rels')
    for (const rel of Array.from(doc.documentElement.children)) {
      const id = rel.getAttribute('Id')
      const target = rel.getAttribute('Target')
      if (id && target) out.set(id, target)
    }
  } catch {
    /* no rels → links render as plain text and images are dropped */
  }
  return out
}

async function readCoreTitle(zip: JSZip): Promise<string> {
  const xml = await readText(zip, 'docProps/core.xml')
  if (!xml) return ''
  try {
    const doc = parseXml(xml, 'docProps/core.xml')
    const el = Array.from(doc.documentElement.children).find((c) => c.localName === 'title')
    return (el?.textContent ?? '').trim()
  } catch {
    return ''
  }
}

/* ── rendering ───────────────────────────────────────────────────────────── */

function addBlock(
  blocks: DocxBlock[],
  kind: DocxBlock['kind'],
  level: number,
  text: string,
): DocxBlock {
  const block: DocxBlock = { id: `b1-${blocks.length + 1}`, kind, level, text }
  blocks.push(block)
  return block
}

function renderParagraph(para: Para, id: string): string {
  const bid = ` data-bid="${id}"`
  if (para.kind === 'heading') {
    const h = Math.min(6, Math.max(1, para.level))
    return `<h${h}${bid}>${para.html}</h${h}>`
  }
  if (para.kind === 'quote') return `<blockquote${bid}>${para.html}</blockquote>`
  if (para.kind === 'code') return `<pre${bid}><code>${para.html}</code></pre>`
  return `<p${bid}>${para.html}</p>`
}

/**
 * Render a run of consecutive list items, nesting by `w:ilvl`. A deeper list
 * opens inside the item above it (which is why `<li>` stays open until the
 * next item at the same or a shallower level arrives).
 */
export function renderList(run: ListRun): string {
  const tag = run.ordered ? 'ol' : 'ul'
  const out: string[] = [`<${tag}>`]
  /** Whether an `<li>` is still open at each depth (a list skipped over by a
   *  jump from level 0 to level 2 has none). */
  const liOpen: boolean[] = [false]
  let depth = 0
  for (const item of run.items) {
    while (depth < item.level) {
      out.push(`<${tag}>`)
      liOpen[++depth] = false
    }
    while (depth > item.level) {
      if (liOpen[depth]) out.push('</li>')
      out.push(`</${tag}>`)
      liOpen[depth--] = false
    }
    if (liOpen[depth]) out.push('</li>')
    out.push(`<li data-bid="${item.id}">${item.html}`)
    liOpen[depth] = true
  }
  while (depth > 0) {
    if (liOpen[depth]) out.push('</li>')
    out.push(`</${tag}>`)
    liOpen[depth--] = false
  }
  if (liOpen[0]) out.push('</li>')
  out.push(`</${tag}>`)
  return out.join('')
}

function renderTable(table: Table, id: string): string {
  const rows = table.cells
    .map((row, i) => {
      const cell = i === 0 ? 'th' : 'td'
      return `<tr>${row.map((c) => `<${cell}>${c}</${cell}>`).join('')}</tr>`
    })
    .join('')
  return `<table data-bid="${id}"><tbody>${rows}</tbody></table>`
}

/* ── small helpers ───────────────────────────────────────────────────────── */

/** Heading level from a paragraph style, 0 when the style isn't a heading. */
export function headingLevel(styleId: string | null, styleName: string): number {
  const probe = `${styleId ?? ''} ${styleName}`
  if (/^\s*(title)\b/i.test(styleName) || styleId === 'Title') return 1
  if (/^\s*subtitle\b/i.test(styleName) || styleId === 'Subtitle') return 2
  const m = probe.match(/heading\s*-?\s*([1-9])/i)
  return m ? Math.min(6, Number(m[1])) : 0
}

/** Allow only navigable link schemes — a .docx is untrusted input. */
export function safeHref(target: string): string | null {
  const s = target.trim()
  if (!s) return null
  if (/^(https?:|mailto:)/i.test(s)) return s
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null // javascript:, file:, …
  return null // relative targets point inside the package, not the web
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** OLE2 compound-file magic — the legacy binary .doc container. */
function isOleCompoundFile(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 8) return false
  const head = new Uint8Array(bytes, 0, 8)
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  return magic.every((b, i) => head[i] === b)
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path)
  return file ? await file.async('string') : null
}

function parseXml(xml: string, what: string): XMLDocument {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`Malformed XML in ${what}.`)
  }
  return doc
}

function firstChild(el: Element | null, localName: string): Element | null {
  if (!el) return null
  for (const child of Array.from(el.children)) if (child.localName === localName) return child
  return null
}

function findDeep(el: Element, match: (el: Element) => boolean): Element | null {
  for (const child of Array.from(el.children)) {
    if (match(child)) return child
    const hit = findDeep(child, match)
    if (hit) return hit
  }
  return null
}

/** The `w:val` attribute, tolerating documents that omit the namespace prefix. */
function val(el: Element | null): string | null {
  return el ? (el.getAttribute('w:val') ?? el.getAttribute('val')) : null
}

/** The `r:id` / `r:embed` relationship reference on an element. */
function rid(el: Element): string | null {
  return (
    el.getAttribute('r:id') ??
    el.getAttribute('r:embed') ??
    el.getAttribute('id') ??
    el.getAttribute('embed')
  )
}
