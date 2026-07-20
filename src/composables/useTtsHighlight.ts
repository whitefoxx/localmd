/**
 * Highlight-follow for read-aloud: as each sentence is spoken, find it in the
 * DOM and highlight it with the CSS Custom Highlight API (no DOM mutation),
 * scrolling it into view. Best-effort — silently no-ops if the sentence can't be
 * located or the browser lacks the API.
 *
 * The core operates on an arbitrary Document so it works both in the top page
 * (txt / markdown reading views, via useTtsHighlight) and inside the EPUB
 * chapter iframe (the EPUB viewer calls highlightSentence directly with the
 * iframe's document). PDF is a canvas — no DOM text — so it's not covered.
 */
import { watch, onBeforeUnmount, type Ref } from 'vue'
import { useTtsStore } from '@/stores/tts'

export const TTS_HIGHLIGHT_NAME = 'tts-sentence'

// The CSS Highlight API isn't in every lib.dom yet — reach it defensively, per
// document (an iframe has its own window / registry / constructor).
type HighlightRegistry = Map<string, unknown>
function registryFor(doc: Document): HighlightRegistry | undefined {
  return (doc.defaultView?.CSS as unknown as { highlights?: HighlightRegistry } | undefined)
    ?.highlights
}
function ctorFor(doc: Document): (new (r: Range) => unknown) | undefined {
  return (doc.defaultView as unknown as { Highlight?: new (r: Range) => unknown } | null)?.Highlight
}

/* Text index of a root element, cached per root: the concatenated text plus
   each text node's cumulative start offset. Built ONCE per document and reused
   for every sentence — the previous implementation rebuilt it (one object per
   CHARACTER) and re-scanned from the top on every spoken sentence, janking the
   main thread at exactly each utterance boundary. `lastEnd` makes consecutive
   sentences resume the search where the previous one ended (spoken text runs in
   document order), with a full-scan fallback for jumps and re-reads. */
interface TextIndex {
  full: string
  nodes: Text[]
  starts: number[]
  lastEnd: number
}
const indexCache = new WeakMap<Node, TextIndex>()

function buildIndex(doc: Document, root: Node): TextIndex {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  const starts: number[] = []
  let full = ''
  let n: Node | null
  while ((n = walker.nextNode())) {
    const t = n as Text
    nodes.push(t)
    starts.push(full.length)
    full += t.data
  }
  return { full, nodes, starts, lastEnd: 0 }
}

/** Map a character offset in `full` back to (text node, in-node offset). */
function locate(ix: TextIndex, offset: number): { node: Text; offset: number } | null {
  let lo = 0
  let hi = ix.starts.length - 1
  let k = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ix.starts[mid] <= offset) {
      k = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (k < 0) return null
  return { node: ix.nodes[k], offset: offset - ix.starts[k] }
}

/** Locate `needle` within `root`, tolerant of whitespace differences, and return
 *  a Range spanning it — possibly across element boundaries. Null when not
 *  found. Needle whitespace matches ZERO or more DOM whitespace ("\s*"): the
 *  sentence chunker joins sentences with a space, but CJK prose has none after
 *  。！？ — requiring one ("\s+") made every CJK chunk miss. A stale cache
 *  (document mutated) self-heals: on any miss the index is rebuilt once. */
function findTextRange(doc: Document, root: Node, needle: string): Range | null {
  const trimmed = needle.trim()
  if (!trimmed) return null
  const pattern = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')

  const attempt = (ix: TextIndex): Range | null => {
    const re = new RegExp(pattern, 'g')
    re.lastIndex = ix.lastEnd
    let m = re.exec(ix.full)
    if (!m && ix.lastEnd > 0) {
      re.lastIndex = 0
      m = re.exec(ix.full)
    }
    if (!m) return null
    const start = locate(ix, m.index)
    const end = locate(ix, m.index + m[0].length - 1)
    if (!start || !end || !start.node.isConnected || !end.node.isConnected) return null
    ix.lastEnd = m.index + m[0].length
    const range = doc.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset + 1)
    return range
  }

  const cached = indexCache.get(root)
  if (cached) {
    const r = attempt(cached)
    if (r) return r
  }
  const fresh = buildIndex(doc, root)
  indexCache.set(root, fresh)
  return attempt(fresh)
}

/** Highlight `chunk` within `root` of `doc`. Passing an empty chunk clears it.
 *  `scroll` brings the sentence into view — leave it OFF for paginated EPUB,
 *  whose iframe layout must not be scrolled from under epub.js. Returns the
 *  highlighted Range (callers use its geometry for follow-along), null if the
 *  sentence wasn't found or the API is unavailable. */
export function highlightSentence(
  doc: Document,
  root: Element | null,
  chunk: string,
  opts: { scroll?: boolean } = {},
): Range | null {
  const registry = registryFor(doc)
  const Ctor = ctorFor(doc)
  if (!registry || !Ctor) return null
  registry.delete(TTS_HIGHLIGHT_NAME)
  if (!root || !chunk) return null
  const range = findTextRange(doc, root, chunk)
  if (!range) return null
  registry.set(TTS_HIGHLIGHT_NAME, new Ctor(range))
  if (opts.scroll !== false) {
    const target = range.startContainer.parentElement
    const rect = target?.getBoundingClientRect()
    const viewH = doc.defaultView?.innerHeight ?? window.innerHeight
    if (rect && (rect.top < 0 || rect.bottom > viewH)) {
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }
  return range
}

export function clearHighlight(doc: Document): void {
  registryFor(doc)?.delete(TTS_HIGHLIGHT_NAME)
}

/** Top-page reading views (txt / markdown): follow the spoken sentence in `root`. */
export function useTtsHighlight(root: Ref<HTMLElement | null>): void {
  const tts = useTtsStore()
  watch(
    () => tts.chunkText,
    (c) => highlightSentence(document, root.value, c || ''),
  )
  onBeforeUnmount(() => clearHighlight(document))
}
