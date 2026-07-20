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

/** Locate `needle` within `root`, tolerant of whitespace differences, and return
 *  a Range spanning it — possibly across element boundaries. Null when not
 *  found. Needle whitespace matches ZERO or more DOM whitespace ("\s*"): the
 *  sentence chunker joins sentences with a space, but CJK prose has none after
 *  。！？ — requiring one ("\s+") made every CJK chunk miss. */
function findTextRange(doc: Document, root: Node, needle: string): Range | null {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const map: { node: Text; offset: number }[] = []
  let full = ''
  let node: Node | null
  while ((node = walker.nextNode())) {
    const t = node as Text
    for (let i = 0; i < t.data.length; i++) map.push({ node: t, offset: i })
    full += t.data
  }
  const trimmed = needle.trim()
  if (!trimmed) return null
  const pattern = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')
  const m = new RegExp(pattern).exec(full)
  if (!m) return null
  const start = map[m.index]
  const end = map[m.index + m[0].length - 1]
  if (!start || !end) return null
  const range = doc.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset + 1)
  return range
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
