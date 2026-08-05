/**
 * Markdown editing keys, wired to the pure commands in this directory.
 *
 * These are editor-scoped and deliberately not part of the app's rebindable
 * HOTKEYS registry: that one exists for global commands that must work from
 * anywhere, and every entry there costs a key that the editor can then never
 * use. See `Mod-b` — the app binds it to the sidebar, and the sidebar yields
 * inside a text editor because bold is what ⌘B means there.
 *
 * Key choices avoid what Chrome takes for itself: ⌘T (new tab), ⌘⌥I/J/C/U
 * (developer tools), ⌘K (this app's search). The editor we ported this
 * capability from is a PWA, which is why it could afford ⌘T for tables.
 */
import { EditorView, keymap } from '@codemirror/view'
import { Prec, type Extension, type EditorState, type TransactionSpec } from '@codemirror/state'
import { toggleMark, insertLink, type MarkKind } from './marks'
import { toggleTaskItem, toggleTaskDone, setHeading, completeFence } from './blocks'
import {
  insertTable,
  moveCell,
  nextRow,
  formatTable,
  editTableStructure,
  type TableStructureOp,
} from './tables'

/** Adapt a pure command; a null spec means "not handled", so the key falls through. */
function cmd(fn: (state: EditorState) => TransactionSpec | null) {
  return (view: EditorView): boolean => {
    const spec = fn(view.state)
    if (!spec) return false
    view.dispatch(spec)
    return true
  }
}

const mark = (kind: MarkKind) => cmd((state) => toggleMark(state, kind))
const heading = (level: number) => cmd((state) => setHeading(state, level))
const structure = (op: TableStructureOp) => cmd((state) => editTableStructure(state, op))

/** Typing the third backtick of a fence writes the closing one too. */
const fenceInput = EditorView.inputHandler.of((view, from, to, text) => {
  const spec = completeFence(view.state, from, to, text)
  if (!spec) return false
  view.dispatch(spec)
  return true
})

/**
 * Precedence: highest, because Enter and Tab already have bindings we need to
 * pre-empt inside a table — `markdown()` installs its list-continuation Enter
 * at Prec.high, and `indentWithTab` owns Tab. Both commands return false
 * outside a table, so those bindings still get their turn everywhere else.
 */
export const markdownEditingKeymap: Extension = Prec.highest(
  keymap.of([
    { key: 'Mod-b', run: mark('bold') },
    { key: 'Mod-i', run: mark('italic') },
    { key: 'Mod-e', run: mark('code') },
    { key: 'Mod-Alt-x', run: mark('strike') },
    { key: 'Mod-Alt-k', run: cmd(insertLink) },

    { key: 'Mod-Enter', run: cmd(toggleTaskDone) },
    { key: 'Mod-Alt-Enter', run: cmd(toggleTaskItem) },

    { key: 'Mod-Alt-0', run: heading(0) },
    { key: 'Mod-Alt-1', run: heading(1) },
    { key: 'Mod-Alt-2', run: heading(2) },
    { key: 'Mod-Alt-3', run: heading(3) },
    { key: 'Mod-Alt-4', run: heading(4) },
    { key: 'Mod-Alt-5', run: heading(5) },
    { key: 'Mod-Alt-6', run: heading(6) },

    { key: 'Mod-Alt-t', run: cmd(insertTable) },
    { key: 'Mod-Alt-f', run: cmd(formatTable) },
    // ⌘⌥ + arrow grows the table right/down, shrinks it left/up.
    { key: 'Mod-Alt-ArrowRight', run: structure('col-after') },
    { key: 'Mod-Alt-ArrowLeft', run: structure('col-delete') },
    { key: 'Mod-Alt-ArrowDown', run: structure('row-after') },
    { key: 'Mod-Alt-ArrowUp', run: structure('row-delete') },
    { key: 'Tab', run: cmd((s) => moveCell(s, 1)) },
    { key: 'Shift-Tab', run: cmd((s) => moveCell(s, -1)) },
    { key: 'Enter', run: cmd(nextRow) },
  ]),
)

/** Everything markdown editing adds on top of the markdown language. */
export const markdownEditing: Extension = [markdownEditingKeymap, fenceInput]
