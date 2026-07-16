/**
 * LLM configuration — multi-profile + capability slots (web-agent pattern).
 *
 * A **profile** is one credential set (provider + baseUrl + apiKey + model).
 * **Slots** assign a profile to a job:
 *   - `primary` — the model the agent loop runs on (required)
 *   - `vision`  — image understanding (optional). Same profile as primary =
 *     "my primary is multimodal, feed it images inline"; a different profile =
 *     the loop sub-calls it via the view_image tool. Anthropic primaries are
 *     always multimodal and ignore the slot.
 *
 * normalizeSettings migrates the original single-provider shape.
 */
import { defineStore } from 'pinia'
import { reactive, computed, watch } from 'vue'
import {
  presetFor,
  providerIdForBaseUrl,
  isMultimodalProvider,
  needsBaseUrl,
} from '@/lib/providers'
import { normalizeMcpServerList, type McpServerConfig } from '@/lib/mcp'
import { isE2eMode } from '@/lib/e2e'

export interface LlmProfile {
  id: string
  /** User-visible name; autoLabel() default. */
  label: string
  /** 'anthropic' uses the Anthropic SDK; anything else is OpenAI-compatible. */
  provider: string
  /** Empty for anthropic. */
  baseUrl: string
  apiKey: string
  model: string
  /** Per-request output cap; absent = provider default. */
  maxTokens?: number
}

export type Slot = 'primary' | 'vision' | 'image'

export interface SettingsState {
  profiles: LlmProfile[]
  slots: Partial<Record<Slot, string>>
  /** Commit author for in-app git commits (repo config wins when present). */
  gitName: string
  gitEmail: string
  /** GitHub PAT for pushing via the REST API (pull of public repos works
   *  without it). Same localStorage trust model as the LLM keys. */
  githubToken: string
  /** auto: agent writes land immediately (reviewable after the fact).
   *  ask: every write/edit pauses until approved in the review panel. */
  writeMode: 'auto' | 'ask'
  /** auto: after each agent turn that wrote files (KB must be a git repo),
   *  commit those paths as "checkpoint: …" — one-click revert in the Git
   *  panel. off: no automatic commits (default). */
  checkpointMode: 'off' | 'auto'
  /** Remote MCP servers (Streamable HTTP; must allow browser CORS). */
  mcpServers: McpServerConfig[]
}

const STORAGE_KEY = 'browser-md:settings'

export function newProfileId(): string {
  return crypto.randomUUID()
}

export function autoLabel(p: Pick<LlmProfile, 'provider' | 'model'>): string {
  const label = presetFor(p.provider)?.label ?? p.provider
  return p.model ? `${label} · ${p.model}` : label
}

/** Accepts the current multi-profile shape and the legacy single-provider
 *  shape ({provider, anthropicApiKey, openaiApiKey, …}); anything else →
 *  empty store. Slot ids are clamped to existing profiles. */
const EMPTY: Omit<SettingsState, 'profiles' | 'slots'> = {
  gitName: '',
  gitEmail: '',
  githubToken: '',
  writeMode: 'auto',
  checkpointMode: 'off',
  mcpServers: [],
}

function extras(obj: Record<string, unknown>): Omit<SettingsState, 'profiles' | 'slots'> {
  return {
    gitName: String(obj.gitName ?? ''),
    gitEmail: String(obj.gitEmail ?? ''),
    githubToken: String(obj.githubToken ?? ''),
    writeMode: obj.writeMode === 'ask' ? 'ask' : 'auto',
    checkpointMode: obj.checkpointMode === 'auto' ? 'auto' : 'off',
    mcpServers: normalizeMcpServerList(obj.mcpServers, () => newProfileId()),
  }
}

export function normalizeSettings(raw: unknown): SettingsState {
  if (!raw || typeof raw !== 'object') return { profiles: [], slots: {}, ...EMPTY }
  const obj = raw as Record<string, unknown>

  if (Array.isArray(obj.profiles)) {
    const profiles: LlmProfile[] = []
    for (const p of obj.profiles) {
      if (!p || typeof p !== 'object') continue
      const pp = p as Record<string, unknown>
      const prof: LlmProfile = {
        id: typeof pp.id === 'string' && pp.id ? pp.id : newProfileId(),
        label: '',
        provider: String(pp.provider ?? 'custom'),
        baseUrl: String(pp.baseUrl ?? ''),
        apiKey: String(pp.apiKey ?? ''),
        model: String(pp.model ?? ''),
      }
      const maxTokens = Number(pp.maxTokens)
      if (Number.isFinite(maxTokens) && maxTokens > 0) prof.maxTokens = maxTokens
      prof.label =
        typeof pp.label === 'string' && pp.label.trim() ? pp.label.trim() : autoLabel(prof)
      profiles.push(prof)
    }
    const slots: Partial<Record<Slot, string>> = {}
    const rawSlots = (obj.slots ?? {}) as Record<string, unknown>
    for (const slot of ['primary', 'vision', 'image'] as Slot[]) {
      const want = rawSlots[slot]
      if (typeof want === 'string' && profiles.some((p) => p.id === want)) slots[slot] = want
    }
    if (!slots.primary && profiles.length) slots.primary = profiles[0].id
    return { profiles, slots, ...extras(obj) }
  }

  // Legacy single-provider shape → one profile per configured provider.
  if (typeof obj.provider === 'string') {
    const profiles: LlmProfile[] = []
    const anthropicKey = String(obj.anthropicApiKey ?? '')
    if (anthropicKey) {
      const p = {
        id: newProfileId(),
        provider: 'anthropic',
        baseUrl: '',
        apiKey: anthropicKey,
        model: String(obj.anthropicModel ?? 'claude-opus-4-8'),
      }
      profiles.push({ ...p, label: autoLabel(p) })
    }
    const openaiKey = String(obj.openaiApiKey ?? '')
    if (openaiKey) {
      const rawBaseUrl = String(obj.openaiBaseUrl ?? '')
      const providerId = providerIdForBaseUrl(rawBaseUrl) ?? 'custom'
      const p = {
        id: newProfileId(),
        provider: providerId,
        // Dedicated providers bake in their base URL; keep it only for endpoints
        // that need one (Custom / preset-URL).
        baseUrl: needsBaseUrl(providerId) ? rawBaseUrl : '',
        apiKey: openaiKey,
        model: String(obj.openaiModel ?? ''),
      }
      profiles.push({ ...p, label: autoLabel(p) })
    }
    const slots: Partial<Record<Slot, string>> = {}
    const wantAnthropic = obj.provider === 'anthropic'
    const primary =
      profiles.find((p) => (p.provider === 'anthropic') === wantAnthropic) ?? profiles[0]
    if (primary) slots.primary = primary.id
    return { profiles, slots, ...extras(obj) }
  }

  return { profiles: [], slots: {}, ...EMPTY }
}

function load(): SettingsState {
  if (isE2eMode()) return { profiles: [], slots: {}, ...EMPTY } // never touch real config
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalizeSettings(JSON.parse(raw))
  } catch {
    /* corrupted settings — fall back to empty */
  }
  return { profiles: [], slots: {}, ...EMPTY }
}

export const useSettingsStore = defineStore('settings', () => {
  const state = reactive<SettingsState>(load())

  // E2E mode must NOT persist — the mock profile once leaked into the user's
  // real localStorage through this watcher and wiped their API keys.
  if (!isE2eMode()) {
    watch(state, () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), { deep: true })
  }

  const byId = (id: string | undefined): LlmProfile | null =>
    state.profiles.find((p) => p.id === id) ?? null

  const primary = computed(() => byId(state.slots.primary))
  const vision = computed(() => byId(state.slots.vision))
  /** Image-generation slot (optional): the model the generate_image tool runs on. */
  const image = computed(() => byId(state.slots.image))
  /** Images can go straight into the primary's messages: multimodal providers
   *  (Anthropic/OpenAI/Google/xAI) take them inline; an OpenAI-compatible
   *  primary qualifies when the user also assigned it to the vision slot. */
  const visionInline = computed(() => {
    const p = primary.value
    if (!p) return false
    return isMultimodalProvider(p.provider) || vision.value?.id === p.id
  })
  /** Some way to understand images exists (inline or sub-call). */
  const visionAvailable = computed(() => visionInline.value || !!vision.value)

  function isConfigured(): boolean {
    const p = primary.value
    if (!p) return false
    if (p.provider === 'mock') return true // E2E provider needs no credentials
    // Dedicated packages bake in the base URL; only providers that need one
    // (Custom / legacy) must have baseUrl filled.
    return !!p.apiKey && !!p.model && (!needsBaseUrl(p.provider) || !!p.baseUrl)
  }

  function upsertProfile(profile: LlmProfile): void {
    const idx = state.profiles.findIndex((p) => p.id === profile.id)
    if (idx >= 0) state.profiles[idx] = profile
    else state.profiles.push(profile)
    if (!state.slots.primary) state.slots.primary = profile.id
  }

  function deleteProfile(id: string): void {
    state.profiles = state.profiles.filter((p) => p.id !== id)
    for (const slot of Object.keys(state.slots) as Slot[]) {
      if (state.slots[slot] === id) delete state.slots[slot]
    }
    if (!state.slots.primary) {
      const next = state.profiles.find((p) => p.apiKey) ?? state.profiles[0]
      if (next) state.slots.primary = next.id
    }
  }

  function setSlot(slot: Slot, profileId: string | null): void {
    if (profileId && state.profiles.some((p) => p.id === profileId)) {
      state.slots[slot] = profileId
    } else {
      if (slot === 'primary' && state.profiles.length > 0) return // never orphan primary
      delete state.slots[slot]
    }
  }

  return {
    state,
    primary,
    vision,
    image,
    visionInline,
    visionAvailable,
    isConfigured,
    upsertProfile,
    deleteProfile,
    setSlot,
  }
})
