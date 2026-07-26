/**
 * Setup requests — the agent asking the APP to collect something from the user.
 *
 * The agent can research a service, write its tools and test them, and then hit
 * the two things it cannot do itself: a secret it must never see, and an
 * extension only the user can install. Before this, both ended the same way —
 * "open Settings → Tools → Keys and look for …" — which is where a guided setup
 * stopped being guided.
 *
 * So the agent describes what it needs and the app renders the control. For a
 * key that means the value goes from the input straight into settings; the tool
 * call resolves with `provided`, never with the value. That keeps the rule
 * ("keys are typed by the user, never pass through a conversation") while
 * removing the navigation it used to imply.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type SetupKind = 'key' | 'extension' | 'choice'

export interface SetupRequest {
  id: string
  sessionId: string
  kind: SetupKind
  /** Shown as the card's title — what is being asked for. */
  label: string
  /** How to obtain it, in the user's terms. */
  help?: string
  /** Where to get it / install it. */
  url?: string
  /** kind 'key': the secret id the value is stored under. */
  secretId?: string
  /** kind 'extension': catalog entry to install and then re-check. */
  entryId?: string
  /** kind 'choice': what the user picks between. */
  options?: string[]
}

/** What the agent learns. Never the value itself. */
export type SetupOutcome = 'provided' | 'connected' | 'skipped' | `chose:${string}`

export const useSetupStore = defineStore('setup', () => {
  /** At most one request is live per session — the agent is blocked on it. */
  const pending = ref<SetupRequest[]>([])
  const resolvers = new Map<string, (outcome: SetupOutcome) => void>()

  function pendingFor(sessionId: string): SetupRequest | undefined {
    return pending.value.find((r) => r.sessionId === sessionId)
  }

  /** Post a request and wait for the user. Resolves once, then the card goes. */
  function ask(request: SetupRequest): Promise<SetupOutcome> {
    return new Promise((resolve) => {
      // A second ask from the same session supersedes the first, which counts
      // as skipped — otherwise its caller would wait forever.
      const previous = pendingFor(request.sessionId)
      if (previous) settle(previous.id, 'skipped')
      pending.value = [...pending.value, request]
      resolvers.set(request.id, resolve)
    })
  }

  function settle(id: string, outcome: SetupOutcome): void {
    const resolve = resolvers.get(id)
    if (!resolve) return
    resolvers.delete(id)
    pending.value = pending.value.filter((r) => r.id !== id)
    resolve(outcome)
  }

  /** The turn ended (aborted, errored) — release anything still waiting. */
  function clearSession(sessionId: string): void {
    for (const r of pending.value.filter((x) => x.sessionId === sessionId)) {
      settle(r.id, 'skipped')
    }
  }

  return { pending, pendingFor, ask, settle, clearSession }
})
