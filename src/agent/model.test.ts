import { describe, it, expect } from 'vitest'
import { toLanguageModel, toImageModel } from './model'
import { sdkKindFor } from '@/lib/providers'
import type { LlmProfile } from '@/stores/settings'

/**
 * Every branch is a dynamic import now, and a wrong specifier or a renamed
 * export in one of them fails at RUNTIME, for that provider only — the kind of
 * defect that ships happily and then greets exactly the users who chose Groq.
 * These tests exist to make each branch execute at least once.
 */
const profile = (provider: string): LlmProfile => ({
  id: 't',
  label: 't',
  provider,
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'sk-test',
  model: 'some-model',
})

/** One provider id per SdkKind, so the switch is covered exhaustively. */
const BY_KIND: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  deepseek: 'deepseek',
  google: 'google',
  xai: 'xai',
  groq: 'groq',
  'openai-compatible': 'qwen',
}

describe('toLanguageModel', () => {
  for (const [kind, provider] of Object.entries(BY_KIND)) {
    it(`loads the ${kind} provider`, async () => {
      expect(sdkKindFor(provider), `${provider} should map to ${kind}`).toBe(kind)
      const model = await toLanguageModel(profile(provider))
      expect(model).toBeTruthy()
      expect(typeof model === 'string' ? model : model.modelId).toBe('some-model')
    })
  }

  /** An unknown id is not an error: the preset table falls back to the
   *  universal OpenAI-compatible client, which is what a Custom profile is. */
  it('falls back to the openai-compatible client for an unknown provider', async () => {
    const model = await toLanguageModel(profile('something-new'))
    expect(model).toBeTruthy()
  })
})

describe('toImageModel', () => {
  for (const provider of ['openai', 'google', 'xai', 'qwen']) {
    it(`builds an image model for ${provider}`, async () => {
      const model = await toImageModel(profile(provider))
      expect(model).toBeTruthy()
    })
  }

  for (const provider of ['anthropic', 'deepseek', 'groq']) {
    it(`refuses ${provider}, which has no image generation`, async () => {
      await expect(toImageModel(profile(provider))).rejects.toThrow(/does not support/)
    })
  }
})
