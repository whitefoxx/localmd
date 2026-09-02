/**
 * Answer the `localmd-query` blocks inside rendered markdown.
 *
 * `renderMarkdown` leaves each one as a placeholder carrying the query text —
 * it is synchronous and store-free by design — and this fills in the answer,
 * the same division of labour `useKbImages` uses for pictures. The rendering
 * itself is `lib/kbQueryView`, so what is here is DOM plumbing and nothing
 * that needs a test to be believed.
 */
import { onMounted, watch, type Ref } from 'vue'
import { useKbIndexStore } from '@/stores/kbIndex'
import { renderQueryBlock } from '@/lib/kbQueryView'

export function useKbQuery(root: Ref<HTMLElement | null>, deps: () => unknown): void {
  const kb = useKbIndexStore()

  function fill(): void {
    const el = root.value
    if (!el) return
    for (const node of el.querySelectorAll<HTMLElement>('div.kb-query[data-kb-query]')) {
      // The question survives in the dataset, so re-answering never has to
      // read back the table it wrote last time.
      node.innerHTML = renderQueryBlock(
        kb.queryPages,
        node.dataset.kbQuery ?? '',
        Date.now(),
        () => kb.healthFlags,
      )
    }
  }

  // Re-answers on a new render AND on a new index: a block is a view of the KB
  // as it is now, so a page renamed in another pane shows up here without the
  // note being touched. `flush: 'post'` so the v-html has landed.
  watch([deps, () => kb.queryPages], fill, { flush: 'post' })
  onMounted(fill)
}
