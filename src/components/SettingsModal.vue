<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSettingsStore, newProfileId, autoLabel, type LlmProfile } from '@/stores/settings'
import { useMcpStore } from '@/stores/mcp'
import { useFilesStore } from '@/stores/files'
import { ALL_PROVIDERS, presetFor, needsBaseUrl, providerHasImageModel } from '@/lib/providers'
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
const mcp = useMcpStore()
const files = useFilesStore()

/* KB health scope — pick which top-level dirs the health check covers. */
const kbDirs = computed(() => {
  const set = new Set<string>()
  for (const p of files.mdFiles) {
    const i = p.indexOf('/')
    if (i > 0) set.add(p.slice(0, i))
  }
  return [...set].sort()
})
function toggleHealthDir(d: string): void {
  const list = store.state.healthDirs
  const i = list.indexOf(d)
  if (i >= 0) list.splice(i, 1)
  else list.push(d)
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
type SectionId = 'general' | 'models' | 'agent' | 'hotkeys' | 'health' | 'tools' | 'git'
const NAV: { id: SectionId; labelKey: string; icon: string }[] = [
  { id: 'general', labelKey: 'settings.nav.general', icon: 'codicon-globe' },
  { id: 'models', labelKey: 'settings.nav.models', icon: 'codicon-sparkle' },
  { id: 'agent', labelKey: 'settings.nav.agent', icon: 'codicon-settings-gear' },
  { id: 'hotkeys', labelKey: 'settings.nav.hotkeys', icon: 'codicon-keyboard' },
  { id: 'health', labelKey: 'settings.nav.health', icon: 'codicon-pulse' },
  { id: 'tools', labelKey: 'settings.nav.tools', icon: 'codicon-plug' },
  { id: 'git', labelKey: 'settings.nav.git', icon: 'codicon-github' },
]
const section = ref<SectionId>('models')
const sectionTitle = computed(() => {
  const n = NAV.find((n) => n.id === section.value)
  return n ? t(n.labelKey) : ''
})
function goSection(id: SectionId): void {
  section.value = id
  editing.value = null // leaving the models pane cancels an in-progress edit
  cancelRecording()
  resetMcpForm()
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

/* MCP server add / edit form (editMcpId set = editing that server in place) */
const mcpName = ref('')
const mcpUrl = ref('')
const mcpToken = ref('')
const editMcpId = ref<string | null>(null)

function resetMcpForm(): void {
  editMcpId.value = null
  mcpName.value = ''
  mcpUrl.value = ''
  mcpToken.value = ''
}

function startEditMcp(s: { id: string; name: string; url: string; token?: string }): void {
  editMcpId.value = s.id
  mcpName.value = s.name
  mcpUrl.value = s.url
  mcpToken.value = s.token ?? ''
}

function submitMcpServer(): void {
  if (!mcpUrl.value.trim()) return
  const token = mcpToken.value.trim()
  if (editMcpId.value) {
    const s = store.state.mcpServers.find((x) => x.id === editMcpId.value)
    if (s) {
      s.name = mcpName.value.trim() || 'server'
      s.url = mcpUrl.value.trim()
      if (token) s.token = token
      else delete s.token
    }
  } else {
    store.state.mcpServers.push({
      id: newProfileId(),
      name: mcpName.value.trim() || 'server',
      url: mcpUrl.value.trim(),
      ...(token ? { token } : {}),
    })
  }
  resetMcpForm()
}

function removeMcpServer(id: string): void {
  store.state.mcpServers = store.state.mcpServers.filter((s) => s.id !== id)
  if (editMcpId.value === id) resetMcpForm()
}

function toggleMcpServer(id: string): void {
  const s = store.state.mcpServers.find((x) => x.id === id)
  if (s) s.enabled = s.enabled === false ? true : false
}

function mcpStatusLabel(s: (typeof mcp.servers)[number]): { label: string; cls: string } {
  if (s.status === 'off') return { label: t('settings.status.off'), cls: 'bg-fg-3' }
  if (s.status === 'connecting') return { label: t('settings.status.connecting'), cls: 'bg-fg-3' }
  if (s.status === 'error')
    return { label: s.error?.slice(0, 60) ?? t('settings.status.failed'), cls: 'bg-removed' }
  return { label: t('settings.status.nTools', { n: s.tools.length }), cls: 'bg-added' }
}

function addProfile(): void {
  editing.value = {
    id: newProfileId(),
    label: '',
    provider: 'anthropic',
    baseUrl: '',
    apiKey: '',
    model: 'claude-opus-4-8',
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
  store.upsertProfile({ ...e })
  editing.value = null
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
              @click="editing = null"
            />
            <h2 class="text-base font-semibold text-fg-0">
              {{ editing ? (isExistingProfile ? $t('settings.editProfile') : $t('settings.addProfile')) : sectionTitle }}
            </h2>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto panel-scroll px-6 py-5">
            <!-- ▸ Profile editor (lives inside the Models pane) -->
            <div v-if="editing" class="space-y-4 max-w-md">
              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Provider</label>
                <select v-model="editing.provider" class="input" @change="applyProviderPreset">
                  <option v-for="p in ALL_PROVIDERS" :key="p.id" :value="p.id">{{ p.label }}</option>
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
                  :placeholder="presetFor(editing.provider)?.defaultModel || 'e.g. gpt-4.1, deepseek-chat'"
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
                <input v-model.number="editing.maxTokens" type="number" class="input" :placeholder="$t('settings.defaultPlaceholder')" />
              </div>

              <p class="text-xs text-fg-3 leading-relaxed">
                {{ $t('settings.profileHelp') }}
              </p>

              <div class="flex gap-2 pt-1">
                <button class="btn-primary text-xs" :disabled="!editing.apiKey || !editing.model" @click="saveProfile">
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
            </div>

            <!-- ▸ Models -->
            <div v-else-if="section === 'models'" class="space-y-6">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.profilesHeading') }}</span>
                  <button class="btn text-xs" @click="addProfile">
                    <span class="codicon codicon-sm codicon-add mr-1" />{{ $t('settings.addProfile') }}
                  </button>
                </div>
                <div v-if="!store.state.profiles.length" class="text-sm text-fg-3 py-3">
                  {{ $t('settings.noProfiles') }}
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
                    <button class="text-fg-3 hover:text-fg-0 opacity-0 group-hover:opacity-100" :title="$t('common.edit')" @click="editProfile(p)">
                      <span class="codicon codicon-sm codicon-edit" />
                    </button>
                    <button
                      class="text-fg-3 hover:text-removed opacity-0 group-hover:opacity-100"
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
              <div class="rounded-lg border border-border divide-y divide-border overflow-hidden">
                <button
                  class="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-bg-2 transition-colors"
                  @click="store.state.healthDirs = []"
                >
                  <span
                    class="codicon codicon-sm shrink-0"
                    :class="
                      !store.state.healthDirs.length
                        ? 'codicon-pass-filled text-accent'
                        : 'codicon-circle-large-outline text-fg-3'
                    "
                  />
                  <span class="text-fg-1">{{ $t('settings.allDirs') }}</span>
                </button>
                <button
                  v-for="d in kbDirs"
                  :key="d"
                  class="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-bg-2 transition-colors"
                  @click="toggleHealthDir(d)"
                >
                  <span
                    class="codicon codicon-sm shrink-0"
                    :class="
                      store.state.healthDirs.includes(d)
                        ? 'codicon-pass-filled text-accent'
                        : 'codicon-circle-large-outline text-fg-3'
                    "
                  />
                  <span class="font-mono text-xs text-fg-1">{{ d }}/</span>
                </button>
              </div>
              <p v-if="!kbDirs.length" class="text-xs text-fg-3">{{ $t('settings.noSubdirs') }}</p>
            </div>

            <!-- ▸ External tools (MCP) -->
            <div v-else-if="section === 'tools'" class="space-y-4">
              <!-- Built-in web access (Jina AI Reader) -->
              <div class="rounded-lg border border-border overflow-hidden">
                <div class="px-3 py-3 flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <div class="text-sm text-fg-1">{{ $t('settings.jinaTitle') }}</div>
                    <div class="text-xs text-fg-3 mt-0.5 leading-relaxed">
                      {{ $t('settings.jinaDesc') }}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="store.state.jinaReader"
                    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                    :class="store.state.jinaReader ? 'bg-accent' : 'bg-bg-3'"
                    @click="store.state.jinaReader = !store.state.jinaReader"
                  >
                    <span
                      class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
                      :class="store.state.jinaReader ? 'translate-x-4' : 'translate-x-0.5'"
                    />
                  </button>
                </div>
              </div>

              <div class="flex items-center justify-between">
                <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.connectedServers') }}</span>
                <button class="text-xs text-accent hover:underline" @click="mcp.refresh()">{{ $t('settings.reconnect') }}</button>
              </div>
              <div v-if="mcp.servers.length" class="rounded-lg border border-border divide-y divide-border overflow-hidden">
                <div
                  v-for="s in mcp.servers"
                  :key="s.config.id"
                  class="flex items-center gap-2 px-3 py-2.5 hover:bg-bg-2 text-xs transition-colors"
                >
                  <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="mcpStatusLabel(s).cls" />
                  <span class="text-fg-1 shrink-0">{{ s.config.name }}</span>
                  <span
                    v-if="s.source === 'kb'"
                    class="text-[10px] px-1 rounded bg-accent/15 text-accent shrink-0"
                    :title="$t('settings.kbServerTitle')"
                  >KB</span>
                  <span class="text-fg-3 truncate flex-1" :title="s.config.url">
                    {{ mcpStatusLabel(s).label }}
                  </span>
                  <template v-if="s.source === 'global'">
                    <button
                      class="shrink-0"
                      :class="editMcpId === s.config.id ? 'text-accent' : 'text-fg-3 hover:text-fg-0'"
                      :title="$t('common.edit')"
                      @click="startEditMcp(s.config)"
                    >
                      <span class="codicon codicon-sm codicon-edit" />
                    </button>
                    <button
                      class="text-fg-3 hover:text-fg-0 shrink-0"
                      :title="s.config.enabled === false ? $t('settings.enable') : $t('settings.disable')"
                      @click="toggleMcpServer(s.config.id)"
                    >
                      <span
                        class="codicon codicon-sm"
                        :class="s.config.enabled === false ? 'codicon-circle-slash' : 'codicon-pass'"
                      />
                    </button>
                    <button class="text-fg-3 hover:text-removed shrink-0" :title="$t('common.delete')" @click="removeMcpServer(s.config.id)">
                      <span class="codicon codicon-sm codicon-trash" />
                    </button>
                  </template>
                </div>
              </div>
              <div v-else class="text-sm text-fg-3">{{ $t('settings.noGlobalServers') }}</div>

              <div>
                <div v-if="editMcpId" class="flex items-center gap-1.5 text-xs text-accent mb-1.5">
                  <span class="codicon codicon-sm codicon-edit" />
                  {{ $t('settings.editingServer', { name: mcpName || 'server' }) }}
                </div>
                <div class="space-y-2">
                  <input v-model="mcpName" class="input text-xs" :placeholder="$t('settings.namePlaceholder')" />
                  <input v-model="mcpUrl" class="input text-xs" :placeholder="$t('settings.urlPlaceholder')" />
                  <input v-model="mcpToken" type="password" class="input text-xs" :placeholder="$t('settings.tokenPlaceholder')" autocomplete="off" />
                  <div class="flex gap-2 pt-0.5">
                    <button class="btn text-xs" :disabled="!mcpUrl.trim()" @click="submitMcpServer">
                      {{ editMcpId ? $t('common.save') : $t('common.add') }}
                    </button>
                    <button v-if="editMcpId" class="btn text-xs" @click="resetMcpForm">{{ $t('common.cancel') }}</button>
                  </div>
                </div>
              </div>
              <p class="text-xs text-fg-3 leading-relaxed">
                {{ $t('settings.toolsHelp') }}
              </p>
            </div>

            <!-- ▸ Git & GitHub -->
            <div v-else-if="section === 'git'" class="space-y-4 max-w-md">
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
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
