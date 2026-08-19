/**
 * Ownership of EmbedPDF's keyboard shortcuts.
 *
 * The viewer's commands plugin listens for keys on `document` and, for any
 * combo in its shortcut table (⌘C, ⌘F, ⌘P, zoom keys, bare ArrowLeft, …),
 * calls preventDefault + stopPropagation — whether or not the PDF is the file
 * on screen, and whether or not the user's selection has anything to do with
 * it. PDFs stay mounted per open tab (v-show), so one background PDF tab
 * silently ate ⌘C everywhere: the key never reached the browser, `copy` never
 * fired, and selections in the chat and the preview could not be copied —
 * while other pages, incognito, and a probe that happened to call
 * execCommand('copy') all worked, which is what made it look like anything
 * but the PDF. The epub's ArrowLeft page-turn was being stolen the same way.
 *
 * The plugin cannot be scoped from outside, but its table can be taken over:
 * on viewer ready, every shortcut is stripped from the commands registry (the
 * commands themselves stay — toolbar buttons keep working) and the combos are
 * re-dispatched here under rules the app can stand behind:
 *
 *   - a HIDDEN pdf hears nothing — every key keeps its native/app meaning;
 *   - a VISIBLE pdf yields to a selection living outside it — ⌘C over chat
 *     text copies the chat text, even with the PDF on screen beside it;
 *   - otherwise the pdf handles the key exactly as the library would have —
 *     including its pdfium-quality copy of PDF text, which is why the table
 *     is re-dispatched rather than simply deleted: native copy of a pdf.js
 *     text layer garbles line breaks, the command does not.
 *
 * Editable targets are exempt (the library exempted them too): keys typed
 * into an input belong to the input.
 */

/** The slice of EmbedPDF's commands capability this module needs. */
export interface ShortcutCommandsApi {
  getAllShortcuts(): Map<string, string>
  getCommandByShortcut(shortcut: string): { id: string } | null | undefined
  unregisterCommand(commandId: string): void
  registerCommand(command: { id: string }): void
}

/**
 * Strip every keyboard shortcut out of a viewer's commands registry and hand
 * back the table (normalized combo → command id) for scoped re-dispatch.
 * Commands are re-registered without their shortcuts, so everything else about
 * them — toolbar buttons, menus, execute() — is untouched.
 */
export function takeoverPdfShortcuts(commands: ShortcutCommandsApi): Map<string, string> {
  const table = new Map(commands.getAllShortcuts())
  const done = new Set<string>()
  for (const [combo, id] of table) {
    if (done.has(id)) continue
    done.add(id)
    const def = commands.getCommandByShortcut(combo)
    // Defensive: a table/registry mismatch means this entry is not ours to
    // rewrite — leave the command alone rather than guess.
    if (!def || def.id !== id) continue
    commands.unregisterCommand(id)
    commands.registerCommand({ ...def, shortcuts: undefined } as { id: string })
  }
  return table
}

/** The key facts of a keydown, decoupled from the DOM for testing. */
export interface KeyLike {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/**
 * A keydown normalized the way EmbedPDF normalizes its registrations —
 * modifiers and key lowercased and sorted together ("Meta+C" → "c+meta") —
 * so lookups against the taken-over table match exactly. A bare modifier
 * press is null.
 */
export function comboOf(e: KeyLike): string | null {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  if (e.metaKey) parts.push('meta')
  let key = e.key.toLowerCase()
  if (key === ' ') key = 'space'
  if (['control', 'shift', 'alt', 'meta'].includes(key)) return null
  return [...parts, key].sort().join('+')
}

/**
 * The ownership rule, pure: which command (if any) the visible pdf gets to
 * run for this key. Null means the key is not ours — let the browser and the
 * rest of the app see it untouched.
 */
export function pdfKeyDecision(args: {
  /** comboOf(event) — null for a bare modifier. */
  combo: string | null
  /** Focus is in an input/textarea/contenteditable. */
  editable: boolean
  /** The VISIBLE pdf's shortcut table, or null when no pdf is on screen. */
  table: ReadonlyMap<string, string> | null
  /** A non-collapsed selection exists outside the visible pdf. */
  selectionOutside: boolean
}): string | null {
  if (!args.combo || args.editable || !args.table) return null
  const id = args.table.get(args.combo)
  if (!id) return null
  return args.selectionOutside ? null : id
}

/* ── DOM wiring ──────────────────────────────────────────────────────────── */

export interface PdfKeyScope {
  /** The pdf pane's root element (null while unmounted). */
  host(): HTMLElement | null
  /** combo → command id, from takeoverPdfShortcuts. */
  shortcuts: ReadonlyMap<string, string>
  /** Run one of the pdf's commands, as the keyboard would have. */
  execute(commandId: string): void
}

const scopes = new Set<PdfKeyScope>()

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function visible(el: HTMLElement | null): el is HTMLElement {
  // v-show hides via display:none; offsetParent is null under one. (The pane
  // is position:absolute inside a positioned layout, so offsetParent is
  // reliable here; checkVisibility is the modern spelling where present.)
  if (!el) return false
  const check = (el as { checkVisibility?: () => boolean }).checkVisibility
  return check ? check.call(el) : el.offsetParent !== null
}

function selectionOutside(host: HTMLElement): boolean {
  const sel = document.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
  const anc = sel.getRangeAt(0).commonAncestorContainer
  const el = anc instanceof Element ? anc : anc.parentElement
  return !!el && !host.contains(el)
}

function onKeydown(e: KeyboardEvent): void {
  let scope: PdfKeyScope | undefined
  for (const s of scopes) if (visible(s.host())) scope = s
  const id = pdfKeyDecision({
    combo: comboOf(e),
    editable: isEditable(e.target),
    table: scope ? scope.shortcuts : null,
    selectionOutside: scope ? selectionOutside(scope.host()!) : false,
  })
  if (!id) return
  // The same contract the library's own handler had — claim the key fully.
  e.preventDefault()
  e.stopPropagation()
  scope!.execute(id)
}

/** Register a mounted pdf's scope. The shared document listener exists only
 *  while at least one scope does. Returns the disposer. */
export function registerPdfKeyScope(scope: PdfKeyScope): () => void {
  if (scopes.size === 0) document.addEventListener('keydown', onKeydown)
  scopes.add(scope)
  return () => {
    scopes.delete(scope)
    if (scopes.size === 0) document.removeEventListener('keydown', onKeydown)
  }
}
