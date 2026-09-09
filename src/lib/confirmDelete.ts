/**
 * The question in front of a delete, and the promise it settles.
 *
 * It replaced `window.confirm`, for a reason that cost someone their knowledge
 * base. A native confirm can only hold a sentence, and a sentence about a batch
 * has to compress: "Delete these 4 items?" over `raw/` and `wiki/` is true and
 * reads as four files, while what it actually takes is every note in the
 * folder. What a native dialog cannot do is show the list and let the user take
 * something back OUT of it — and that, not better wording, is what turns a
 * confirmation into a decision.
 *
 * So the question is a component (`DeleteDialog.vue`), and this module is the
 * seam between it and the plain functions in `lib/fileOps` that need an answer.
 * One request at a time: a second ask while one is open would be two modals
 * over each other, and there is no gesture that produces one.
 *
 * **A decision defaults to no.** If nothing is listening — no dialog mounted,
 * a crash, a test — `askDelete` resolves with nothing selected rather than
 * hanging its caller or, worse, falling through to a delete. The one caller
 * treats an empty answer as "the user said no", so the two agree by shape.
 */
import { ref } from 'vue'

/** One row the dialog offers, with the scale a folder hides behind its name. */
export interface DeleteCandidate {
  path: string
  isDir: boolean
  /** Files under a folder, from the in-memory tree. 0 for a file row. */
  files: number
}

export interface DeleteRequest {
  id: string
  candidates: DeleteCandidate[]
}

/** The open request, or null. Read by the dialog; nothing else writes it. */
export const pendingDelete = ref<DeleteRequest | null>(null)

/** Set while a dialog is mounted and able to answer. Without this, a caller on
 *  a screen that has no dialog would wait for an answer that cannot come. */
const listeners = ref(0)
let resolver: ((picked: DeleteCandidate[]) => void) | null = null

/** Called by the dialog for as long as it is mounted. */
export function registerDeleteDialog(): () => void {
  listeners.value += 1
  return () => {
    listeners.value -= 1
    // Unmounting mid-question is not an answer, so it is a no.
    if (listeners.value === 0) settleDelete([])
  }
}

/**
 * Put the batch in front of the user and wait.
 *
 * Resolves with the rows they left ticked — which may be fewer than were asked
 * about, and is empty when they cancelled. Never rejects: the caller's job is
 * to delete what came back, and "nothing came back" is a complete answer.
 */
export function askDelete(candidates: DeleteCandidate[]): Promise<DeleteCandidate[]> {
  if (!candidates.length || listeners.value === 0) return Promise.resolve([])
  // A question already on screen wins; a second one would stack modals.
  if (pendingDelete.value) settleDelete([])
  return new Promise((resolve) => {
    resolver = resolve
    pendingDelete.value = { id: crypto.randomUUID(), candidates }
  })
}

/** Answer the open question. Called by the dialog — with the ticked rows, or
 *  with [] for cancel, Escape, a click outside, and unmount. */
export function settleDelete(picked: DeleteCandidate[]): void {
  const resolve = resolver
  resolver = null
  pendingDelete.value = null
  resolve?.(picked)
}
