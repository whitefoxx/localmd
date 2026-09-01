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
 * OpenAI endpoints below answered the CORS preflight when verified (2026-07),
 * as did OpenRouter (`access-control-allow-origin: *`, verified 2026-07-26);
 * Google/xAI/Groq are offered for BYO-key use but their browser-CORS behavior
 * is not individually verified here.
 */
import { TRIAL_PRESET } from '@/lib/trial'


/**
 * Output-token ceiling for a profile that does not set one. Lives here rather
 * than in the agent runtime because the settings form has to be able to say
 * the number out loud: "Default" in a box tells nobody what they are getting.
 */
export const DEFAULT_MAX_TOKENS = 8192

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
  /** Kept out of the provider picker. Not a secret — just not something a user
   *  can usefully choose, because its "key" is a session token this app mints
   *  (see lib/trial.ts, the only preset that sets this). Picking it by hand
   *  would only produce a profile that cannot authenticate. */
  internal?: boolean
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
    id: 'openrouter',
    label: 'OpenRouter',
    sdk: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    // Models are `vendor/model` slugs; the full catalog is openrouter.ai/models.
    // Note this route gets no Anthropic prompt caching (see run.ts) — a Claude
    // primary is cheaper on the dedicated Anthropic preset.
    defaultModel: 'anthropic/claude-sonnet-5',
    models: [
      'anthropic/claude-sonnet-5',
      'anthropic/claude-opus-5',
      'openai/gpt-5.6-terra',
      'openai/gpt-5.6-luna',
      'google/gemini-3.5-flash',
      'x-ai/grok-4.5',
      'deepseek/deepseek-v4-pro',
      'z-ai/glm-5.2',
      'moonshotai/kimi-k3',
    ],
  },
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
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
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

/** Every provider a profile can use, dedicated packages first.
 *
 *  The trial sits apart from the table above because it names an endpoint of
 *  ours rather than a provider anyone can point at; a deployment with no trial
 *  server behind it
 *  has no such provider at all rather than one that 404s. It is still registered
 *  here
 *  and not only offered in the picker — `SELECTABLE_PROVIDERS` filters it out
 *  by `internal`, while `presetFor` must keep resolving it for a live profile. */
export const ALL_PROVIDERS: ProviderPreset[] = [
  ...DEDICATED_PRESETS,
  ...OPENAI_COMPAT_PRESETS,
  TRIAL_PRESET,
]

/** The ones worth offering in the picker — everything a user can actually
 *  configure. Lookups still go through ALL_PROVIDERS, so an internal provider
 *  a profile already names still resolves. */
export const SELECTABLE_PROVIDERS: ProviderPreset[] = ALL_PROVIDERS.filter((p) => !p.internal)

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

/** What `@ai-sdk/openai-compatible` appends to a base URL when it calls. A fact
 *  about the SDK rather than about the settings form, kept here so the form can
 *  show the address a request will really reach instead of asking someone to
 *  picture it: pasting a full endpoint into a field labelled "Base URL" is the
 *  mistake everyone makes once, and it surfaces as the provider's own 404 for a
 *  path nobody typed.
 *
 *  Shown, never corrected. A base URL legitimately carries a path — a gateway's
 *  `/openai/v1`, an Azure deployment — so a rule that trimmed the tails we
 *  recognise would sooner or later rewrite input that was already right, and do
 *  it silently. Displaying the join lets the user see the mistake and keeps the
 *  field theirs. */
export const COMPAT_ENDPOINTS = {
  chat: '/chat/completions',
  image: '/images/generations',
} as const

/** The URL a call on this base actually reaches. */
export function endpointFor(baseUrl: string, kind: keyof typeof COMPAT_ENDPOINTS): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}${COMPAT_ENDPOINTS[kind]}`
}

/** Whether this provider needs a user-supplied base URL (Custom, or an unknown
 *  legacy id). Dedicated + preset-URL providers hide the field. */
export function needsBaseUrl(providerId: string): boolean {
  const preset = presetFor(providerId)
  return preset ? !!preset.needsBaseUrl : true
}

/** The three jobs this app has a role for, and therefore the only three things
 *  a profile is ever asked whether it does. Not a taxonomy of what models exist
 *  — video, transcription and speech are real and absent on purpose, because
 *  nothing here would consume the answer. A fourth arrives with a fourth role. */
export const CAPABILITIES = ['chat', 'vision', 'image'] as const
export type Capability = (typeof CAPABILITIES)[number]

/**
 * What a profile on this provider is *assumed* to do when it is first created.
 *
 * A guess about other companies' product lines, and one that rots in both
 * directions: it goes stale the day a provider ships image generation, and it
 * is already wrong today — every openai-compatible id is marked text-only here
 * while `qwen-vl-plus` and `glm-4v-plus` sit in this file's own suggestion
 * lists. A provider id also says nothing whatsoever about a Custom endpoint,
 * which is the case where someone most needs the answer to be right.
 *
 * So it seeds the checkboxes on a new profile and is not consulted again. What
 * the roles read is the profile's own marks — a fact the user can correct,
 * rather than a table they would have to wait for us to update.
 */
export function defaultCapabilities(providerId: string): Capability[] {
  const kind = sdkKindFor(providerId)
  const caps: Capability[] = ['chat']
  // Providers whose models take images inline (no separate vision role needed).
  if (kind === 'anthropic' || kind === 'openai' || kind === 'google' || kind === 'xai') {
    caps.push('vision')
  }
  // Ones with a native image model in their SDK package. OpenAI-compatible
  // endpoints reach `/images/generations` too, but whether the *model* draws is
  // a per-model fact no id can answer — so it starts off and the user says.
  if (kind === 'openai' || kind === 'google' || kind === 'xai') caps.push('image')
  return caps
}
