/**
 * Whether a right-click belongs to the browser rather than to the app.
 *
 * The app suppresses the native menu over its own chrome: Back, Reload and View
 * page source are not commands for a toolbar, and drawing them over one made
 * the app read like a web page. But that menu is also the only place several
 * real gestures live, and taking it away where they matter removes them with
 * nothing offered in return.
 *
 * The decisive signal is a SELECTION. Right-clicking text you have selected is
 * how you copy it, look it up, or search for it — and that is true wherever the
 * text happens to be: the open file, the agent transcript, a tool result, a
 * panel we have not written yet. Keying on the region instead means every new
 * readable surface has to remember to opt in, and the first one already did
 * not: the reply you most want to quote was the one you could not copy.
 *
 * Two allowances survive on top of it, both for gestures that have no selection
 * to speak of: editable fields (paste, undo, spelling suggestions) and the
 * open-file region (so "Save image as…" still reaches a picture in a note).
 *
 * Pure and DOM-shaped rather than DOM-bound — it takes the element and the
 * selection, so the rule is unit-testable without a browser.
 */

/** Elements that keep the native menu with nothing selected. */
const ALWAYS = '[data-file-selection], input, textarea, [contenteditable="true"]'

/** The minimum of `Element` this rule needs. */
export interface MenuTarget {
  closest(selectors: string): unknown
  contains(other: unknown): boolean
}

/** The minimum of `Selection` this rule needs. */
export interface MenuSelection {
  isCollapsed: boolean
  rangeCount: number
  anchorNode: unknown
  containsNode(node: unknown, allowPartial: boolean): boolean
}

export function keepsNativeMenu(
  target: MenuTarget | null,
  selection: MenuSelection | null,
): boolean {
  if (selectionTouches(target, selection)) return true
  return !!target?.closest?.(ALWAYS)
}

/** Whether the element under the cursor is part of what is selected. Asked in
 *  both directions: the element can sit INSIDE the selection (a span within a
 *  selected paragraph) or CONTAIN it (the paragraph itself, which containsNode
 *  does not count as contained). A selection somewhere else on screen does not
 *  count — right-clicking the file tree is still the app's business. */
function selectionTouches(target: MenuTarget | null, selection: MenuSelection | null): boolean {
  if (!target || !selection || selection.isCollapsed || selection.rangeCount === 0) return false
  if (selection.containsNode(target, true)) return true
  const anchor = selection.anchorNode
  return !!anchor && target.contains(anchor)
}
