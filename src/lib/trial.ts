/**
 * The free trial: a way to ask the demo one real question before choosing a
 * folder or getting an API key.
 *
 * It is deliberately not a feature of the agent. The trial is a *profile* —
 * an OpenAI-compatible endpoint that happens to be ours, whose key happens to
 * be a short-lived session token — so the agent loop, the tools, the streaming
 * and the review panel do not know it exists. Nothing here branches on "is
 * this the trial"; the machinery that already reaches any endpoint reaches
 * this one. See `providers.ts` for the preset.
 *
 * The token lives in sessionStorage rather than localStorage on purpose: it is
 * worth nothing tomorrow, belongs to this tab, and must not be mistaken for
 * the user's own key. And the profile it builds is `ephemeral`, so the
 * settings watcher never writes it to disk (see stores/settings.ts).
 *
 * Everything that bounds the cost is server-side, in `api/trial/`. This module
 * cannot enforce a budget and does not pretend to — it asks for a session and
 * reports, in plain words, when the answer is no.
 */
import type { LlmProfile } from '@/stores/settings'

const STORAGE_KEY = 'localmd:trial-session'

export interface TrialSession {
  token: string
  /** Epoch ms. Past this the endpoint answers 401 and we ask for a new one. */
  expiresAt: number
  model: string
}

/** Why the trial is unavailable, in the terms the UI has to explain. */
export type TrialRefusal = 'exhausted' | 'unavailable'

export class TrialUnavailable extends Error {
  constructor(readonly reason: TrialRefusal) {
    super(reason)
    this.name = 'TrialUnavailable'
  }
}

function cached(): TrialSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as TrialSession
    // A minute of slack: a token that expires mid-request is a failed answer,
    // which costs more than asking for a fresh one slightly early.
    return s.expiresAt - 60_000 > Date.now() ? s : null
  } catch {
    return null
  }
}

/** Get a usable session, reusing the tab's own until it is nearly expired. */
export async function trialSession(): Promise<TrialSession> {
  const existing = cached()
  if (existing) return existing

  let res: Response
  try {
    res = await fetch('/api/trial/session', { method: 'POST' })
  } catch {
    throw new TrialUnavailable('unavailable')
  }
  if (res.status === 402 || res.status === 429) throw new TrialUnavailable('exhausted')
  if (!res.ok) throw new TrialUnavailable('unavailable')

  let session: TrialSession
  try {
    session = (await res.json()) as TrialSession
  } catch {
    // In dev there is no serverless runtime, so this path answers with
    // whatever the dev server felt like. Not an error worth a stack trace.
    throw new TrialUnavailable('unavailable')
  }
  if (!session?.token || !session?.model) throw new TrialUnavailable('unavailable')
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    /* private mode — the session still works for this page */
  }
  return session
}

/** The profile the trial session becomes. `ephemeral` keeps it out of storage. */
export function trialProfile(session: TrialSession): LlmProfile {
  return {
    id: 'trial',
    label: 'Free trial',
    provider: 'trial',
    baseUrl: '/api/trial/v1',
    apiKey: session.token,
    model: session.model,
    ephemeral: true,
  }
}

export function forgetTrial(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to forget */
  }
}
