/**
 * Every question the app asks the user, and the promise each one settles.
 *
 * It grew out of the delete dialog, which replaced a `window.confirm` for a
 * reason that cost someone their knowledge base: a native dialog can only hold
 * a sentence, and a sentence about a batch has to compress. "Delete these 4
 * items?" over `raw/` and `wiki/` is true and reads as four files. What a
 * native dialog cannot do is show the list and let the user take something back
 * OUT of it — and that, not better wording, is what turns a confirmation into a
 * decision.
 *
 * Once one question was ours, the rest had to be: the app was asking in two
 * different voices, one of them a strip at the top of the browser window that
 * cannot be styled, cannot be themed, cannot say more than a paragraph, and
 * freezes everything behind it while it waits.
 *
 * **The kinds are primitives, not errands.** `notice`, `confirm`, `text`,
 * `pick` — not `askAboutDeletingFiles`. A caller that needs something the four
 * cannot express is telling us a fifth primitive is missing, not that this
 * module needs to learn about its domain; that is why the wording, the summary
 * line and the button label all arrive from the call site.
 *
 * **A decision defaults to no.** If nothing is listening — no host mounted, a
 * crash, a test — every ask resolves to its own refusal (`false`, `null`, no
 * rows) rather than hanging its caller or falling through to the action. The
 * callers treat that answer as "the user said no", so the two agree by shape.
 */
import { ref } from 'vue'

/** One row a `pick` offers. Presentation only: what a row MEANS is the
 *  caller's business, which is why nothing here mentions files or folders. */
export interface DialogRow {
  id: string
  label: string
  /** Dimmed, in front of the label. Two rows called `index.md` are told apart
   *  only by where they live. */
  prefix?: string
  /** A codicon name without the prefix, e.g. `folder`. */
  icon?: string
  /** A chip on the right — the thing the label understates. */
  badge?: string
  /** Draw this row as the consequential one: tinted icon, tinted chip. */
  loud?: boolean
}

/** One answer a `text` field will accept. `label` covers the case where the
 *  value is not its own name — an empty string that means the top of the
 *  knowledge base reads as nothing at all without one. */
export interface DialogChoice {
  value: string
  label?: string
}

interface Base {
  id: string
  title: string
  /** A sentence above the body. */
  body?: string
}

export type DialogRequest =
  | (Base & { kind: 'notice' })
  | (Base & { kind: 'confirm'; confirmLabel?: string; danger?: boolean })
  | (Base & {
      kind: 'text'
      /** What the field is for, beside it. */
      label?: string
      value: string
      placeholder?: string
      confirmLabel?: string
      /**
       * Answers the field will accept, offered under it and ranked by what has
       * been typed so far.
       *
       * The field alone turns "where do you want this" into "recite the path",
       * for destinations the user can see in the tree behind the dialog. This
       * is the other half: type it if you know it, point at it if you don't.
       */
      suggest?: DialogChoice[]
    })
  | (Base & {
      kind: 'pick'
      rows: DialogRow[]
      danger?: boolean
      /** The running total, recomputed as rows are ticked and unticked. */
      summary: (chosen: DialogRow[]) => string
      /** The confirm button's label, given how many are ticked. */
      confirmLabel: (n: number) => string
    })

/** The open request, or null. Read by the host; nothing else writes it. */
export const pendingDialog = ref<DialogRequest | null>(null)

/** Set while a host is mounted and able to answer. Without it, a caller on a
 *  screen with no host would wait for an answer that cannot come. */
const hosts = ref(0)
let resolver: ((answer: unknown) => void) | null = null

/** Called by the host component for as long as it is mounted. */
export function registerDialogHost(): () => void {
  hosts.value += 1
  return () => {
    hosts.value -= 1
    // Unmounting mid-question is not an answer, so it is a refusal.
    if (hosts.value === 0) settleDialog(refusalFor(pendingDialog.value))
  }
}

/** What each kind resolves to when nobody answers. */
function refusalFor(req: DialogRequest | null): unknown {
  switch (req?.kind) {
    case 'confirm':
      return false
    case 'text':
      return null
    case 'pick':
      return []
    default:
      return undefined
  }
}

/** Answer the open question. Called by the host — with the user's answer, or
 *  with the refusal for cancel, Escape, a click outside, and unmount. */
export function settleDialog(answer: unknown): void {
  const resolve = resolver
  resolver = null
  pendingDialog.value = null
  resolve?.(answer)
}

function ask<T>(request: Omit<DialogRequest, 'id'> & { kind: DialogRequest['kind'] }): Promise<T> {
  const req = { ...request, id: crypto.randomUUID() } as DialogRequest
  if (hosts.value === 0) {
    // Nothing can answer. A notice at least deserves to reach a developer's
    // console rather than evaporating.
    if (req.kind === 'notice') console.warn('[dialog]', req.title, req.body ?? '')
    return Promise.resolve(refusalFor(req) as T)
  }
  // A question already on screen wins; a second would stack modals, and there
  // is no gesture in this app that produces one.
  if (pendingDialog.value) settleDialog(refusalFor(pendingDialog.value))
  return new Promise<T>((resolve) => {
    resolver = resolve as (answer: unknown) => void
    pendingDialog.value = req
  })
}

/** Say something and wait for it to be read. The replacement for `alert`, and
 *  worth awaiting for the same reason `alert` blocked: what comes after it
 *  usually reads as a consequence of it. */
export function notify(title: string, body?: string): Promise<void> {
  return ask<void>({ kind: 'notice', title, body })
}

/** Ask a yes/no. `danger` colours the confirm button and takes Enter away from
 *  it — a destructive answer should cost an aimed click. */
export function askConfirm(opts: {
  title: string
  body?: string
  confirmLabel?: string
  danger?: boolean
}): Promise<boolean> {
  return ask<boolean>({ kind: 'confirm', ...opts })
}

/** Ask for a line of text. Resolves with the trimmed value, or null when the
 *  user cancelled — which is deliberately distinct from an empty string, since
 *  for some callers (a move target) empty is a real answer. */
export function askText(opts: {
  title: string
  body?: string
  label?: string
  value?: string
  placeholder?: string
  confirmLabel?: string
  suggest?: DialogChoice[]
}): Promise<string | null> {
  return ask<string | null>({ kind: 'text', value: '', ...opts })
}

/** Put a list in front of the user and let them edit it before it happens.
 *  Resolves with the rows still ticked — possibly fewer than were offered, and
 *  empty when they cancelled. */
export function askPick(opts: {
  title: string
  body?: string
  rows: DialogRow[]
  danger?: boolean
  summary: (chosen: DialogRow[]) => string
  confirmLabel: (n: number) => string
}): Promise<DialogRow[]> {
  return ask<DialogRow[]>({ kind: 'pick', ...opts })
}
