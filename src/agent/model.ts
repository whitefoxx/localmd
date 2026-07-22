/**
 * Builds an AI SDK LanguageModel from a stored LLM profile. Each dedicated
 * `@ai-sdk/<provider>` package bakes in the base URL and the provider's wire
 * quirks, so a profile only carries { provider, apiKey, model } — no base URL,
 * no adapter code. The universal `openai-compatible` package covers the rest
 * (Qwen/GLM/Kimi/MiniMax/Custom), taking the base URL from the preset table.
 *
 * Everything runs in the browser: unlike the native @anthropic-ai/sdk (which
 * blocks browser use), the AI SDK providers are plain fetch builders. Anthropic
 * needs the direct-browser-access CORS header, passed here explicitly.
 */
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createXai } from '@ai-sdk/xai'
import { createGroq } from '@ai-sdk/groq'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel, ImageModel } from 'ai'
import { sdkKindFor } from '@/lib/providers'
import type { LlmProfile } from '@/stores/settings'

/** Header that opts an Anthropic API key into browser (CORS) access. */
const ANTHROPIC_BROWSER_HEADERS = { 'anthropic-dangerous-direct-browser-access': 'true' }

export function toLanguageModel(profile: LlmProfile): LanguageModel {
  const { apiKey, model } = profile
  switch (sdkKindFor(profile.provider)) {
    case 'anthropic':
      return createAnthropic({ apiKey, headers: ANTHROPIC_BROWSER_HEADERS })(model)
    case 'openai':
      // Chat Completions endpoint — broadest compatibility, streams tool calls.
      return createOpenAI({ apiKey })(model)
    case 'deepseek':
      return createDeepSeek({ apiKey })(model)
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(model)
    case 'xai':
      return createXai({ apiKey })(model)
    case 'groq':
      return createGroq({ apiKey })(model)
    default:
      // Qwen/GLM/Kimi/MiniMax/Custom — base URL from the profile (preset table).
      return createOpenAICompatible({
        name: profile.provider || 'custom',
        baseURL: profile.baseUrl,
        apiKey,
      })(model)
  }
}

/** Build an AI SDK image-generation model for a profile whose provider supports
 *  one (see providerHasImageModel). OpenAI/Google/xAI use their native image
 *  model; every OpenAI-compatible endpoint (GLM CogView, Qwen, Custom) uses the
 *  openai-compatible `/images/generations` image model. Throws otherwise. */
export function toImageModel(profile: LlmProfile): ImageModel {
  const { apiKey, model } = profile
  switch (sdkKindFor(profile.provider)) {
    case 'openai':
      return createOpenAI({ apiKey }).image(model)
    case 'google':
      return createGoogleGenerativeAI({ apiKey }).image(model)
    case 'xai':
      return createXai({ apiKey }).image(model)
    case 'openai-compatible':
      return createOpenAICompatible({
        name: profile.provider || 'custom',
        baseURL: profile.baseUrl,
        apiKey,
      }).imageModel(model)
    default:
      throw new Error(`provider ${profile.provider} does not support image generation`)
  }
}
