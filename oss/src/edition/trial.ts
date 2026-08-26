/**
 * No trial in this edition.
 *
 * The trial is not a feature that can be switched off in a setting — it is an
 * endpoint that spends somebody's API budget, and this build has no server
 * behind it. Bring your own key; Settings → Models takes one for any of a dozen
 * providers.
 */
import type { ProviderPreset } from '@/lib/providers'
import type { LlmProfile } from '@/stores/settings'

export interface EditionTrial {
  preset: ProviderPreset
  lendProfile(): Promise<LlmProfile>
}

export const TRIAL: EditionTrial | null = null
