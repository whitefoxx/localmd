/**
 * Locating and drawing highlight marks in a rendered .docx.
 *
 * A PDF annotation is pinned by page + rectangles and an EPUB one by CFI; a
 * .docx has neither, so a mark is pinned to the block ids the extractor already
 * emits: `b1-3:10~b1-4:22` means "from character 10 of block b1-3 to character
 * 22 of block b1-4". Block ids are a pure function of the document bytes, and
 * offsets are counted over a block's plain text, so a locator survives
 * re-rendering — and stays readable in the sidecar JSON.
 *
 * Marks are drawn by wrapping the text in `<span class="docx-mark">`, which is
 * why every function here takes the container element: the DOM is the only
 * place a range is real.
 */

export interface DocxRange {
  startBid: string
  startOffset: number
  endBid: string
  endOffset: number
}

export type MarkStyle = 'highlight' | 'underline'

const LOCATOR_RE = /^(b\d+-\d+):(\d+)~(b\d+-\d+):(\d+)$/

/** Serialize a range to its sidecar form, `b1-3:10~b1-4:22`. */
export function formatDocxRange(r: DocxRange): string {
  return `${r.startBid}:${r.startOffset}~${r.endBid}:${r.endOffset}`
}

export function parseDocxRange(locator: string): DocxRange | null {
  const m = LOCATOR_RE.exec(locator.trim())
  if (!m) return null
  return { startBid: m[1], startOffset: Number(m[2]), endBid: m[3], endOffset: Number(m[4]) }
}

/** Order two locators by document position — block order, then offset. */
export function compareDocxRange(a: string, b: string): number {
  const pa = parseDocxRange(a)
  const pb = parseDocxRange(b)
  if (!pa || !pb) return pa ? -1 : pb ? 1 : 0
  const [sa, na] = bidParts(pa.startBid)
  const [sb, nb] = bidParts(pb.startBid)
  return sa - sb || na - nb || pa.startOffset - pb.startOffset
}

/** `b1-12` → [1, 12]. Anything we can't place sorts last, like a stale locator. */
function bidParts(bid: string): [number, number] {
  const m = /^b(\d+)-(\d+)$/.exec(bid)
  return m ? [Number(m[1]), Number(m[2])] : [Infinity, Infinity]
}

/* ── reading the DOM ─────────────────────────────────────────────────────── */

function blocksIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-bid]')]
}

function blockOf(node: Node | null): HTMLElement | null {
  const el = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node?.parentElement ?? null)
  return el?.closest<HTMLElement>('[data-bid]') ?? null
}

/** Text offset of a DOM point within its block, counting only text characters. */
function offsetIn(block: HTMLElement, container: Node, offset: number): number {
  const probe = document.createRange()
  probe.setStart(block, 0)
  probe.setEnd(container, offset)
  return probe.toString().length
}

function textNodesIn(block: HTMLElement): Text[] {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const out: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text)
  return out
}

/**
 * Turn the user's selection into a locator, or null when there is nothing
 * markable. A selection that runs past the outermost block (⌘A) is clamped to
 * the document's first and last block rather than dropped.
 */
export function rangeFromSelection(
  container: HTMLElement,
  selection: Selection | null,
): { range: DocxRange; text: string } | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const domRange = selection.getRangeAt(0)
  if (!container.contains(domRange.commonAncestorContainer)) return null
  const text = domRange.toString().trim()
  if (!text) return null

  const blocks = blocksIn(container)
  if (blocks.length === 0) return null
  const startBlock = blockOf(domRange.startContainer) ?? blocks[0]
  const endBlock = blockOf(domRange.endContainer) ?? blocks[blocks.length - 1]

  const startOffset = blockOf(domRange.startContainer)
    ? offsetIn(startBlock, domRange.startContainer, domRange.startOffset)
    : 0
  const endOffset = blockOf(domRange.endContainer)
    ? offsetIn(endBlock, domRange.endContainer, domRange.endOffset)
    : (endBlock.textContent?.length ?? 0)

  return {
    range: {
      startBid: startBlock.dataset.bid ?? '',
      startOffset,
      endBid: endBlock.dataset.bid ?? '',
      endOffset,
    },
    text,
  }
}

/* ── drawing ─────────────────────────────────────────────────────────────── */

export interface MarkSpec {
  /** The annotation's locator — also the handle a click reports back. */
  id: string
  color: string
  style: MarkStyle
  /** Stamps a 📝 badge on the mark's first span. */
  hasNote?: boolean
}

/**
 * Wrap a locator's text in mark spans. Returns false when the locator no longer
 * resolves (the document changed under a stale annotation) so the caller can
 * report it rather than silently drop it.
 */
export function drawMark(container: HTMLElement, spec: MarkSpec): boolean {
  const range = parseDocxRange(spec.id)
  if (!range) return false
  const blocks = blocksIn(container)
  const from = blocks.findIndex((b) => b.dataset.bid === range.startBid)
  const to = blocks.findIndex((b) => b.dataset.bid === range.endBid)
  if (from < 0 || to < 0 || to < from) return false

  const created: HTMLElement[] = []
  for (let i = from; i <= to; i++) {
    const block = blocks[i]
    const start = i === from ? range.startOffset : 0
    const end = i === to ? range.endOffset : (block.textContent?.length ?? 0)
    created.push(...wrapInBlock(block, start, end, spec))
  }
  if (created.length === 0) return false
  if (spec.hasNote) created[0].dataset.note = '1'
  return true
}

/** Wrap `[from, to)` of one block's text, splitting text nodes as needed. */
function wrapInBlock(block: HTMLElement, from: number, to: number, spec: MarkSpec): HTMLElement[] {
  if (to <= from) return []
  const created: HTMLElement[] = []
  let seen = 0
  // Snapshot first: wrapping splits nodes as we go.
  for (const textNode of textNodesIn(block)) {
    const start = seen
    const end = seen + textNode.data.length
    seen = end
    if (end <= from || start >= to) continue

    let node = textNode
    if (start < from) node = node.splitText(from - start)
    const wanted = Math.min(to, end) - Math.max(start, from)
    if (node.data.length > wanted) node.splitText(wanted)

    const span = document.createElement('span')
    span.className = 'docx-mark'
    span.dataset.anno = spec.id
    span.dataset.style = spec.style
    if (spec.style === 'underline') {
      span.style.borderBottom = `2px solid ${spec.color}`
    } else {
      span.style.backgroundColor = withAlpha(spec.color)
    }
    node.parentNode?.insertBefore(span, node)
    span.appendChild(node)
    created.push(span)
  }
  return created
}

/** Highlight fill: the palette color at ~35%, matching the PDF/EPUB marks. */
function withAlpha(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}59` : color
}

/** Remove every mark span, leaving the document text exactly as rendered. */
export function clearMarks(container: HTMLElement): void {
  for (const span of [...container.querySelectorAll<HTMLElement>('.docx-mark')]) {
    const parent = span.parentNode
    if (!parent) continue
    while (span.firstChild) parent.insertBefore(span.firstChild, span)
    parent.removeChild(span)
  }
  container.normalize()
}

/** Every span belonging to one annotation (a mark spanning blocks has several). */
export function markSpans(container: HTMLElement, id: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.docx-mark')].filter(
    (el) => el.dataset.anno === id,
  )
}
