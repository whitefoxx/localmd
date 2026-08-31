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
 *
 * The provider packages are imported ON DEMAND, which is why both functions are
 * async. Statically importing all seven put every one of them in the main
 * chunk — 394KB that a user with a single configured provider downloads before
 * the app paints, to use one of them. A dynamic import is fetched once, cached
 * by the module registry from then on, and precached by the service worker, so
 * the cost lands on the first model call of a fresh visit and never again.
 * (The 'prompt' update policy is what keeps that safe across a deploy: the page
 * goes on being served by the precache it was loaded against, so a lazy chunk
 * cannot 404 out from under a running session.)
 */
import type { LanguageModel, ImageModel } from 'ai'
import { sdkKindFor } from '@/lib/providers'
import type { LlmProfile } from '@/stores/settings'

/** Header that opts an Anthropic API key into browser (CORS) access. */
const ANTHROPIC_BROWSER_HEADERS = { 'anthropic-dangerous-direct-browser-access': 'true' }

export async function toLanguageModel(profile: LlmProfile): Promise<LanguageModel> {
  const { apiKey, model } = profile
  switch (sdkKindFor(profile.provider)) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({ apiKey, headers: ANTHROPIC_BROWSER_HEADERS })(model)
    }
    case 'openai': {
      // Chat Completions endpoint — broadest compatibility, streams tool calls.
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({ apiKey })(model)
    }
    case 'deepseek': {
      const { createDeepSeek } = await import('@ai-sdk/deepseek')
      return createDeepSeek({ apiKey })(model)
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI({ apiKey })(model)
    }
    case 'xai': {
      const { createXai } = await import('@ai-sdk/xai')
      return createXai({ apiKey })(model)
    }
    case 'groq': {
      const { createGroq } = await import('@ai-sdk/groq')
      return createGroq({ apiKey })(model)
    }
    default: {
      // Qwen/GLM/Kimi/MiniMax/Custom — base URL from the profile (preset table).
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      return createOpenAICompatible({
        name: profile.provider || 'custom',
        baseURL: profile.baseUrl,
        apiKey,
      })(model)
    }
  }
}

/** Build an AI SDK image-generation model. OpenAI/Google/xAI use their native
 *  image model; every OpenAI-compatible endpoint (GLM CogView, Qwen, Custom)
 *  uses the openai-compatible `/images/generations` one. Throws otherwise —
 *  which is a statement about the SDK package, not about the provider; whether
 *  a *model* draws is the profile's own `capabilities` mark, decided in
 *  Settings and never guessed from a provider id. */
export async function toImageModel(profile: LlmProfile): Promise<ImageModel> {
  const { apiKey, model } = profile
  switch (sdkKindFor(profile.provider)) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({ apiKey }).image(model)
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI({ apiKey }).image(model)
    }
    case 'xai': {
      const { createXai } = await import('@ai-sdk/xai')
      return createXai({ apiKey }).image(model)
    }
    case 'openai-compatible': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      return createOpenAICompatible({
        name: profile.provider || 'custom',
        baseURL: profile.baseUrl,
        apiKey,
      }).imageModel(model)
    }
    default:
      // Not a claim about the provider's product line — those go stale, and this
      // one cannot: `@ai-sdk/<kind>` either exposes an image model or it does
      // not. So say which fact this is, and name the way past it, because the
      // way past it does not need a release from us.
      throw new Error(
        `no image model in the @ai-sdk/${sdkKindFor(profile.provider)} package. ` +
          `If ${profile.provider} generates images over an OpenAI-compatible endpoint, ` +
          `add it again as Custom with that base URL.`,
      )
  }
}
