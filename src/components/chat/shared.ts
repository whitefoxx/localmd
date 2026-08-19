/**
 * The few things the transcript rows and the composer around them both need.
 *
 * Small by design: it exists so `MessageRow` can be its own component without
 * either duplicating these or reaching back into `ChatPanel` for them.
 */
import { ref } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useUiStore } from '@/stores/ui'

/**
 * Shared "now" for the in-flight timers in the transcript — a tool call still
 * running, a thought still streaming.
 *
 * Imported by the rows rather than passed down as a prop, and that is the whole
 * point: a prop is read by the LIST's render function, so one tick a second
 * would rebuild every row in the conversation. Read from here, only the rows
 * that actually display a live timer ever track it (`toolTime`/`thinkTime`
 * touch it solely for an unfinished part), and a settled transcript is not
 * re-rendered at all.
 */
export const now = ref(Date.now())

let timer: ReturnType<typeof setInterval> | undefined

/** Tick while a turn runs, stop when it ends — an idle transcript has no live
 *  timer to advance, and a clock nobody reads is still a wakeup a second. */
export function runClock(running: boolean): void {
  stopClock()
  if (!running) return
  now.value = Date.now()
  timer = setInterval(() => (now.value = Date.now()), 1000)
}

export function stopClock(): void {
  clearInterval(timer)
  timer = undefined
}

/** A path's last segment — what a chip shows when the full path is the tooltip. */
export function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}

/** One-line preview of a staged selection or attachment, for its chip. */
export function snippet(text: string): string {
  const first = text.split('\n', 1)[0].trim()
  return first.length > 60 ? `${first.slice(0, 60)}…` : first
}

/** Opening a file from inside the agent panel is pointless while the panel IS
 *  the window — restore it so the file is actually visible. No-op otherwise. */
export function revealEditor(): void {
  const ui = useUiStore()
  if (ui.agentMaximized) ui.agentMaximized = false
}

/** Open an attachment where every other file opens — the middle pane — rather
 *  than in a lightbox of its own. A pasted screenshot is a file in the KB, and
 *  the file view already knows how to show a picture, a PDF, a spreadsheet or a
 *  page of text; a viewer built just for the composer would be a second, worse
 *  answer to a question already settled. `.tmp` is hidden from the tree, so this
 *  is the only way in — which is exactly why the thumbnail and the chip both
 *  take the click, and the remove button stops it. */
export function openAttachment(path: string): void {
  void useFilesStore().openFile(path)
  revealEditor()
}
