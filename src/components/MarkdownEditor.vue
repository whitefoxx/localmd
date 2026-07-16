<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, defaultHighlightStyle, LanguageDescription } from '@codemirror/language'
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
import { useFilesStore } from '@/stores/files'
import { useThemeStore } from '@/stores/theme'
import { editorScroll } from '@/lib/viewMemory'

const files = useFilesStore()
const theme = useThemeStore()

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null
const themeCompartment = new Compartment()
const languageCompartment = new Compartment()

function themeExt() {
  return theme.isDark ? oneDark : syntaxHighlighting(defaultHighlightStyle)
}

/** Softer line-number gutter — muted, borderless and transparent so it recedes
 *  behind the text. Added after the theme compartment so it overrides oneDark. */
const gutterTheme = EditorView.theme({
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'rgb(var(--c-fg-3) / 0.45)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    color: 'rgb(var(--c-fg-3) / 0.45)',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'rgb(var(--c-fg-2))',
  },
})

/** Language for a file: markdown (with wikilink support) for .md, otherwise the
 *  CodeMirror language matching the filename, or plain text. Keeps the markdown
 *  highlighter from italicising/underlining JSON, YAML and other text files. */
async function langExtFor(path: string | null): Promise<Extension> {
  if (!path) return []
  if (/\.md$/i.test(path)) return markdown({ base: markdownLanguage, codeLanguages: languages })
  const name = path.slice(path.lastIndexOf('/') + 1)
  const desc = LanguageDescription.matchFilename(languages, name)
  if (!desc) return []
  try {
    return await desc.load()
  } catch {
    return []
  }
}

/** Reconfigure the language compartment for `path`. Guarded against races so a
 *  slow async load for a since-closed file can't clobber the current one. */
let langToken = 0
async function applyLanguage(path: string | null): Promise<void> {
  const token = ++langToken
  const ext = await langExtFor(path)
  if (token !== langToken || !view) return
  view.dispatch({ effects: languageCompartment.reconfigure(ext) })
}

/** [[ triggers wikilink completion over the KB's markdown files: stems for
 *  wiki-style targets, full paths as secondary matches. Inserts the closing
 *  ]] unless auto-close already put one after the cursor. */
function wikilinkCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/\[\[([^\][\n]*)$/)
  if (!before) return null
  const from = before.from + 2 // after the [[
  const closed = context.state.sliceDoc(context.pos, context.pos + 2) === ']]'
  const seen = new Set<string>()
  const options = files.mdFiles.flatMap((path) => {
    const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
    const target = path.replace(/\.md$/i, '')
    const out = []
    if (!seen.has(stem)) {
      seen.add(stem)
      out.push({ label: stem, detail: path, apply: closed ? stem : `${stem}]]` })
    }
    if (target !== stem && !seen.has(target)) {
      seen.add(target)
      out.push({ label: target, apply: closed ? target : `${target}]]`, boost: -1 })
    }
    return out
  })
  return { from, options, validFor: /^[^\][\n]*$/ }
}

function createView(): void {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: files.content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        languageCompartment.of([]),
        autocompletion({ override: [wikilinkCompletions], icons: false }),
        EditorView.lineWrapping,
        themeCompartment.of(themeExt()),
        gutterTheme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) files.onEdited(u.state.doc.toString())
        }),
      ],
    }),
  })
}

/** Scroll to and select the first occurrence of `target` (a broken link's raw
 *  text). Used by the health panel to jump straight to the offending link. */
function revealTarget(target: string): void {
  if (!view) return
  const idx = view.state.doc.toString().indexOf(target)
  if (idx < 0) return
  view.dispatch({
    selection: { anchor: idx, head: idx + target.length },
    effects: EditorView.scrollIntoView(idx, { y: 'center' }),
  })
  view.focus()
}

onMounted(() => {
  createView()
  void applyLanguage(files.currentPath)
  shownPath = files.currentPath
  const rev = files.reveal
  if (rev && rev.path === files.currentPath) {
    requestAnimationFrame(() => revealTarget(rev.target))
  } else {
    const saved = shownPath ? (editorScroll.get(shownPath) ?? 0) : 0
    requestAnimationFrame(() => {
      if (view) view.scrollDOM.scrollTop = saved
    })
  }
})

// A reveal request for the already-mounted editor (file already current, or a
// fresh file whose content-replace restores scroll — this rAF runs after it).
watch(
  () => files.reveal?.nonce,
  () => {
    const rev = files.reveal
    if (!rev || rev.path !== files.currentPath || !view) return
    requestAnimationFrame(() => revealTarget(rev.target))
  },
)

onBeforeUnmount(() => {
  if (shownPath && view) editorScroll.set(shownPath, view.scrollDOM.scrollTop)
  view?.destroy()
  view = null
})

let shownPath: string | null = null

// Replace the document when a different file is opened (or reloaded from disk).
watch(
  () => [files.currentPath, files.content] as const,
  ([path, content]) => {
    if (!view) return
    if (path !== shownPath) void applyLanguage(path)
    if (view.state.doc.toString() === content) {
      shownPath = path
      return
    }
    if (shownPath) editorScroll.set(shownPath, view.scrollDOM.scrollTop)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
    const saved = path ? (editorScroll.get(path) ?? 0) : 0
    requestAnimationFrame(() => {
      if (view) view.scrollDOM.scrollTop = saved
    })
    shownPath = path
  },
)

watch(
  () => theme.isDark,
  () => view?.dispatch({ effects: themeCompartment.reconfigure(themeExt()) }),
)
</script>

<template>
  <div ref="host" class="h-full panel-scroll selectable" />
</template>
