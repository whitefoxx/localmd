/**
 * The quote, on the chip that cites it.
 *
 * A citation chip's tooltip said where a claim came from (`b11-64 ·
 * raw/books/….epub`) but not what it said — which is the question you hover to
 * ask. The passage is already in memory (the doc-index sections the search
 * reads), so this puts it in front of the provenance line.
 *
 * Two deliberate cheapnesses:
 *
 * - It writes the `title` attribute rather than drawing a card of our own. The
 *   browser already has a tooltip that positions itself, wraps text and gets
 *   out of the way, and this stays one fact in one place — the provenance line
 *   is extended, not duplicated beside it.
 * - It fills the title on the way past rather than at render time. Replies are
 *   memoized on their own text (see MessageRow's `rendered`), and reaching
 *   into the index there would re-render every reply in the panel each time
 *   the index refreshes. Nothing is read until a pointer asks.
 *
 * A chip whose document is not indexed (or not read yet) keeps the plain
 * provenance tooltip and is asked again on the next hover.
 */
import { useKbIndexStore } from '@/stores/kbIndex'

/** Delegated `mouseover` handler for a container of rendered markdown. */
export function useCiteQuote(): (e: MouseEvent) => void {
  const index = useKbIndexStore()
  return (e: MouseEvent): void => {
    const el = e.target as HTMLElement | null
    const a = el?.closest?.('a.citation') as HTMLAnchorElement | null
    if (!a || a.dataset.quoted || !a.dataset.block) return
    const quote = index.blockText(a.dataset.block, a.dataset.citePath ?? null)
    if (!quote) return
    a.dataset.quoted = '1'
    a.title = a.title ? `${quote}\n\n${a.title}` : quote
  }
}
