<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import {
  useSettingsStore,
  newProfileId,
  autoLabel,
  REASONING_EFFORTS,
  type LlmProfile,
} from '@/stores/settings'
import { useFilesStore } from '@/stores/files'
import { fuzzyRank } from '@/lib/fuzzy'
import { DEFAULT_HEALTH_IGNORE } from '@/lib/scanScope'
import { useUiStore } from '@/stores/ui'
import { useThemeStore } from '@/stores/theme'
import { LICENCE_SECTION } from '@/edition/ui'
import ToolsSection from '@/components/settings/ToolsSection.vue'
import {
  ALL_PROVIDERS,
  SELECTABLE_PROVIDERS,
  presetFor,
  needsBaseUrl,
  providerHasImageModel,
  DEFAULT_MAX_TOKENS,
} from '@/lib/providers'
import {
  HOTKEYS,
  HOTKEY_BY_ID,
  formatBinding,
  bindingsEqual,
  findConflict,
  type HotkeyDef,
  type HotkeyId,
  type Binding,
} from '@/lib/hotkeys'
import { t, useI18n, LOCALES, type Locale } from '@/i18n'

const { locale, setLocale } = useI18n()

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

// Esc closes the modal while it's open (unless we're mid-recording — see below).
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  // Capture phase so the recorder intercepts the combo before the app's global
  // shortcut handler (and CodeMirror etc.) can act on it.
  window.addEventListener('keydown', onRecordKey, true)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keydown', onRecordKey, true)
})

const store = useSettingsStore()
const files = useFilesStore()
const theme = useThemeStore()

/* KB health scope — pick which top-level dirs the health check covers. */
/* ── KB health: what the scan ignores ──────────────────────────────────────
 * A gitignore-shaped denylist (see lib/scanScope), filled from a search over
 * the knowledge base so nobody has to type a path they can point at. The
 * ranking is lib/fuzzy — the same one behind ⌘P, so a folder is found here the
 * way it is found there. */
const scopeQuery = ref('')

/** Everything ignorable: every file, and every directory that holds one.
 *  Directories keep their trailing slash — it is what they mean in the list. */
const scopeCandidates = computed<string[]>(() => {
  const dirs = new Set<string>()
  for (const p of files.allFiles) {
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(`${parts.slice(0, i).join('/')}/`)
  }
  return [...[...dirs].sort(), ...[...files.allFiles].sort()]
})

const scopeMatches = computed(() => {
  const q = scopeQuery.value.trim()
  if (!q) return []
  const already = new Set(store.state.healthIgnore)
  return fuzzyRank(q, scopeCandidates.value, (p) => p)
    .filter((r) => !already.has(r.item))
    .slice(0, 8)
})

function addIgnore(pattern: string): void {
  const p = pattern.trim()
  if (!p || store.state.healthIgnore.includes(p)) return
  store.state.healthIgnore.push(p)
  scopeQuery.value = ''
}
/** Enter takes the best match, or the typed text itself — which is how a
 *  pattern that matches nothing yet (`*.draft.md`) gets into the list. */
function submitIgnore(): void {
  addIgnore(scopeMatches.value[0]?.item ?? scopeQuery.value)
}
function removeIgnore(pattern: string): void {
  const i = store.state.healthIgnore.indexOf(pattern)
  if (i >= 0) store.state.healthIgnore.splice(i, 1)
}
function resetIgnore(): void {
  store.state.healthIgnore = [...DEFAULT_HEALTH_IGNORE]
}

/* ── Hotkey rebinding ─────────────────────────────────────────────────── */
const recordingId = ref<HotkeyId | null>(null)
const hotkeyError = ref('')
const MODIFIER_KEYS = ['Meta', 'Control', 'Shift', 'Alt', 'CapsLock']

function effectiveBinding(def: HotkeyDef): Binding {
  return store.state.hotkeys[def.id] ?? def.defaultBinding
}
function isOverridden(id: HotkeyId): boolean {
  return !!store.state.hotkeys[id]
}
function startRecording(id: HotkeyId): void {
  hotkeyError.value = ''
  recordingId.value = recordingId.value === id ? null : id
}
function cancelRecording(): void {
  recordingId.value = null
  hotkeyError.value = ''
}
function resetHotkey(id: HotkeyId): void {
  delete store.state.hotkeys[id]
  hotkeyError.value = ''
}
function resetAllHotkeys(): void {
  for (const k of Object.keys(store.state.hotkeys)) delete store.state.hotkeys[k as HotkeyId]
  cancelRecording()
}

/** While recording, fully sandbox keydown: capture the combo, block the app. */
function onRecordKey(e: KeyboardEvent): void {
  const id = recordingId.value
  if (!id) return
  e.preventDefault()
  e.stopImmediatePropagation()
  if (e.key === 'Escape') return cancelRecording()
  if (MODIFIER_KEYS.includes(e.key)) return // wait for the non-modifier key
  if (!(e.metaKey || e.ctrlKey)) {
    hotkeyError.value = t('settings.needsModifier')
    return
  }
  const b: Binding = { code: e.code, mod: true, ...(e.shiftKey ? { shift: true } : {}) }
  const conflict = findConflict(id, b, store.state.hotkeys)
  if (conflict) {
    hotkeyError.value = t('settings.conflictsWith', { label: conflict.label })
    return
  }
  // Recording the default again just clears the override.
  if (bindingsEqual(b, HOTKEY_BY_ID[id].defaultBinding)) delete store.state.hotkeys[id]
  else store.state.hotkeys[id] = b
  recordingId.value = null
  hotkeyError.value = ''
}

/** Left-nav sections (ChatGPT-style). */
type SectionId = 'general' | 'models' | 'agent' | 'hotkeys' | 'health' | 'tools' | 'git' | 'licence'
const NAV: { id: SectionId; labelKey: string; icon: string }[] = [
  { id: 'general', labelKey: 'settings.nav.general', icon: 'codicon-globe' },
  { id: 'models', labelKey: 'settings.nav.models', icon: 'codicon-sparkle' },
  { id: 'agent', labelKey: 'settings.nav.agent', icon: 'codicon-settings-gear' },
  { id: 'hotkeys', labelKey: 'settings.nav.hotkeys', icon: 'codicon-keyboard' },
  { id: 'health', labelKey: 'settings.nav.health', icon: 'codicon-pulse' },
  { id: 'tools', labelKey: 'settings.nav.tools', icon: 'codicon-plug' },
  { id: 'git', labelKey: 'settings.nav.git', icon: 'codicon-github' },
  // Absent, entry and all, in an edition with no paid tier — a nav row leading
  // to a pane that does not exist is worse than no row.
  ...(LICENCE_SECTION
    ? [{ id: 'licence' as const, labelKey: 'settings.nav.licence', icon: 'codicon-key' }]
    : []),
]
const section = ref<SectionId>('models')

// Opened from elsewhere with a pane in mind (the chat's "configure a model"
// prompt, an agent asking for an extension). Consume the request so a later
// plain open lands where the user left off.
const ui = useUiStore()
watch(
  () => [props.open, ui.settingsSection] as const,
  ([open, want]) => {
    if (!open || !want) return
    if (NAV.some((n) => n.id === want)) section.value = want as SectionId
    ui.settingsSection = null
  },
  { immediate: true },
)
const sectionTitle = computed(() => {
  const n = NAV.find((n) => n.id === section.value)
  return n ? t(n.labelKey) : ''
})
function goSection(id: SectionId): void {
  section.value = id
  editing.value = null // leaving the models pane cancels an in-progress edit
  cancelRecording()
}

/** Only providers with an AI SDK image model can fill the image-generation slot. */
const imageCapableProfiles = computed(() =>
  store.state.profiles.filter((p) => providerHasImageModel(p.provider)),
)

/** Working copy under edit (null = list view). */
const editing = ref<LlmProfile | null>(null)
const isExistingProfile = computed(
  () => !!editing.value && store.state.profiles.some((p) => p.id === editing.value!.id),
)
/** What Save itself requires — one source, so the button's disabled state and
 *  the back arrow below can never drift apart. */
const profileValid = computed(() => !!editing.value?.apiKey && !!editing.value.model)

function addProfile(): void {
  editing.value = {
    id: newProfileId(),
    label: '',
    provider: 'anthropic',
    baseUrl: '',
    apiKey: '',
    model: 'claude-opus-4-8',
    reasoning: undefined,
  }
}

function editProfile(p: LlmProfile): void {
  editing.value = { ...p }
}

function applyProviderPreset(): void {
  const e = editing.value
  if (!e) return
  const preset = ALL_PROVIDERS.find((p) => p.id === e.provider)
  if (!preset) return
  e.baseUrl = preset.baseUrl
  e.model = preset.defaultModel
}

function saveProfile(): void {
  const e = editing.value
  if (!e) return
  if (!e.label.trim()) e.label = autoLabel(e)
  if (e.maxTokens !== undefined && !(e.maxTokens > 0)) delete e.maxTokens
  if (e.reasoning === undefined) delete e.reasoning
  store.upsertProfile({ ...e })
  editing.value = null
}

/** The header's ← reads as "I'm done here", and on a form this long Save can
 *  sit below the fold — so back commits the edit instead of dropping it. Cancel
 *  stays as the one deliberate way to throw an edit away. A profile Save itself
 *  would refuse (no key, no model) can only be discarded. */
function closeEditor(): void {
  if (profileValid.value) saveProfile()
  else editing.value = null
}

function slotBadges(p: LlmProfile): string[] {
  const out: string[] = []
  if (store.state.slots.primary === p.id) out.push(t('settings.badge.primary'))
  if (store.state.slots.vision === p.id) out.push(t('settings.badge.vision'))
  if (store.state.slots.image === p.id) out.push(t('settings.badge.image'))
  return out
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      @click.self="emit('close')"
    >
      <div
        class="w-[720px] max-w-[95vw] h-[620px] max-h-[88vh] rounded-xl border border-border bg-bg-1 shadow-2xl flex overflow-hidden"
      >
        <!-- ── Sidebar ─────────────────────────────────────────────────── -->
        <aside class="w-52 shrink-0 border-r border-border bg-bg-2/40 flex flex-col">
          <div class="flex items-center h-12 px-2.5 shrink-0">
            <button
              class="w-7 h-7 flex items-center justify-center rounded-md text-fg-3 hover:text-fg-0 hover:bg-bg-3 transition-colors"
              :title="$t('layout.closeEsc')"
              @click="emit('close')"
            >
              <span class="codicon codicon-close" />
            </button>
            <span class="ml-1.5 text-sm font-semibold text-fg-0">{{ $t('common.settings') }}</span>
          </div>
          <nav class="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
            <button
              v-for="n in NAV"
              :key="n.id"
              class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left transition-colors"
              :class="
                section === n.id
                  ? 'bg-bg-3 text-fg-0 font-medium'
                  : 'text-fg-2 hover:bg-bg-2 hover:text-fg-0'
              "
              @click="goSection(n.id)"
            >
              <span class="codicon shrink-0" :class="n.icon" />
              <span class="truncate">{{ $t(n.labelKey) }}</span>
            </button>
          </nav>
          <div class="px-3 py-2.5 text-[11px] text-fg-3 leading-relaxed border-t border-border">
            <span class="codicon codicon-sm codicon-shield mr-0.5" />
            {{ $t('settings.privacyNote') }}
          </div>
        </aside>

        <!-- ── Panel ───────────────────────────────────────────────────── -->
        <div class="flex-1 min-w-0 flex flex-col bg-bg-1">
          <div class="flex items-center h-12 px-6 shrink-0 border-b border-border">
            <span
              v-if="editing"
              class="codicon codicon-arrow-left text-fg-3 hover:text-fg-0 cursor-pointer mr-2"
              :title="$t('settings.back')"
              @click="closeEditor"
            />
            <h2 class="text-base font-semibold text-fg-0">
              {{ editing ? (isExistingProfile ? $t('settings.editProfile') : $t('settings.addProfile')) : sectionTitle }}
            </h2>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto panel-scroll px-6 py-5">
            <!-- ▸ Profile editor (lives inside the Models pane) -->
            <div v-if="editing" class="space-y-4 max-w-md">
              <!-- What this form is for, before the form. At the bottom it was
                   read after the fields it explains, or not at all. -->
              <p class="text-xs text-fg-3 leading-relaxed">
                {{ $t('settings.profileHelp') }}
              </p>
              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Provider</label>
                <select v-model="editing.provider" class="input" @change="applyProviderPreset">
                  <option v-for="p in SELECTABLE_PROVIDERS" :key="p.id" :value="p.id">{{ p.label }}</option>
                </select>
              </div>

              <div v-if="needsBaseUrl(editing.provider)">
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Base URL</label>
                <input v-model="editing.baseUrl" class="input" placeholder="https://api.example.com/v1" />
              </div>

              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">API key</label>
                <input
                  v-model="editing.apiKey"
                  type="password"
                  class="input"
                  :placeholder="editing.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'"
                  autocomplete="off"
                />
              </div>

              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Model</label>
                <input
                  v-model="editing.model"
                  class="input"
                  list="model-suggestions"
                  :placeholder="presetFor(editing.provider)?.defaultModel || 'e.g. gpt-4.1, deepseek-v4-flash'"
                />
                <datalist id="model-suggestions">
                  <option v-for="m in presetFor(editing.provider)?.models ?? []" :key="m" :value="m" />
                </datalist>
              </div>

              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">{{ $t('settings.labelOptional') }}</label>
                <input v-model="editing.label" class="input" :placeholder="autoLabel(editing)" />
              </div>
              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">{{ $t('settings.maxTokensOptional') }}</label>
                <!-- The number, not the word: "Default" in an empty box tells
                     nobody what they are actually getting. -->
                <input
                  v-model.number="editing.maxTokens"
                  type="number"
                  class="input"
                  :placeholder="String(DEFAULT_MAX_TOKENS)"
                />
                <p class="mt-1 text-xs text-fg-3 leading-relaxed">
                  {{ $t('settings.maxTokensHelp', { n: DEFAULT_MAX_TOKENS }) }}
                </p>
              </div>
              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">{{ $t('settings.reasoningOptional') }}</label>
                <select v-model="editing.reasoning" class="input">
                  <option :value="undefined">{{ $t('settings.defaultPlaceholder') }}</option>
                  <option v-for="r in REASONING_EFFORTS" :key="r" :value="r">
                    {{ $t(`settings.reasoning.${r}`) }}
                  </option>
                </select>
                <p class="text-xs text-fg-3 leading-relaxed mt-1">{{ $t('settings.reasoningHelp') }}</p>
              </div>

              <div class="flex gap-2 pt-1">
                <button class="btn-primary text-xs" :disabled="!profileValid" @click="saveProfile">
                  {{ $t('common.save') }}
                </button>
                <button class="btn text-xs" @click="editing = null">{{ $t('common.cancel') }}</button>
              </div>
            </div>

            <!-- ▸ General -->
            <div v-else-if="section === 'general'" class="space-y-4 max-w-md">
              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">{{ $t('settings.language') }}</label>
                <select
                  :value="locale"
                  class="input"
                  @change="setLocale(($event.target as HTMLSelectElement).value as Locale)"
                >
                  <option v-for="l in LOCALES" :key="l.value" :value="l.value">{{ l.label }}</option>
                </select>
                <p class="text-xs text-fg-3 leading-relaxed mt-2">{{ $t('settings.languageDesc') }}</p>
              </div>
              <!-- Same preference as the theme icon in the activity bar, which
                   only cycles: here it can be picked outright and read off. -->
              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">{{ $t('settings.appearance') }}</label>
                <select v-model="theme.pref" class="input">
                  <option value="system">{{ $t('layout.themeSystem') }}</option>
                  <option value="light">{{ $t('layout.themeLight') }}</option>
                  <option value="dark">{{ $t('layout.themeDark') }}</option>
                </select>
                <p class="text-xs text-fg-3 leading-relaxed mt-2">{{ $t('settings.appearanceDesc') }}</p>
              </div>
              <div class="rounded-lg border border-border overflow-hidden">
                <div class="px-3 py-3 flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <div class="text-sm text-fg-1">{{ $t('settings.richEditor') }}</div>
                    <div class="text-xs text-fg-3 mt-0.5 leading-relaxed">
                      {{ $t('settings.richEditorDesc') }}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="store.state.richEditor"
                    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                    :class="store.state.richEditor ? 'bg-accent' : 'bg-bg-3'"
                    @click="store.state.richEditor = !store.state.richEditor"
                  >
                    <span
                      class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
                      :class="store.state.richEditor ? 'translate-x-4' : 'translate-x-0.5'"
                    />
                  </button>
                </div>
              </div>
            </div>

            <!-- ▸ Models -->
            <div v-else-if="section === 'models'" class="space-y-6">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.profilesHeading') }}</span>
                  <!-- Hidden while the list is empty: the placeholder below
                       carries the same action, and two copies of one button a
                       finger apart is just a second thing to aim at. -->
                  <button v-if="store.state.profiles.length" class="btn text-xs" @click="addProfile">
                    <span class="codicon codicon-sm codicon-add mr-1" />{{ $t('settings.addProfile') }}
                  </button>
                </div>
                <!-- Adding the first key is the one thing standing between a
                     new visitor and a working agent, so the empty state carries
                     the action itself rather than pointing at the button in the
                     far corner. Same handler — one action, drawn twice. -->
                <div
                  v-if="!store.state.profiles.length"
                  class="rounded-lg border border-dashed border-border px-4 py-6 text-center"
                >
                  <span class="codicon codicon-sparkle text-fg-3" />
                  <p class="mt-2 text-sm text-fg-2">{{ $t('settings.noProfiles') }}</p>
                  <button class="btn-primary text-xs mt-3" @click="addProfile">
                    <span class="codicon codicon-sm codicon-add mr-1" />{{ $t('settings.addProfile') }}
                  </button>
                </div>
                <div v-else class="rounded-lg border border-border divide-y divide-border overflow-hidden">
                  <div
                    v-for="p in store.state.profiles"
                    :key="p.id"
                    class="group flex items-center gap-2.5 px-3 py-2.5 hover:bg-bg-2 transition-colors"
                  >
                    <span class="codicon codicon-sparkle text-fg-3 shrink-0" />
                    <div class="min-w-0 flex-1">
                      <div class="text-sm text-fg-0 truncate">{{ p.label }}</div>
                      <div class="text-xs text-fg-3 truncate">{{ p.provider }} · {{ p.model }}</div>
                    </div>
                    <span
                      v-for="b in slotBadges(p)"
                      :key="b"
                      class="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent shrink-0"
                    >{{ b }}</span>
                    <button class="text-fg-3 hover:text-fg-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" :title="$t('common.edit')" @click="editProfile(p)">
                      <span class="codicon codicon-sm codicon-edit" />
                    </button>
                    <button
                      class="text-fg-3 hover:text-removed opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      :title="$t('common.delete')"
                      @click="store.deleteProfile(p.id)"
                    >
                      <span class="codicon codicon-sm codicon-trash" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- Slots -->
              <div v-if="store.state.profiles.length">
                <div class="text-xs uppercase tracking-wide text-fg-3 mb-2">{{ $t('settings.slotsHeading') }}</div>
                <div class="rounded-lg border border-border divide-y divide-border overflow-hidden">
                  <div class="flex items-center justify-between gap-4 px-3 py-3">
                    <div class="text-sm text-fg-1">{{ $t('settings.slot.primary') }}</div>
                    <select
                      :value="store.state.slots.primary ?? ''"
                      class="input w-64 shrink-0"
                      @change="store.setSlot('primary', ($event.target as HTMLSelectElement).value || null)"
                    >
                      <option v-for="p in store.state.profiles" :key="p.id" :value="p.id">{{ p.label }}</option>
                    </select>
                  </div>
                  <div class="flex items-center justify-between gap-4 px-3 py-3">
                    <div class="text-sm text-fg-1">{{ $t('settings.slot.vision') }}</div>
                    <select
                      :value="store.state.slots.vision ?? ''"
                      class="input w-64 shrink-0"
                      @change="store.setSlot('vision', ($event.target as HTMLSelectElement).value || null)"
                    >
                      <option value="">{{ $t('settings.notConfigured') }}</option>
                      <option v-for="p in store.state.profiles" :key="p.id" :value="p.id">{{ p.label }}</option>
                    </select>
                  </div>
                  <div class="flex items-center justify-between gap-4 px-3 py-3">
                    <div class="text-sm text-fg-1">{{ $t('settings.slot.image') }}</div>
                    <select
                      :value="store.state.slots.image ?? ''"
                      class="input w-64 shrink-0"
                      @change="store.setSlot('image', ($event.target as HTMLSelectElement).value || null)"
                    >
                      <option value="">{{ $t('settings.notConfigured') }}</option>
                      <option v-for="p in imageCapableProfiles" :key="p.id" :value="p.id">{{ p.label }}</option>
                    </select>
                  </div>
                </div>
                <p class="text-xs text-fg-3 leading-relaxed mt-2">
                  {{ $t('settings.visionHelp') }}
                </p>
                <p class="text-xs text-fg-3 leading-relaxed mt-2">
                  {{ $t('settings.imageHelp') }}
                </p>
              </div>
            </div>

            <!-- ▸ Agent behavior -->
            <div v-else-if="section === 'agent'" class="space-y-2">
              <div class="rounded-lg border border-border overflow-hidden">
                <div class="px-3 py-3">
                  <div class="text-sm text-fg-1">{{ $t('settings.writeMode') }}</div>
                  <div class="text-xs text-fg-3 mt-0.5 leading-relaxed">
                    {{ $t('settings.writeModeDesc') }}
                  </div>
                  <select v-model="store.state.writeMode" class="input mt-2.5">
                    <option value="auto">{{ $t('settings.writeAuto') }}</option>
                    <option value="ask">{{ $t('settings.writeAsk') }}</option>
                  </select>
                </div>
              </div>

              <div class="rounded-lg border border-border overflow-hidden">
                <div class="px-3 py-3">
                  <div class="flex items-center justify-between gap-4">
                    <div class="min-w-0">
                      <div class="text-sm text-fg-1">{{ $t('settings.multiTab') }}</div>
                      <div class="text-xs text-fg-3 mt-0.5 leading-relaxed">
                        {{ $t('settings.multiTabDesc') }}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      :aria-checked="store.state.agentMultiTab"
                      class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                      :class="store.state.agentMultiTab ? 'bg-accent' : 'bg-bg-3'"
                      @click="store.state.agentMultiTab = !store.state.agentMultiTab"
                    >
                      <span
                        class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
                        :class="store.state.agentMultiTab ? 'translate-x-4' : 'translate-x-0.5'"
                      />
                    </button>
                  </div>
                  <div
                    v-if="store.state.agentMultiTab"
                    class="mt-3 flex items-center justify-between gap-4 border-t border-border pt-3"
                  >
                    <div class="text-sm text-fg-1">{{ $t('settings.maxTabs') }}</div>
                    <select v-model.number="store.state.agentMaxTabs" class="input w-24">
                      <option v-for="n in [2, 3, 4, 5, 6, 7, 8]" :key="n" :value="n">{{ n }}</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <!-- ▸ Hotkeys -->
            <div v-else-if="section === 'hotkeys'" class="space-y-4">
              <div class="flex items-center justify-between">
                <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.hotkeysHeading') }}</span>
                <button class="text-xs text-accent hover:underline" @click="resetAllHotkeys">
                  {{ $t('settings.resetDefaults') }}
                </button>
              </div>
              <div class="rounded-lg border border-border divide-y divide-border overflow-hidden">
                <div
                  v-for="def in HOTKEYS"
                  :key="def.id"
                  class="flex items-center gap-3 px-3 py-2.5"
                >
                  <div class="min-w-0 flex-1">
                    <div class="text-sm text-fg-1">{{ def.label }}</div>
                    <div v-if="def.hint" class="text-xs text-fg-3 mt-0.5 leading-relaxed">
                      {{ def.hint }}
                    </div>
                  </div>
                  <button
                    class="shrink-0 min-w-[76px] px-2 py-1 rounded-md border text-xs font-mono text-center transition-colors"
                    :class="
                      recordingId === def.id
                        ? 'border-accent text-accent bg-accent/10'
                        : 'border-border text-fg-1 hover:bg-bg-2'
                    "
                    :title="recordingId === def.id ? $t('settings.recordingHint') : $t('settings.recordHint')"
                    @click="startRecording(def.id)"
                  >
                    {{ recordingId === def.id ? $t('settings.recording') : formatBinding(effectiveBinding(def)) }}
                  </button>
                  <button
                    class="shrink-0 text-fg-3 hover:text-fg-0 transition-colors"
                    :class="{ 'opacity-25 pointer-events-none': !isOverridden(def.id) }"
                    :title="$t('settings.resetOne')"
                    @click="resetHotkey(def.id)"
                  >
                    <span class="codicon codicon-sm codicon-discard" />
                  </button>
                </div>
              </div>
              <p v-if="hotkeyError" class="text-xs text-removed">{{ hotkeyError }}</p>
              <p class="text-xs text-fg-3 leading-relaxed">
                {{ $t('settings.hotkeysHelp') }}
              </p>
            </div>

            <!-- ▸ KB health scope -->
            <div v-else-if="section === 'health'" class="space-y-4">
              <div>
                <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.healthScope') }}</span>
                <p class="mt-1 text-xs text-fg-3 leading-relaxed">
                  {{ $t('settings.healthDesc') }}
                </p>
              </div>
              <!-- Point at what to skip rather than typing it: the KB's own
                   files and folders, ranked by the ⌘P matcher. -->
              <div class="relative">
                <span
                  class="codicon codicon-sm codicon-search pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3"
                />
                <input
                  v-model="scopeQuery"
                  class="input pl-8"
                  :placeholder="$t('settings.ignorePlaceholder')"
                  @keydown.enter.prevent="submitIgnore"
                />
              </div>
              <div
                v-if="scopeQuery.trim()"
                class="rounded-lg border border-border divide-y divide-border overflow-hidden"
              >
                <button
                  v-for="m in scopeMatches"
                  :key="m.item"
                  class="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-bg-2 transition-colors"
                  @click="addIgnore(m.item)"
                >
                  <span
                    class="codicon codicon-sm shrink-0 text-fg-3"
                    :class="m.item.endsWith('/') ? 'codicon-folder' : 'codicon-file'"
                  />
                  <span class="flex-1 break-all font-mono text-xs text-fg-1">{{ m.item }}</span>
                  <span class="codicon codicon-sm codicon-add shrink-0 text-fg-3" />
                </button>
                <button
                  v-if="!scopeMatches.length"
                  class="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-bg-2 transition-colors"
                  @click="submitIgnore"
                >
                  <span class="codicon codicon-sm codicon-add shrink-0 text-fg-3" />
                  <span class="text-xs text-fg-2">
                    {{ $t('settings.ignoreAddPattern', { pattern: scopeQuery.trim() }) }}
                  </span>
                </button>
              </div>

              <div>
                <div class="mb-1 flex items-center justify-between">
                  <span class="text-xs uppercase tracking-wide text-fg-3">
                    {{ $t('settings.ignoredHeading', { n: store.state.healthIgnore.length }) }}
                  </span>
                  <button class="text-xs text-fg-3 hover:text-fg-1" @click="resetIgnore">
                    {{ $t('settings.ignoreReset') }}
                  </button>
                </div>
                <p v-if="!store.state.healthIgnore.length" class="text-xs text-fg-3">
                  {{ $t('settings.ignoreEmpty') }}
                </p>
                <div v-else class="rounded-lg border border-border divide-y divide-border overflow-hidden">
                  <!-- This list is the SKIPPED one, and it sat one panel below
                       a list of add-me suggestions drawn with the same file and
                       folder icons — identical rows meaning opposite things.
                       The crossed-out eye and the struck-through path say which
                       list this is without reading the heading. -->
                  <div
                    v-for="p in store.state.healthIgnore"
                    :key="p"
                    class="group flex items-center gap-2.5 px-3 py-2"
                    :title="$t('settings.ignoredRow', { pattern: p })"
                  >
                    <span class="codicon codicon-sm codicon-eye-closed shrink-0 text-fg-3" />
                    <span
                      class="flex-1 break-all font-mono text-xs text-fg-3 line-through decoration-fg-3/50"
                      >{{ p }}</span
                    >
                    <button
                      class="shrink-0 text-fg-3 opacity-0 transition-opacity hover:text-removed group-hover:opacity-100 focus:opacity-100"
                      :title="$t('settings.ignoreRemove')"
                      @click="removeIgnore(p)"
                    >
                      <span class="codicon codicon-sm codicon-close" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <ToolsSection v-else-if="section === 'tools'" />

            <!-- ▸ Git & GitHub -->
            <div v-else-if="section === 'git'" class="space-y-4 max-w-md">
              <!-- The pane opened onto three unexplained fields. Say what the
                   whole thing is for before asking for a name and a token. -->
              <div>
                <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.gitHeading') }}</span>
                <p class="mt-1 text-xs text-fg-3 leading-relaxed">{{ $t('settings.gitDesc') }}</p>
              </div>
              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">{{ $t('settings.commitAuthor') }}</label>
                <input v-model="store.state.gitName" class="input" :placeholder="$t('settings.commitAuthorPlaceholder')" />
              </div>
              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">{{ $t('settings.commitEmail') }}</label>
                <input v-model="store.state.gitEmail" class="input" placeholder="you@example.com" />
              </div>
              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">{{ $t('settings.githubToken') }}</label>
                <input
                  v-model="store.state.githubToken"
                  type="password"
                  class="input"
                  placeholder="github_pat_… / ghp_…"
                  autocomplete="off"
                />
              </div>
              <p class="text-xs text-fg-3 leading-relaxed">
                <a
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noopener"
                  class="text-accent hover:underline"
                >{{ $t('settings.githubTokenLink') }}</a>{{ $t('settings.githubHelp') }}
              </p>
            </div>

            <component
              :is="LICENCE_SECTION"
              v-else-if="section === 'licence' && LICENCE_SECTION"
            />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
