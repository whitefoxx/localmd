import { nextTick, ref, watch, type Ref } from 'vue'

/** Where a mark bar was opened: `x` is the horizontal centre of the selection
 *  or mark, `y` its bottom edge. Both in viewport coordinates. */
export interface MarkPopupAnchor {
  x: number
  y: number
}

/** Distance below the anchor, and the minimum inset from an edge. */
const GAP = 8

/**
 * Place the floating mark bar (highlight swatches + actions) for a viewer.
 *
 * The bar is centred on the anchor, then pulled back inside `bounds` — the
 * viewer's own box — so a selection near an edge can't push it out over the
 * page or off screen. Its width is not knowable up front (swatch count, font
 * metrics, whether the trash button is showing all move it), so the real
 * element is measured every time the anchor changes. The measurement happens
 * in the same task as the render, so the browser only ever paints the final
 * position.
 */
export function useMarkPopupPosition(
  anchor: Ref<MarkPopupAnchor | null>,
  bounds: Ref<HTMLElement | null | undefined>,
): {
  el: Ref<HTMLElement | null>
  style: Ref<{ left: string; top: string }>
} {
  const el = ref<HTMLElement | null>(null)
  const style = ref({ left: '0px', top: '0px' })

  watch(anchor, async (a) => {
    if (!a) return
    await nextTick()
    const width = el.value?.offsetWidth ?? 0
    const box = bounds.value?.getBoundingClientRect()
    const min = (box?.left ?? 0) + GAP
    const max = (box?.right ?? window.innerWidth) - width - GAP
    style.value = {
      left: `${Math.round(Math.max(min, Math.min(a.x - width / 2, max)))}px`,
      top: `${Math.round(a.y + GAP)}px`,
    }
  })

  return { el, style }
}
