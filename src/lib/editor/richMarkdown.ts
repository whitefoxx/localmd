/**
 * Live rendering in the editor: the markdown syntax gets out of the way.
 *
 * `**bold**` shows as bold with the stars hidden, headings take their size,
 * task boxes become checkboxes you can click, images and formulas render in
 * place — but the moment the cursor lands on a line, that line snaps back to
 * plain text so you can edit exactly what is in the file. Nothing is ever
 * hidden from the cursor.
 *
 * Line granularity for the reveal is deliberate. Per-node reveal (only the
 * emphasis you are inside) reads better in screenshots and is maddening in
 * use: the text reflows under your cursor as you cross each mark.
 *
 * This is a port of HyperMD's hide-token/fold behaviour, which is CodeMirror 5
 * only — none of that code could be reused, but the interaction is the same.
 */
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
} from '@codemirror/view'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import katex from 'katex'
import { findInlineMath, findBlockMath, type MathSpan, type Protected } from './mathScan'

export interface RichMarkdownOptions {
  /** Resolve an image href to a knowledge-base path, or null. */
  resolvePath: (href: string) => string | null
  /** Read a KB file's bytes for display. */
  readImage: (path: string) => Promise<string>
  /** Follow a link (⌘-click). */
  openLink: (href: string) => void
}

/* ── widgets ─────────────────────────────────────────────────────────────── */

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-md-bullet'
    el.textContent = '•'
    return el
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
  ) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-md-task'
    box.checked = this.checked
    box.addEventListener('mousedown', (e) => {
      e.preventDefault() // keep focus, and don't move the cursor onto this line
      // Re-read rather than trusting the stored offset: a widget can outlive
      // the text it was built from by one animation frame.
      const at = this.from + 1
      if (view.state.doc.sliceString(this.from, this.from + 1) !== '[') return
      view.dispatch({
        changes: { from: at, to: at + 1, insert: this.checked ? ' ' : 'x' },
      })
    })
    return box
  }
  ignoreEvent(): boolean {
    return false
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly href: string,
    readonly alt: string,
    readonly opts: RichMarkdownOptions,
  ) {
    super()
  }
  eq(other: ImageWidget): boolean {
    return other.href === this.href && other.alt === this.alt
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-image'
    const img = document.createElement('img')
    img.alt = this.alt
    wrap.appendChild(img)
    if (/^(https?:|data:|blob:|\/\/)/i.test(this.href)) {
      img.src = this.href
      return wrap
    }
    const path = this.opts.resolvePath(this.href)
    if (!path) {
      wrap.classList.add('cm-md-image-missing')
      wrap.textContent = this.alt || this.href
      return wrap
    }
    void this.opts
      .readImage(path)
      .then((url) => {
        img.src = url
      })
      .catch(() => {
        wrap.classList.add('cm-md-image-missing')
        wrap.textContent = this.alt || this.href
      })
    return wrap
  }
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super()
  }
  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = this.display ? 'cm-md-math cm-md-math-display' : 'cm-md-math'
    try {
      katex.render(this.tex.trim(), el, { displayMode: this.display, throwOnError: false })
    } catch {
      el.textContent = this.tex
    }
    return el
  }
}

/* ── decoration building ─────────────────────────────────────────────────── */

const hidden = Decoration.replace({})
const bullet = Decoration.replace({ widget: new BulletWidget() })
const linkMark = Decoration.mark({ class: 'cm-md-link' })
const codeMark = Decoration.mark({ class: 'cm-md-code' })
const headingLine = (level: number) => Decoration.line({ class: `cm-md-h${level}` })
const quoteLine = Decoration.line({ class: 'cm-md-quote' })

/**
 * Where a file's YAML frontmatter ends, or 0 when it has none. Same rule as
 * `splitFrontmatter` in lib/wiki, so the editor and the rest of the app agree
 * on what frontmatter is: line one is exactly `---`, and the block ends at the
 * first later line that is exactly `---`.
 *
 * Markdown's parser does not know about frontmatter, and reads that shape as a
 * thematic break, a paragraph, and a setext underline — which makes the CLOSING
 * `---` a HeaderMark, hidden like any other markup. It reappeared only when the
 * cursor landed on its line, so a skill file looked like it had lost its
 * delimiter: the one thing about frontmatter that must never look broken.
 * Nothing inside the block is markdown, so nothing inside it is decorated.
 */
function frontmatterEnd(state: EditorState): number {
  const doc = state.doc
  if (doc.line(1).text !== '---') return 0
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (line.text === '---') return line.to
  }
  return 0 // unterminated: not frontmatter, just a document opening with a rule
}

/** Line numbers the selection touches — these render as plain markdown. */
function revealedLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

/**
 * `$$` fences in a document, memoised on the Text object. Both the state field
 * and the view plugin need them on every update and a Text is immutable, so
 * this is scanned once per document version instead of twice per keystroke.
 */
const blockCache = new WeakMap<object, ReturnType<typeof findBlockMath>>()

function blocksIn(state: EditorState): ReturnType<typeof findBlockMath> {
  const cached = blockCache.get(state.doc)
  if (cached) return cached
  const found = findBlockMath(state.doc.toString().split('\n'))
  blockCache.set(state.doc, found)
  return found
}

/**
 * Multi-line `$$ … $$` display math, as a state field rather than part of the
 * view plugin below. CodeMirror refuses block decorations — and any decoration
 * that swallows a line break — from plugins, because a plugin only sees the
 * viewport and those change the document's block structure. A field sees the
 * whole document, which is what a fence spanning several lines needs anyway.
 */
function blockMathDecorations(state: EditorState): DecorationSet {
  const reveal = revealedLines(state)
  const fmEnd = frontmatterEnd(state)
  const marks: Range<Decoration>[] = []
  for (const block of blocksIn(state)) {
    const fromLine = block.fromLine + 1 // findBlockMath is 0-based
    const toLine = block.toLine + 1
    if (fmEnd && state.doc.line(toLine).to <= fmEnd) continue
    let touched = false
    for (let n = fromLine; n <= toLine && !touched; n++) touched = reveal.has(n)
    if (touched) continue
    marks.push(
      Decoration.replace({ widget: new MathWidget(block.tex, true), block: true }).range(
        state.doc.line(fromLine).from,
        state.doc.line(toLine).to,
      ),
    )
  }
  return Decoration.set(marks, true)
}

const blockMathField = StateField.define<DecorationSet>({
  create: blockMathDecorations,
  update(value, tr) {
    return tr.docChanged || tr.selection ? blockMathDecorations(tr.state) : value
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** Line numbers inside a `$$ … $$` block — inline math must not also fire there. */
function blockMathLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const block of blocksIn(state)) {
    for (let n = block.fromLine + 1; n <= block.toLine + 1; n++) lines.add(n)
  }
  return lines
}

function buildDecorations(view: EditorView, opts: RichMarkdownOptions): DecorationSet {
  const marks: Range<Decoration>[] = []
  const reveal = revealedLines(view.state)
  const fmEnd = frontmatterEnd(view.state)
  const doc = view.state.doc
  const lineOf = (pos: number) => doc.lineAt(pos).number
  const shown = (pos: number) => reveal.has(lineOf(pos))
  const protectedRanges: Protected = []

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        // Frontmatter is YAML, not markdown (see frontmatterEnd). Skipping the
        // node skips its children too, which is the whole block.
        if (fmEnd && node.to <= fmEnd) return false
        const name = node.name

        // Headings keep their size even while being edited; only the #s hide.
        const heading = /^ATXHeading(\d)$/.exec(name)
        if (heading) {
          marks.push(headingLine(Number(heading[1])).range(doc.lineAt(node.from).from))
          return
        }
        if (name === 'HeaderMark') {
          if (shown(node.from)) return
          // The mark excludes the space after it; hiding only the #s would
          // leave the heading text indented by one column.
          let end = node.to
          while (end < doc.length && doc.sliceString(end, end + 1) === ' ') end++
          marks.push(hidden.range(node.from, end))
          return
        }

        if (name === 'Blockquote') {
          for (let n = lineOf(node.from); n <= lineOf(node.to); n++) {
            marks.push(quoteLine.range(doc.line(n).from))
          }
          return
        }
        if (name === 'QuoteMark') {
          if (shown(node.from)) return
          let end = node.to
          while (end < doc.length && doc.sliceString(end, end + 1) === ' ') end++
          marks.push(hidden.range(node.from, end))
          return
        }

        if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
          if (!shown(node.from)) marks.push(hidden.range(node.from, node.to))
          return
        }

        if (name === 'InlineCode') {
          protectedRanges.push({ from: node.from, to: node.to })
          marks.push(codeMark.range(node.from, node.to))
          return
        }
        if (name === 'CodeMark') {
          // Only inline code's backticks hide; a fence is structure worth seeing.
          const parent = node.node.parent?.name
          if (parent === 'InlineCode' && !shown(node.from)) {
            marks.push(hidden.range(node.from, node.to))
          }
          return
        }
        if (name === 'FencedCode' || name === 'CodeText') {
          protectedRanges.push({ from: node.from, to: node.to })
          return
        }

        if (name === 'ListMark') {
          const text = doc.sliceString(node.from, node.to)
          if (!shown(node.from) && /^[-*+]$/.test(text)) {
            marks.push(bullet.range(node.from, node.to))
          }
          return
        }
        if (name === 'TaskMarker') {
          // Always a checkbox — one you cannot click while the cursor happens
          // to be on its line would be worse than none.
          const checked = /[xX]/.test(doc.sliceString(node.from, node.to))
          marks.push(
            Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(
              node.from,
              node.to,
            ),
          )
          return
        }

        if (name === 'Image') {
          protectedRanges.push({ from: node.from, to: node.to })
          if (shown(node.from)) return
          const raw = doc.sliceString(node.from, node.to)
          const m = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(raw)
          if (!m) return
          marks.push(
            Decoration.replace({ widget: new ImageWidget(m[2], m[1], opts) }).range(
              node.from,
              node.to,
            ),
          )
          return
        }

        if (name === 'URL') {
          protectedRanges.push({ from: node.from, to: node.to })
          return
        }
        if (name === 'Link') {
          if (shown(node.from)) return
          // Hide everything but the label: `[label](url)` → label.
          const raw = doc.sliceString(node.from, node.to)
          const m = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(raw)
          if (!m) return
          const labelFrom = node.from + 1
          const labelTo = labelFrom + m[1].length
          marks.push(hidden.range(node.from, labelFrom))
          if (labelTo > labelFrom) marks.push(linkMark.range(labelFrom, labelTo))
          marks.push(hidden.range(labelTo, node.to))
        }
      },
    })
  }

  // Math is not in the syntax tree — scan the visible text for it. Display
  // blocks are drawn by blockMathField; here they only mask inline scanning.
  const firstVisible = doc.lineAt(view.visibleRanges[0]?.from ?? 0)
  const lastVisible = doc.lineAt(view.visibleRanges[view.visibleRanges.length - 1]?.to ?? 0)
  const inBlock = blockMathLines(view.state)

  const math: MathSpan[] = []
  for (let n = firstVisible.number; n <= lastVisible.number; n++) {
    if (reveal.has(n) || inBlock.has(n)) continue
    const line = doc.line(n)
    if (fmEnd && line.to <= fmEnd) continue
    math.push(...findInlineMath(line.text, line.from, protectedRanges))
  }

  // The markdown parser reads LaTeX as markdown: the underscores in
  // `$x_1 + y_1$` become emphasis marks, whose decorations sit *inside* the
  // formula's. CodeMirror throws on overlapping replacements, so a formula
  // swallows the decorations it contains — and steps aside entirely if one
  // merely straddles its edge, where neither can contain the other.
  const kept = math.filter(
    (s) => !marks.some((m) => m.from < s.to && m.to > s.from && !(m.from >= s.from && m.to <= s.to)),
  )
  const survivors = marks.filter(
    (m) => !kept.some((s) => m.from >= s.from && m.to <= s.to),
  )
  for (const span of kept) {
    survivors.push(
      Decoration.replace({ widget: new MathWidget(span.tex, span.display) }).range(
        span.from,
        span.to,
      ),
    )
  }

  return Decoration.set(survivors, true)
}

/* ── the extension ───────────────────────────────────────────────────────── */

export function richMarkdown(opts: RichMarkdownOptions): Extension {
  const plugin = ViewPlugin.fromClass(
    class implements PluginValue {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, opts)
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, opts)
        }
      }
    },
    { decorations: (v) => v.decorations },
  )

  // ⌘-click follows a link. A plain click has to keep placing the cursor —
  // this is an editor, and the link text is editable text.
  const clicks = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.metaKey || event.ctrlKey)) return false
      const target = event.target as HTMLElement
      if (!target.closest('.cm-md-link')) return false
      const pos = view.posAtDOM(target)
      const line = view.state.doc.lineAt(pos)
      // Find the link whose label contains the click.
      let href: string | null = null
      syntaxTree(view.state).iterate({
        from: line.from,
        to: line.to,
        enter(node) {
          if (node.name !== 'Link' || pos < node.from || pos > node.to) return
          const m = /\(([^)]*)\)$/.exec(view.state.doc.sliceString(node.from, node.to))
          if (m) href = m[1]
        },
      })
      if (!href) return false
      event.preventDefault()
      opts.openLink(href)
      return true
    },
  })

  return [blockMathField, plugin, clicks]
}
