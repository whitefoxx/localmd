/**
 * Pasting media into a note: write the file into the knowledge base and leave
 * a markdown image/link where the cursor was.
 *
 * Where it lands: the note's own folder. The capture routing used for drops
 * (`raw/images/`, `inbox/`) is right for *sources* — things you collected —
 * but a screenshot pasted mid-sentence is part of the note, and a reader who
 * moves the note should be able to take its pictures with it. A bare filename
 * as the link target keeps that true.
 *
 * Pasting a URL over a selection is not here: `markdown()` already ships
 * `pasteURLAsLink`, which does exactly that.
 */
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { importFileInto } from '@/lib/capture'
import { dirName } from '@/lib/wiki'

/** Media we know how to embed. Anything else is left to the browser. */
function isEmbeddable(file: File): boolean {
  return /^(image|video|audio)\//.test(file.type)
}

/** The markdown for an embedded file — only images get the `!`. */
function embedFor(name: string, type: string): string {
  const link = `[${type.startsWith('image/') ? '' : name}](${encodeURI(name)})`
  return type.startsWith('image/') ? `!${link}` : link
}

/**
 * Handle a paste carrying files. `currentPath` is the note being edited;
 * returns false (letting the browser paste normally) when there is no KB open,
 * no note, or nothing embeddable on the clipboard.
 */
export function mediaPaste(getPath: () => string | null): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = Array.from(event.clipboardData?.files ?? []).filter(isEmbeddable)
      if (!files.length) return false
      const path = getPath()
      if (!path) return false
      event.preventDefault()

      // The write is async but the paste is not — insert once it lands, at the
      // selection as it is then, so a user who kept typing is not overwritten.
      void (async () => {
        const dir = dirName(path)
        for (const file of files) {
          try {
            const written = await importFileInto(file, dir)
            const name = written.slice(written.lastIndexOf('/') + 1)
            const insert = embedFor(name, file.type)
            view.dispatch(view.state.replaceSelection(insert))
          } catch (err) {
            console.error('paste: could not save media into the knowledge base', err)
          }
        }
      })()
      return true
    },
  })
}
