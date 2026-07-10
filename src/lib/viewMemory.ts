/**
 * Per-path reading-position memory, shared across viewer component instances
 * so positions survive tab switches (components unmount when the active tab
 * changes file kind). Module-level by design; entries are tiny and unbounded
 * growth is bounded by the number of files a user opens in a session.
 */
export const editorScroll = new Map<string, number>()
export const previewScroll = new Map<string, number>()
export const pdfScroll = new Map<string, number>()
export const epubLocation = new Map<string, string>()
