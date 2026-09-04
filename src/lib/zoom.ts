/**
 * The arithmetic behind zooming a picture, kept out of the component so it can
 * be reasoned about and tested.
 *
 * The case that forced this: a full-page screenshot is a few thousand pixels
 * tall, so fitting it to the pane makes every word in it unreadable. Fit is the
 * right way to ARRIVE at an image and the wrong way to read one.
 */

/** The ladder a click steps along — the values a person recognises, not a
 *  constant multiplier that lands on 137%. */
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;

export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

/** The next rung up or down from wherever the scale happens to be — including
 *  a fit scale, which is almost never on the ladder. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  const EPS = 1e-4
  if (direction > 0) {
    return clampZoom(ZOOM_STEPS.find((s) => s > scale + EPS) ?? MAX_ZOOM)
  }
  const below = [...ZOOM_STEPS].reverse().find((s) => s < scale - EPS)
  return clampZoom(below ?? MIN_ZOOM)
}

/** A fit may go below the manual floor — see fitZoom. */
const FIT_FLOOR = 0.01

/**
 * The scale that shows the whole picture.
 *
 * Never above 1: blowing a small image up to fill the pane is not "fitting" it,
 * it is inventing pixels, and a 200×200 icon shown at 400% is a worse answer
 * than a small icon.
 *
 * Not clamped to MIN_ZOOM either. A full-page screenshot can be twelve thousand
 * pixels tall, whose fit is around 6% — below the floor that exists to stop a
 * PERSON zooming into nothing. Fit is not a zoom level someone chose, it is the
 * answer to "show me all of it", and clamping it would crop the picture.
 */
export function fitZoom(
  natural: { w: number; h: number },
  pane: { w: number; h: number },
): number {
  if (natural.w <= 0 || natural.h <= 0 || pane.w <= 0 || pane.h <= 0) return 1
  return Math.max(FIT_FLOOR, Math.min(1, pane.w / natural.w, pane.h / natural.h))
}

/**
 * Where to scroll so the point under the cursor stays under the cursor.
 *
 * Without this, zooming walks the picture out from under the pointer and the
 * user chases it with the scrollbars — which is most of why zoom in a viewer
 * feels bad or fine.
 *
 * `pointer` is measured from the top-left of the SCROLLING BOX, not the page.
 */
export function anchoredScroll(
  from: number,
  to: number,
  scroll: { left: number; top: number },
  pointer: { x: number; y: number },
): { left: number; top: number } {
  const k = to / from
  return {
    left: Math.max(0, (scroll.left + pointer.x) * k - pointer.x),
    top: Math.max(0, (scroll.top + pointer.y) * k - pointer.y),
  }
}

/** A wheel notch → a scale, continuous rather than laddered: a trackpad pinch
 *  sends many small deltas, and snapping each one to the ladder is a staircase
 *  where the gesture asked for a slope. */
export function wheelZoom(scale: number, deltaY: number): number {
  return clampZoom(scale * Math.exp(-deltaY / 320))
}

/** What the toolbar prints. Rounded to whole percent — "104.7%" is noise. */
export function zoomLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`
}
