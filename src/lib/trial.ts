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
import type { ProviderPreset } from '@/lib/providers'

const STORAGE_KEY = 'localmd:trial-session'
const VISITOR_KEY = 'localmd:trial-visitor'

/**
 * A random id for this browser, kept so the trial's rate limit has something
 * better than an address to count.
 *
 * Deliberately random, not derived from the device. A fingerprint would count
 * more reliably and that is exactly the problem: an app whose front page says
 * it cannot see you should not start recognising people by their hardware in
 * order to hand out free things. This is a number we made up, visible in
 * storage, clearable — and because it is clearable it can only ever be the
 * polite bucket, never the enforcement. The server keeps a much looser count
 * per address behind it, and neither is what bounds the bill.
 */
function visitorId(): string | null {
  try {
    const existing = localStorage.getItem(VISITOR_KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    localStorage.setItem(VISITOR_KEY, fresh)
    return fresh
  } catch {
    // Private mode, or storage denied. The server falls back to its address
    // bucket, which is the same place a cleared browser lands.
    return null
  }
}

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

  const visitor = visitorId()
  let res: Response
  try {
    res = await fetch('/api/trial/session', {
      method: 'POST',
      headers: visitor ? { 'X-Trial-Visitor': visitor } : undefined,
    })
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

/** Where the trial's chat endpoint lives, as an absolute URL on this origin.
 *
 *  Absolute, and not the `/api/trial/v1` the preset table carries, because the
 *  OpenAI-compatible provider builds each request as
 *  `new URL(`${baseURL}${path}`)` — with no base to resolve against, a
 *  site-relative path throws `Invalid URL` before a request is ever made. The
 *  endpoint is on this origin either way, so saying so costs nothing and the
 *  SDK stops guessing.
 *
 *  This is the one profile in the app whose endpoint is ours, which is exactly
 *  why it was the one nobody's own API key would have caught. */
function trialBaseUrl(): string {
  return new URL('/api/trial/v1', location.origin).href
}

/** The profile the trial session becomes. `ephemeral` keeps it out of storage. */
export function trialProfile(session: TrialSession): LlmProfile {
  return {
    id: 'trial',
    label: 'Free trial',
    provider: 'trial',
    baseUrl: trialBaseUrl(),
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

/**
 * The provider preset the trial registers as.
 *
 * On our own origin, so no CORS question arises, and the key on the wire is a
 * session token that expires within the hour rather than anything of the
 * user's. The endpoint decides the model; the value here only fills the
 * profile's label.
 *
 * The path is recorded here, but the profile that actually reaches the SDK
 * carries the absolute form — see `trialBaseUrl` above, and do not "simplify"
 * that back to this string: the OpenAI-compatible provider resolves nothing,
 * and a site-relative base throws before the request.
 *
 * It stays `internal` for the reason it always did: its "key" is a session
 * token this app mints, so picking it by hand would only produce a profile
 * that cannot authenticate.
 */
export const TRIAL_PRESET: ProviderPreset = {
  id: 'trial',
  label: 'Free trial',
  sdk: 'openai-compatible',
  baseUrl: '/api/trial/v1',
  defaultModel: 'deepseek-chat',
  internal: true,
}

/** An ephemeral profile on a session, reusing the tab's own until it is nearly
 *  expired. Throws `TrialUnavailable` when the trial has nothing left to lend. */
export async function lendTrialProfile(): Promise<LlmProfile> {
  return trialProfile(await trialSession())
}
