import { onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useFilesStore } from '@/stores/files'
import { useChatStore } from '@/stores/chat'
import { useComposerStore } from '@/stores/composer'
import type { QuoteOrigin } from '@/stores/composer'
import { pdfPage } from '@/lib/viewMemory'
import { fileKind } from '@/lib/filetypes'

/**
 * While the agent panel is open, mirror the text the user selects — in the open
 * file (editor/preview) or in a previous agent reply — as a transient context
 * chip in the composer. The chip follows the live selection and disappears when
 * the selection is cleared, unless the user pins it (see the composer store), so
 * casual reading-selections never pile up.
 *
 * Selectable regions are tagged in the DOM: `[data-file-selection]` on the open
 * file view, `[data-reply-selection]` on each assistant message (carrying its
 * `data-msg-id`). Selections anywhere else (user messages, sidebar, the composer
 * itself) are ignored.
 *
 * Provenance is read here, while the DOM still knows it: which reply, which
 * page, which section. It rides along on the chip (see QuoteOrigin) because by
 * send time the user may have scrolled away or switched files.
 */
/** A quotable region a selection landed in, plus the node that identified it. */
interface Source {
  /** KB path for a file selection, `null` for an agent reply. */
  file: string | null
  el: Element
  /** The `[data-file-selection]` region, for locating the passage within it. */
  region: Element | null
}

export function useFileSelectionCapture(): void {
  const ui = useUiStore()
  const files = useFilesStore()
  const chat = useChatStore()
  const composer = useComposerStore()

  let timer: ReturnType<typeof setTimeout> | undefined

  /** The section a passage sits under: the nearest heading before it in the
   *  rendered view, searching previous siblings on the way up to the file
   *  region. Absent for views without headings (PDF text layers, plain text).
   *  The sibling scan is capped — a long stretch with no heading above it just
   *  means the passage has no section, and this must stay cheap. */
  function headingAbove(el: Element, root: Element): string | undefined {
    let budget = 300
    for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
      for (let p = n.previousElementSibling; p && budget-- > 0; p = p.previousElementSibling) {
        const inner = p.matches('h1,h2,h3,h4,h5,h6') ? [p] : p.querySelectorAll('h1,h2,h3,h4,h5,h6')
        const text = inner[inner.length - 1]?.textContent?.replace(/\s+/g, ' ').trim()
        if (text) return text.slice(0, 80)
      }
    }
    return undefined
  }

  /** Where a selected node lives: a file path (`file`) or an agent reply
   *  (`file: null`). `undefined` when the node is not in a quotable region.
   *  `el`/`region` are handed back so the locator can be resolved later —
   *  selectionchange fires on every mouse move of a drag, so the DOM walk waits
   *  for the debounce. */
  function sourceOf(node: Node | null): Source | undefined {
    const el = node instanceof Element ? node : node?.parentElement
    if (!el) return undefined
    if (el.closest('[data-reply-selection]')) return { file: null, el, region: null }
    const region = el.closest('[data-file-selection]')
    if (region && files.currentPath) return { file: files.currentPath, el, region }
    return undefined
  }

  /** The provenance to stage with the quote, resolved once the selection has
   *  settled: which reply it came from, or which page/section of the file. */
  function originOf(src: Source): QuoteOrigin {
    if (src.file === null) {
      const reply = src.el.closest('[data-reply-selection]')
      const id = Number(reply?.getAttribute('data-msg-id'))
      return {
        sessionId: chat.currentSessionId ?? undefined,
        messageId: Number.isInteger(id) && id > 0 ? id : undefined,
      }
    }
    return {
      page: fileKind(src.file) === 'pdf' ? pdfPage.get(src.file) : undefined,
      heading: src.region ? headingAbove(src.el, src.region) : undefined,
    }
  }

  /** True when focus (or the collapsed selection) has moved into the composer —
   *  the input box, its action row, or a staged chip. Clicking there collapses
   *  the page selection but must NOT drop the staged quote: the user is about to
   *  type their question about it. Only a deselect that lands *outside* the
   *  composer clears transient chips. */
  function inComposer(): boolean {
    const inside = (n: Node | null | undefined): boolean => {
      const el = n instanceof Element ? n : n?.parentElement
      return !!el?.closest('[data-composer]')
    }
    if (inside(document.activeElement)) return true
    const sel = window.getSelection()
    return inside(sel?.anchorNode) || inside(sel?.focusNode)
  }

  function onSelectionChange(): void {
    if (!ui.agentOpen) return
    clearTimeout(timer)
    const sel = window.getSelection()
    const text = sel && !sel.isCollapsed && sel.rangeCount ? sel.toString() : ''
    // A selection can span from anchor to focus; either end identifies the
    // source. Prefer the anchor (where the drag started) for the locator, since
    // focus may have run past the end of the section.
    const src =
      text.trim() && sel ? (sourceOf(sel.anchorNode) ?? sourceOf(sel.focusNode)) : undefined
    if (!src) {
      if (!inComposer()) composer.clearTransient()
      return
    }
    timer = setTimeout(() => composer.syncLive(src.file, text, originOf(src)), 200)
  }

  onMounted(() => document.addEventListener('selectionchange', onSelectionChange))
  onUnmounted(() => {
    document.removeEventListener('selectionchange', onSelectionChange)
    clearTimeout(timer)
  })
}
