/**
 * Highlight-follow for the reading views: as read-aloud speaks each sentence,
 * find that sentence in the given root element and highlight it with the CSS
 * Custom Highlight API (no DOM mutation), scrolling it into view. Best-effort —
 * if the sentence can't be located (or the browser lacks the API) it silently
 * does nothing. Only works for same-document viewers (txt / markdown), not the
 * EPUB iframe or the PDF canvas.
 */
import { watch, onBeforeUnmount, type Ref } from 'vue'
import { useTtsStore } from '@/stores/tts'

const NAME = 'tts-sentence'

// The CSS Highlight API isn't in every lib.dom yet — reach it defensively.
const registry = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)
  ?.highlights
const HighlightCtor = (globalThis as unknown as { Highlight?: new (r: Range) => unknown }).Highlight
const supported = !!registry && !!HighlightCtor

/** Locate `needle` within `root`, tolerant of whitespace differences (the spoken
 *  text collapses runs of spaces/newlines), and return a DOM Range spanning it —
 *  possibly across element boundaries. Null when not found. */
function findTextRange(root: Node, needle: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const map: { node: Text; offset: number }[] = []
  let full = ''
  let node: Node | null
  while ((node = walker.nextNode())) {
    const t = node as Text
    const s = t.data
    for (let i = 0; i < s.length; i++) map.push({ node: t, offset: i })
    full += s
  }
  const trimmed = needle.trim()
  if (!trimmed) return null
  // Whitespace-flexible match: any run of whitespace in the needle matches any
  // run in the DOM text (which may wrap/indent differently).
  const pattern = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const m = new RegExp(pattern).exec(full)
  if (!m) return null
  const start = map[m.index]
  const end = map[m.index + m[0].length - 1]
  if (!start || !end) return null
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset + 1)
  return range
}

export function useTtsHighlight(root: Ref<HTMLElement | null>): void {
  const tts = useTtsStore()

  function clear(): void {
    registry?.delete(NAME)
  }

  function apply(chunk: string): void {
    if (!supported) return
    clear()
    const el = root.value
    if (!el || !chunk) return
    const range = findTextRange(el, chunk)
    if (!range || !HighlightCtor) return
    registry!.set(NAME, new HighlightCtor(range))
    // Keep the spoken sentence on screen.
    const target = range.startContainer.parentElement
    const rect = target?.getBoundingClientRect()
    if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) {
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  watch(
    () => tts.chunkText,
    (c) => apply(c || ''),
  )
  onBeforeUnmount(clear)
}
