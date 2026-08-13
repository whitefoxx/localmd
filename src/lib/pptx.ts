/**
 * Extract a .pptx deck into a per-slide outline for the slides preview.
 *
 * A .pptx is a zip of XML: `ppt/presentation.xml` orders the slides (via its
 * rels), each `ppt/slides/slideN.xml` holds a shape tree, and a slide's own
 * rels resolve its images. We walk the shape tree in document order and keep
 * what an outline needs — the title placeholder, the text paragraphs with
 * their indent level, table cells, and embedded pictures. PowerPoint's layout
 * model (positions, masters, themes, transitions) is deliberately not
 * reproduced; the viewer says so.
 *
 * Like the docx extractor, the XML walk needs a DOM and is exercised in the
 * browser (e2e); `resolvePart` and friends carry the unit-testable decisions.
 */
import JSZip from 'jszip'
import { resolvePart } from './xlsx'
import { mimeFor } from './filetypes'

export interface SlideLine {
  text: string
  /** Outline indent level, 0-based (`a:pPr@lvl`). */
  lvl: number
}

export interface SlideOutline {
  title: string
  lines: SlideLine[]
  /** Keys into `media` for the slide's embedded pictures, in shape order. */
  images: string[]
}

export interface PptxResult {
  slides: SlideOutline[]
  media: Map<string, Blob>
}

/** Thrown for the legacy binary .ppt format, which is not OOXML at all. */
export class LegacyPptError extends Error {
  constructor() {
    super(
      'Legacy .ppt (PowerPoint 97–2003) is not supported — open it in PowerPoint and save as .pptx.',
    )
    this.name = 'LegacyPptError'
  }
}

export async function extractPptx(bytes: ArrayBuffer): Promise<PptxResult> {
  if (isOleCompoundFile(bytes)) throw new LegacyPptError()

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new Error('Not a readable .pptx file (the zip container could not be opened).')
  }
  const presentationXml = await readText(zip, 'ppt/presentation.xml')
  if (presentationXml === null) {
    throw new Error('Not a PowerPoint deck: ppt/presentation.xml is missing.')
  }

  const presentation = parseXml(presentationXml, 'ppt/presentation.xml')
  const rels = parseRels(await readText(zip, 'ppt/_rels/presentation.xml.rels'))

  const slides: SlideOutline[] = []
  const media = new Map<string, Blob>()
  for (const sldId of byLocal(presentation.documentElement, 'sldId')) {
    const rid = sldId.getAttributeNS(RELS_NS, 'id') ?? sldId.getAttribute('r:id') ?? ''
    const target = rels.get(rid)
    if (!target) continue
    const partPath = resolvePart('ppt', target)
    const xml = await readText(zip, partPath)
    if (xml === null) continue
    const slideRels = parseRels(
      await readText(zip, relsPathFor(partPath)),
    )
    slides.push(
      await parseSlide(parseXml(xml, partPath), partPath, slideRels, zip, media),
    )
  }
  return { slides, media }
}

/** `ppt/slides/slide1.xml` → `ppt/slides/_rels/slide1.xml.rels`. */
export function relsPathFor(partPath: string): string {
  const i = partPath.lastIndexOf('/')
  return `${partPath.slice(0, i)}/_rels/${partPath.slice(i + 1)}.rels`
}

/* ── the shape tree ──────────────────────────────────────────────────────── */

async function parseSlide(
  doc: XMLDocument,
  partPath: string,
  rels: Map<string, string>,
  zip: JSZip,
  media: Map<string, Blob>,
): Promise<SlideOutline> {
  const out: SlideOutline = { title: '', lines: [], images: [] }
  const spTree = byLocal(doc.documentElement, 'spTree')[0]
  if (!spTree) return out
  await walkShapes(spTree, out, partPath, rels, zip, media)
  return out
}

async function walkShapes(
  parent: Element,
  out: SlideOutline,
  partPath: string,
  rels: Map<string, string>,
  zip: JSZip,
  media: Map<string, Blob>,
): Promise<void> {
  for (const el of Array.from(parent.children)) {
    switch (el.localName) {
      case 'sp': {
        const isTitle = byLocal(el, 'ph').some((ph) =>
          ['title', 'ctrTitle'].includes(ph.getAttribute('type') ?? ''),
        )
        for (const p of byLocal(el, 'p')) {
          const text = paragraphText(p)
          if (!text) continue
          if (isTitle && !out.title) out.title = text
          else out.lines.push({ text, lvl: paragraphLevel(p) })
        }
        break
      }
      case 'graphicFrame': {
        // A table: each row becomes one outline line, cells joined visibly.
        for (const tr of byLocal(el, 'tr')) {
          const cells = byLocal(tr, 'tc').map((tc) =>
            byLocal(tc, 'p').map(paragraphText).filter(Boolean).join(' '),
          )
          if (cells.some(Boolean)) out.lines.push({ text: cells.join(' · '), lvl: 0 })
        }
        break
      }
      case 'pic': {
        const rid =
          byLocal(el, 'blip')[0]?.getAttributeNS(RELS_NS, 'embed') ??
          byLocal(el, 'blip')[0]?.getAttribute('r:embed') ??
          ''
        const target = rels.get(rid)
        if (!target) break
        const mediaPath = resolvePart(partPath.slice(0, partPath.lastIndexOf('/')), target)
        if (!media.has(mediaPath)) {
          const bytes = await zip.file(mediaPath)?.async('arraybuffer')
          if (!bytes) break
          media.set(mediaPath, new Blob([bytes], { type: mimeFor(mediaPath) }))
        }
        out.images.push(mediaPath)
        break
      }
      case 'grpSp':
        await walkShapes(el, out, partPath, rels, zip, media)
        break
    }
  }
}

function paragraphText(p: Element): string {
  // Runs and line breaks in order; a:br becomes a space so the line stays one.
  const parts: string[] = []
  for (const child of Array.from(p.children)) {
    if (child.localName === 'r' || child.localName === 'fld') {
      parts.push(byLocal(child, 't')[0]?.textContent ?? '')
    } else if (child.localName === 'br') {
      parts.push(' ')
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}

function paragraphLevel(p: Element): number {
  const lvl = Number(
    Array.from(p.children)
      .find((c) => c.localName === 'pPr')
      ?.getAttribute('lvl') ?? 0,
  )
  return Number.isInteger(lvl) && lvl > 0 ? Math.min(lvl, 8) : 0
}

/* ── plumbing (mirrors the docx/xlsx extractors) ─────────────────────────── */

const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function parseRels(xml: string | null): Map<string, string> {
  const map = new Map<string, string>()
  if (xml === null) return map
  const doc = parseXml(xml, 'rels')
  for (const rel of byLocal(doc.documentElement, 'Relationship')) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (id && target && rel.getAttribute('TargetMode') !== 'External') map.set(id, target)
  }
  return map
}

function isOleCompoundFile(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes.slice(0, 8))
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  return b.length === 8 && magic.every((m, i) => b[i] === m)
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path)
  return entry ? entry.async('text') : null
}

function parseXml(xml: string, what: string): XMLDocument {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`Could not parse ${what}.`)
  }
  return doc
}

/** All descendants with the given local name, in document order. */
function byLocal(el: Element, localName: string): Element[] {
  return Array.from(el.getElementsByTagNameNS('*', localName))
}
