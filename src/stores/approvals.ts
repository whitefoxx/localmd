/**
 * Ask-first approvals — a write the agent proposed, paused on the user.
 *
 * The decision belongs to the conversation that caused it: the tool emits an
 * `approval` event that renders as a card in that session's transcript (the
 * diff right where the request was made), registers the request here, and
 * awaits. The card settles it; the turn hangs until someone does. This store
 * is only the rendezvous — request in, one decision out.
 *
 * Three outcomes, deliberately not two: the user saying no ('rejected') and
 * the user never being asked ('stopped' — turn aborted, session closed) must
 * read differently to the model. Conflating them taught the agent to argue
 * with a refusal nobody had made.
 *
 * Already-written changes are a different thing entirely — those live in the
 * review store as post-hoc snapshots (auto mode's approve/discard list).
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ApprovalDecision = 'approved' | 'rejected' | 'stopped'

export interface ApprovalRequest {
  id: string
  sessionId: string
  /** KB-relative path the proposed change touches (display + test lookup). */
  path: string
}

export const useApprovalsStore = defineStore('approvals', () => {
  const pending = ref<ApprovalRequest[]>([])
  const resolvers = new Map<string, (decision: ApprovalDecision) => void>()

  /** Post a request and wait for the user's decision. Resolves exactly once. */
  function ask(request: ApprovalRequest): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      pending.value = [...pending.value, request]
      resolvers.set(request.id, resolve)
    })
  }

  function settle(id: string, decision: ApprovalDecision): void {
    const resolve = resolvers.get(id)
    if (!resolve) return
    resolvers.delete(id)
    pending.value = pending.value.filter((r) => r.id !== id)
    resolve(decision)
  }

  /** The turn died (stop, abort, session closed) — release anything still
   *  waiting as 'stopped'. All sessions when omitted (KB switch/teardown). */
  function clearSession(sessionId?: string): void {
    for (const r of [...pending.value]) {
      if (sessionId === undefined || r.sessionId === sessionId) settle(r.id, 'stopped')
    }
  }

  return { pending, ask, settle, clearSession }
})
