/**
 * The free trial, as an optional edition capability.
 *
 * Null in an edition with no `api/trial/` behind it, which is the whole reason
 * this file exists: the trial is not a feature that can be turned off in a
 * setting, it is an endpoint that either is ours to spend or is not there at
 * all. Callers ask `if (TRIAL)` and the provider table and the demo simply lose
 * a branch when the answer is no.
 *
 * The preset lives here rather than in lib/providers.ts because it describes
 * OUR endpoint, not a provider anyone can point at. It stays `internal` for the
 * reason it always did: its "key" is a session token this app mints, so picking
 * it by hand would only produce a profile that cannot authenticate.
 */
import type { ProviderPreset } from '@/lib/providers'
import type { LlmProfile } from '@/stores/settings'
import { trialSession, trialProfile } from '@/lib/trial'

/**
 * Every type crossing this interface is one core already has. A session is
 * pointedly not among them: it is the trial's own bookkeeping, and an edition
 * without a trial could not name the type, let alone stub it. So the seam hands
 * over the finished thing — a profile — and keeps the two-step dance behind it.
 */
export interface EditionTrial {
  /** Registered into ALL_PROVIDERS so a trial profile resolves its SDK. */
  preset: ProviderPreset
  /** An ephemeral profile on a session, reusing the tab's own until it is
   *  nearly expired. Throws when the trial has nothing left to lend. */
  lendProfile(): Promise<LlmProfile>
}

export const TRIAL: EditionTrial | null = {
  preset: {
    // On our own origin, so no CORS question arises, and the key on the wire is
    // a session token that expires within the hour rather than anything of the
    // user's. The endpoint decides the model; the value here only fills the
    // profile's label.
    //
    // The path is recorded here, but the profile that actually reaches the SDK
    // carries the absolute form — see `trialBaseUrl` in lib/trial.ts, and do
    // not "simplify" that back to this string: the OpenAI-compatible provider
    // resolves nothing, and a site-relative base throws before the request.
    id: 'trial',
    label: 'Free trial',
    sdk: 'openai-compatible',
    baseUrl: '/api/trial/v1',
    defaultModel: 'deepseek-chat',
    internal: true,
  },
  async lendProfile() {
    return trialProfile(await trialSession())
  },
}
