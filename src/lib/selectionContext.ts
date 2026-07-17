import { onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useFilesStore } from '@/stores/files'
import { useComposerStore } from '@/stores/composer'

/**
 * While the agent panel is open, mirror the text the user selects — in the open
 * file (editor/preview) or in a previous agent reply — as a transient context
 * chip in the composer. The chip follows the live selection and disappears when
 * the selection is cleared, unless the user pins it (see the composer store), so
 * casual reading-selections never pile up.
 *
 * Selectable regions are tagged in the DOM: `[data-file-selection]` on the open
 * file view, `[data-reply-selection]` on each assistant message. Selections
 * anywhere else (user messages, sidebar, the composer itself) are ignored.
 */
export function useFileSelectionCapture(): void {
  const ui = useUiStore()
  const files = useFilesStore()
  const composer = useComposerStore()

  let timer: ReturnType<typeof setTimeout> | undefined

  /** Where a selected node lives: its file path, `null` for an agent reply, or
   *  `undefined` when it is not a quotable region. */
  function sourceOf(node: Node | null): string | null | undefined {
    const el = node instanceof Element ? node : node?.parentElement
    if (el?.closest('[data-reply-selection]')) return null
    if (el?.closest('[data-file-selection]') && files.currentPath) return files.currentPath
    return undefined
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
    // source. `null` (an agent reply) is a real source, so don't let `??` skip it.
    let src: string | null | undefined
    if (text.trim() && sel) {
      const f = sourceOf(sel.focusNode)
      src = f !== undefined ? f : sourceOf(sel.anchorNode)
    }
    if (src === undefined) {
      if (!inComposer()) composer.clearTransient()
      return
    }
    const source = src
    timer = setTimeout(() => composer.syncLive(source, text), 200)
  }

  onMounted(() => document.addEventListener('selectionchange', onSelectionChange))
  onUnmounted(() => {
    document.removeEventListener('selectionchange', onSelectionChange)
    clearTimeout(timer)
  })
}
