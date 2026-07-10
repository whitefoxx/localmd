<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { useFilesStore } from '@/stores/files'
import { useThemeStore } from '@/stores/theme'

const files = useFilesStore()
const theme = useThemeStore()

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null
const themeCompartment = new Compartment()

function themeExt() {
  return theme.isDark ? oneDark : syntaxHighlighting(defaultHighlightStyle)
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
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        EditorView.lineWrapping,
        themeCompartment.of(themeExt()),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) files.onEdited(u.state.doc.toString())
        }),
      ],
    }),
  })
}

onMounted(createView)

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

// Replace the document when a different file is opened (or reloaded from disk).
watch(
  () => [files.currentPath, files.content] as const,
  ([, content]) => {
    if (!view) return
    if (view.state.doc.toString() === content) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
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
