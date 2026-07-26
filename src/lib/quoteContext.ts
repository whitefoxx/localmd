/**
 * Prose provenance for a quoted passage — the "where is this from?" line that
 * precedes each block inside a user message's <selected_context>.
 *
 * The chip in the UI says only "foo.md" or "Agent reply"; the agent needs more
 * than that to act correctly. A passage lifted out of a reply is a pointer back
 * into the conversation ("look at the discussion behind item #3"), so the model
 * is told which reply it was and how far back — with the reply's opening words
 * as an anchor it can find in its own history. A passage from a file is a
 * pointer into a document, so the model is told the page or section it sat in.
 *
 * Pure by design (no stores, no DOM): the locator is captured at selection time
 * (see lib/selectionContext) and this only phrases it at send time.
 */
import type { SelectionRef } from '@/stores/composer'
import type { UiMessage } from '@/stores/chat'

/** The conversation a quote is being sent into. */
export interface QuoteScope {
  /** Id of the chat session the message is going to. */
  sessionId: string
  /** That session's messages so far, oldest first (the outgoing one excluded). */
  messages: UiMessage[]
  /** File the user has open right now, if any. */
  viewing?: string | null
}

/** First words of a reply, as an anchor the model can match against its own
 *  history. Text parts only — a reply that opens with a tool call has none. */
function opening(m: UiMessage | undefined): string {
  for (const p of m?.parts ?? []) {
    if (p.type !== 'text') continue
    const t = p.text.replace(/\s+/g, ' ').trim()
    if (t) return t.length > 60 ? `${t.slice(0, 60)}…` : t
  }
  return ''
}

/** How many assistant replies came after `i` — 0 means the latest one. */
function repliesSince(messages: UiMessage[], i: number): number {
  return messages.slice(i + 1).filter((m) => m.role === 'assistant').length
}

/** One sentence naming the origin of a staged quote (no trailing punctuation).
 *  Degrades gracefully: quotes staged before provenance existed, or pointing at
 *  a reply that is no longer in the session, fall back to the vague wording. */
export function describeQuote(s: SelectionRef, scope: QuoteScope): string {
  if (s.file) {
    const where = [
      s.from?.page ? `page ${s.from.page}` : '',
      s.from?.heading ? `under the heading “${s.from.heading}”` : '',
    ].filter(Boolean)
    const open = scope.viewing === s.file ? ', the file open on screen' : ''
    return `Text the user selected in ${s.file}${where.length ? ` (${where.join(', ')})` : ''}${open}`
  }
  const { sessionId, messageId } = s.from ?? {}
  if (sessionId && sessionId !== scope.sessionId) {
    return 'A passage the user carried over from a reply in a DIFFERENT chat session — that turn is not in this conversation’s history, so treat the quoted text as all you have'
  }
  const i = messageId === undefined ? -1 : scope.messages.findIndex((m) => m.id === messageId)
  if (i < 0 || scope.messages[i].role !== 'assistant') {
    return 'A passage the user quoted from an earlier reply of yours in this conversation'
  }
  const back = repliesSince(scope.messages, i)
  const which =
    back === 0
      ? 'your most recent reply'
      : back === 1
        ? 'the reply before your most recent one'
        : `one of your replies, ${back} replies back`
  const began = opening(scope.messages[i])
  return (
    `A passage the user quoted from ${which} in this conversation` +
    (began ? ` (that reply began: “${began}”)` : '') +
    ' — re-read that reply for the surrounding context before answering'
  )
}
