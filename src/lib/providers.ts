/**
 * Provider presets. Each preset names the AI SDK provider package that speaks
 * its wire protocol (`sdk`) — the dedicated `@ai-sdk/<provider>` packages bake
 * in the base URL and the provider's quirks, so the user only supplies a key
 * and a model name. Only 'openai-compatible' presets carry a base URL, and only
 * the 'custom' preset asks the user to type one.
 *
 * A pure web app can still only reach endpoints that allow browser CORS. The
 * dedicated packages remove the *adapter* work, not the CORS fact — the chat
 * surface shows a CORS hint when a connection error occurs. The Chinese and
 * OpenAI endpoints below answered the CORS preflight when verified (2026-07);
 * Google/xAI/Groq are offered for BYO-key use but their browser-CORS behavior
 * is not individually verified here.
 */

/** Which AI SDK provider package drives a preset. Everything except
 *  'openai-compatible' has its base URL + adaptation baked into the package. */
export type SdkKind =
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'google'
  | 'xai'
  | 'groq'
  | 'openai-compatible'

export interface ProviderPreset {
  id: string
  label: string
  /** Provider package that handles this endpoint. */
  sdk: SdkKind
  /** Only meaningful for 'openai-compatible'; baked into the package otherwise.
   *  Empty + `needsBaseUrl` = the user types it (Custom). */
  baseUrl: string
  defaultModel: string
  /** The user must supply the base URL (Custom only). */
  needsBaseUrl?: boolean
  /** Optional curated model names for the dropdown (free text always allowed). */
  models?: string[]
}

/** OpenAI-compatible presets: one `@ai-sdk/openai-compatible` package, base URL
 *  supplied from this table so the user never types it (except Custom). */
export const OPENAI_COMPAT_PRESETS: ProviderPreset[] = [
  {
    id: 'qwen',
    label: 'Qwen (Alibaba Cloud Bailian)',
    sdk: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-vl-plus', 'qwen-vl-max'],
  },
  {
    id: 'glm',
    label: 'Zhipu GLM',
    sdk: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4v-plus'],
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    sdk: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2-0905-preview',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    sdk: 'openai-compatible',
    baseUrl: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-Text-01',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    sdk: 'openai-compatible',
    baseUrl: '',
    defaultModel: '',
    needsBaseUrl: true,
  },
]

/** Providers with a dedicated `@ai-sdk/<provider>` package — base URL and wire
 *  adaptation baked in; the user only fills a key + model. */
const DEDICATED_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    sdk: 'anthropic',
    baseUrl: '',
    defaultModel: 'claude-opus-4-8',
    models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    sdk: 'openai',
    baseUrl: '',
    defaultModel: 'gpt-4.1',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'o4-mini'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    sdk: 'deepseek',
    baseUrl: '',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    sdk: 'google',
    baseUrl: '',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    sdk: 'xai',
    baseUrl: '',
    defaultModel: 'grok-4',
    models: ['grok-4', 'grok-3', 'grok-3-mini'],
  },
  {
    id: 'groq',
    label: 'Groq',
    sdk: 'groq',
    baseUrl: '',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'moonshotai/kimi-k2-instruct'],
  },
]

/** Every provider a profile can use, dedicated packages first. */
export const ALL_PROVIDERS: ProviderPreset[] = [...DEDICATED_PRESETS, ...OPENAI_COMPAT_PRESETS]

export function presetFor(providerId: string): ProviderPreset | undefined {
  return ALL_PROVIDERS.find((p) => p.id === providerId)
}

/** Canonical API base URLs for dedicated providers (baked into their packages),
 *  so a legacy config that stored an explicit base URL can be migrated to the
 *  dedicated provider id instead of falling through to 'custom'. */
const DEDICATED_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com',
  openai: 'https://api.openai.com/v1',
}

/** The provider id a stored base URL corresponds to (for legacy migration):
 *  an openai-compatible preset, or a dedicated provider's canonical URL. */
export function providerIdForBaseUrl(baseUrl: string): string | undefined {
  const u = baseUrl.replace(/\/$/, '')
  const compat = OPENAI_COMPAT_PRESETS.find((p) => p.baseUrl && p.baseUrl.replace(/\/$/, '') === u)
  if (compat) return compat.id
  for (const [id, url] of Object.entries(DEDICATED_BASE_URLS)) {
    if (url.replace(/\/$/, '') === u) return id
  }
  return undefined
}

/** Which SDK package a stored profile's provider maps to; unknown ids (legacy
 *  custom endpoints) fall back to the universal openai-compatible package. */
export function sdkKindFor(providerId: string): SdkKind {
  return presetFor(providerId)?.sdk ?? 'openai-compatible'
}

/** Whether this provider needs a user-supplied base URL (Custom, or an unknown
 *  legacy id). Dedicated + preset-URL providers hide the field. */
export function needsBaseUrl(providerId: string): boolean {
  const preset = presetFor(providerId)
  return preset ? !!preset.needsBaseUrl : true
}

/** Providers whose models natively accept images inline (multimodal), so a
 *  profile on one needs no separate vision slot. OpenAI-compatible endpoints
 *  vary per model, so they are not assumed multimodal. */
export function isMultimodalProvider(providerId: string): boolean {
  const kind = sdkKindFor(providerId)
  return kind === 'anthropic' || kind === 'openai' || kind === 'google' || kind === 'xai'
}

/** Providers that can fill the image slot: OpenAI (DALL·E), Google (Imagen),
 *  xAI (Grok image), and any OpenAI-compatible endpoint exposing
 *  `/images/generations` (GLM CogView, Qwen, custom). Anthropic / DeepSeek /
 *  Groq have no image generation, so they're excluded. */
export function providerHasImageModel(providerId: string): boolean {
  const kind = sdkKindFor(providerId)
  return (
    kind === 'openai' || kind === 'google' || kind === 'xai' || kind === 'openai-compatible'
  )
}
