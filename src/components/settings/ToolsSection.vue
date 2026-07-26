<script setup lang="ts">
/**
 * Settings → Tools.
 *
 * The main page answers one question — what can the agent reach right now — so
 * it lists only what is actually installed. Browsing the catalog, and reading
 * the tools inside a pack or a server, are sub-pages: a page that shows every
 * option at once stops showing the user their own setup.
 *
 * Three groups that do not overlap, because the previous layout offered two
 * unexplained "add" affordances:
 *   - Recommended — presets, installed by checkbox on the catalog page, and
 *     read-only here: their definition is ours, not the user's.
 *   - Your tools — one HTTP request each, written here or by the agent.
 *   - Tool servers — an external MCP program contributing a whole bundle.
 *
 * Keys live in their own group and are only ever typed by the user. The agent
 * can say WHICH key a tool needs (it writes `{{secret:id}}`) and where to get
 * it, but a value never passes through a conversation.
 */
import { ref, computed } from 'vue'
import { useSettingsStore, newProfileId } from '@/stores/settings'
import { useMcpStore } from '@/stores/mcp'
import { useToolsStore } from '@/stores/tools'
import { useUiStore } from '@/stores/ui'
import { sortedCatalog, CATALOG, type CatalogEntry } from '@/lib/toolCatalog'
import {
  normalizeHttpTool,
  sanitizeToolName,
  secretRefs,
  type HttpToolSpec,
  type HttpToolParam,
} from '@/lib/httpTools'
import { TOOLS } from '@/agent/tools'
import { t } from '@/i18n'

const store = useSettingsStore()
const mcp = useMcpStore()
const tools = useToolsStore()
const ui = useUiStore()

const catalogEntries = sortedCatalog()
const RESERVED = new Set(TOOLS.map((x) => x.name))

/* ── navigation ────────────────────────────────────────────────────────── */

type View = { name: 'main' } | { name: 'catalog' } | { name: 'entry'; id: string } | { name: 'server'; id: string }
const view = ref<View>({ name: 'main' })

function open(v: View): void {
  view.value = v
}
function back(): void {
  view.value = { name: 'main' }
}

/* ── recommended ───────────────────────────────────────────────────────── */

const installedEntries = computed(() => catalogEntries.filter((e) => tools.isInstalled(e.id)))

function toggleEntry(entry: CatalogEntry): void {
  if (tools.isInstalled(entry.id)) tools.uninstall(entry.id)
  else tools.install(entry.id)
}

/** The live server row an entry installed, when it installs one. */
function entryServer(entry: CatalogEntry) {
  return entry.server ? mcp.servers.find((s) => s.config.url === entry.server!.url) : undefined
}

function entryToolCount(entry: CatalogEntry): number {
  return entryServer(entry)?.tools.length ?? entry.tools?.length ?? 0
}

function entryStatus(entry: CatalogEntry): { label: string; cls: string } | null {
  const server = entryServer(entry)
  if (!server) return null
  if (server.status === 'ok') return { label: t('settings.status.nTools', { n: server.tools.length }), cls: 'text-added' }
  if (server.status === 'connecting') return { label: t('settings.status.connecting'), cls: 'text-fg-3' }
  if (server.status === 'off') return { label: t('settings.status.off'), cls: 'text-fg-3' }
  return { label: t('settings.catalogNotConnected'), cls: 'text-removed' }
}

/** Servers the user added by hand — the catalog's own are shown above instead,
 *  so no server appears twice and each list means one thing. */
const catalogServerUrls = computed(() => new Set(CATALOG.filter((e) => e.server).map((e) => e.server!.url)))
const ownServers = computed(() => mcp.servers.filter((s) => !catalogServerUrls.value.has(s.config.url)))

/* ── keys ──────────────────────────────────────────────────────────────── */

const SECRET_META = new Map(
  CATALOG.flatMap((e) => (e.secrets ?? []).map((s) => [s.id, { ...s, entry: e.id }] as const)),
)

/** Every key the installed tools actually reference — catalog packs and
 *  agent-written tools alike, so a tool the agent just made has somewhere for
 *  its key to go. */
const requiredKeys = computed(() => {
  const ids = new Set(tools.specs.flatMap((s) => secretRefs(s)))
  return [...ids].map((id) => SECRET_META.get(id) ?? { id, label: id, plain: false, url: undefined })
})

function secretValue(id: string): string {
  return store.state.toolSecrets[id] ?? ''
}
function onSecretInput(id: string, e: Event): void {
  tools.setSecret(id, (e.target as HTMLInputElement).value.trim())
}

/* ── your tools ────────────────────────────────────────────────────────── */

type ParamRow = { key: string } & HttpToolParam

const editorOpen = ref(false)
const editingId = ref<string | null>(null)
const form = ref({
  name: '',
  description: '',
  method: 'GET' as HttpToolSpec['request']['method'],
  url: '',
  headers: '',
  body: '',
  mode: 'text' as 'text' | 'json' | 'xml',
  pick: '',
  template: '',
  transport: 'auto' as 'auto' | 'direct' | 'webcli',
})
const params = ref<ParamRow[]>([])
const testArgs = ref<Record<string, string>>({})
const testOutput = ref('')
const testing = ref(false)

/** Hand the request to the agent instead of the form. It lands in the composer
 *  as an editable draft, so the user still decides what gets asked. */
function askAgent(): void {
  ui.pendingPrompt = t('settings.agentToolPrompt')
  ui.settingsOpen = false
}

const nameTaken = computed(() => {
  const name = sanitizeToolName(form.value.name)
  if (!name) return false
  if (RESERVED.has(name)) return true
  return tools.specs.some((s) => s.name === name && s.id !== editingId.value)
})

/** Headers are edited as `Name: value` lines — a kv table for two entries is
 *  more chrome than content. */
function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}
function formatHeaderLines(headers: Record<string, string> | undefined): string {
  return Object.entries(headers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

/** The draft as a spec, or null when it can't run (bad name / origin). */
const draftSpec = computed<HttpToolSpec | null>(() =>
  normalizeHttpTool(
    {
      id: editingId.value ?? undefined,
      name: form.value.name,
      description: form.value.description,
      params: Object.fromEntries(
        params.value
          .filter((p) => p.key.trim())
          .map((p) => [
            p.key.trim(),
            {
              type: p.type,
              ...(p.description ? { description: p.description } : {}),
              ...(p.required ? { required: true } : {}),
              ...(p.default !== undefined && p.default !== '' ? { default: p.default } : {}),
            },
          ]),
      ),
      request: {
        method: form.value.method,
        url: form.value.url,
        headers: parseHeaderLines(form.value.headers),
        ...(form.value.body ? { body: form.value.body } : {}),
      },
      response: {
        mode: form.value.mode,
        ...(form.value.pick ? { pick: form.value.pick } : {}),
        ...(form.value.template ? { template: form.value.template } : {}),
      },
      transport: form.value.transport,
    },
    newProfileId,
  ),
)

const draftSecrets = computed(() => (draftSpec.value ? secretRefs(draftSpec.value) : []))

function resetEditor(): void {
  editorOpen.value = false
  editingId.value = null
  params.value = []
  testArgs.value = {}
  testOutput.value = ''
  form.value = {
    name: '',
    description: '',
    method: 'GET',
    url: '',
    headers: '',
    body: '',
    mode: 'text',
    pick: '',
    template: '',
    transport: 'auto',
  }
}

function newTool(): void {
  resetEditor()
  editorOpen.value = true
}

function editTool(spec: HttpToolSpec): void {
  resetEditor()
  editorOpen.value = true
  editingId.value = spec.id
  form.value = {
    name: spec.name,
    description: spec.description,
    method: spec.request.method,
    url: spec.request.url,
    headers: formatHeaderLines(spec.request.headers),
    body: spec.request.body ?? '',
    mode: spec.response.mode,
    pick: spec.response.pick ?? '',
    template: spec.response.template ?? '',
    transport: spec.transport ?? 'auto',
  }
  params.value = Object.entries(spec.params).map(([key, p]) => ({ key, ...p }))
}

function addParam(): void {
  params.value.push({ key: '', type: 'string' })
}
function removeParam(i: number): void {
  params.value.splice(i, 1)
}

function saveTool(): void {
  const spec = draftSpec.value
  if (!spec || nameTaken.value) return
  const list = store.state.httpTools.filter((s) => s.id !== spec.id)
  store.state.httpTools = [...list, spec]
  resetEditor()
}

function removeTool(id: string): void {
  store.state.httpTools = store.state.httpTools.filter((s) => s.id !== id)
  if (editingId.value === id) resetEditor()
}

async function runTest(): Promise<void> {
  const spec = draftSpec.value
  if (!spec) return
  testing.value = true
  testOutput.value = ''
  try {
    testOutput.value = await tools.test(spec, { ...testArgs.value })
  } catch (err) {
    testOutput.value = `Error: ${(err as Error).message}`
  } finally {
    testing.value = false
  }
}

/* ── tool servers ──────────────────────────────────────────────────────── */

const serverFormOpen = ref(false)
const mcpName = ref('')
const mcpUrl = ref('')
const mcpToken = ref('')
const editMcpId = ref<string | null>(null)

function resetMcpForm(): void {
  serverFormOpen.value = false
  editMcpId.value = null
  mcpName.value = ''
  mcpUrl.value = ''
  mcpToken.value = ''
}

function newServer(): void {
  resetMcpForm()
  serverFormOpen.value = true
}

function startEditMcp(s: { id: string; name: string; url: string; token?: string }): void {
  serverFormOpen.value = true
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

/* ── detail sub-page ───────────────────────────────────────────────────── */

const detailEntry = computed(() => {
  const v = view.value
  return v.name === 'entry' ? catalogEntries.find((e) => e.id === v.id) : undefined
})
const detailServer = computed(() => {
  const v = view.value
  if (v.name === 'server') return mcp.servers.find((s) => s.config.id === v.id)
  if (detailEntry.value) return entryServer(detailEntry.value)
  return undefined
})

/** The tools a detail page lists: an MCP server's live list, or a pack's specs. */
const detailTools = computed<Array<{ name: string; description: string }>>(() => {
  if (detailServer.value) {
    return detailServer.value.tools.map((d) => ({ name: d.name, description: d.description }))
  }
  return (detailEntry.value?.tools ?? []).map((s) => ({ name: s.name, description: s.description }))
})

const detailTitle = computed(() => {
  if (detailEntry.value) return t(`settings.catalog.${detailEntry.value.id}.title`)
  return detailServer.value?.config.name ?? ''
})

/** A catalog server still needs the two fields only the user can supply. */
const detailServerConfig = computed(() =>
  detailServer.value ? store.state.mcpServers.find((s) => s.id === detailServer.value!.config.id) : undefined,
)
</script>

<template>
  <!-- ═══ Recommended catalog (sub-page) ═══ -->
  <div v-if="view.name === 'catalog'" class="space-y-4">
    <button class="flex items-center gap-1 text-xs text-fg-3 hover:text-fg-0" @click="back">
      <span class="codicon codicon-sm codicon-arrow-left" />{{ $t('settings.backToTools') }}
    </button>
    <p class="text-xs text-fg-3 leading-relaxed">{{ $t('settings.recommendedDesc') }}</p>

    <div class="rounded-lg border border-border divide-y divide-border overflow-hidden">
      <div v-for="e in catalogEntries" :key="e.id" class="px-3 py-3">
        <div class="flex items-start gap-2.5">
          <button
            type="button"
            role="checkbox"
            :aria-checked="tools.isInstalled(e.id)"
            class="shrink-0 mt-0.5"
            @click="toggleEntry(e)"
          >
            <span
              class="codicon codicon-sm"
              :class="
                tools.isInstalled(e.id)
                  ? 'codicon-pass-filled text-accent'
                  : 'codicon-circle-large-outline text-fg-3'
              "
            />
          </button>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-sm text-fg-1">{{ $t(`settings.catalog.${e.id}.title`) }}</span>
              <span v-if="e.featured" class="text-[10px] px-1 rounded bg-accent/15 text-accent">
                {{ $t('settings.catalogFeatured') }}
              </span>
              <span
                v-if="e.requiresWebcli"
                class="text-[10px] px-1 rounded"
                :class="tools.webcliConnected ? 'bg-bg-3 text-fg-3' : 'bg-removed/15 text-removed'"
              >{{ $t('settings.catalogNeedsWebcli') }}</span>
            </div>
            <p class="text-xs text-fg-3 mt-0.5 leading-relaxed">
              {{ $t(`settings.catalog.${e.id}.desc`) }}
            </p>
            <a
              v-if="e.homepage"
              :href="e.homepage"
              target="_blank"
              rel="noopener"
              class="inline-block text-xs text-accent hover:underline mt-1.5"
            >{{ $t('settings.catalogLearnMore') }}</a>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ═══ Detail: what's inside a pack or a server (sub-page) ═══ -->
  <div v-else-if="view.name === 'entry' || view.name === 'server'" class="space-y-4">
    <button class="flex items-center gap-1 text-xs text-fg-3 hover:text-fg-0" @click="back">
      <span class="codicon codicon-sm codicon-arrow-left" />{{ $t('settings.backToTools') }}
    </button>
    <div>
      <div class="text-sm text-fg-1">{{ detailTitle }}</div>
      <p v-if="detailEntry" class="text-xs text-fg-3 mt-0.5 leading-relaxed">
        {{ $t(`settings.catalog.${detailEntry.id}.desc`) }}
      </p>
      <p v-else-if="detailServer" class="text-xs text-fg-3 mt-0.5 font-mono break-all">
        {{ detailServer.config.url }}
      </p>
    </div>

    <!-- The only fields a preset leaves to the user. -->
    <div v-if="detailEntry?.server && detailServerConfig" class="space-y-2">
      <label class="block text-xs uppercase tracking-wide text-fg-3">
        {{ detailEntry.kind === 'extension' ? $t('settings.extensionId') : $t('settings.serverUrl') }}
      </label>
      <input v-model="detailServerConfig.url" class="input text-xs font-mono" />
      <input
        v-model="detailServerConfig.token"
        type="password"
        class="input text-xs"
        :placeholder="$t('settings.tokenPlaceholder')"
        autocomplete="off"
      />
      <p class="text-xs text-fg-3 leading-relaxed">{{ $t('settings.presetLockedHint') }}</p>
    </div>

    <div v-if="detailServer && detailServer.status === 'error'" class="text-xs text-removed">
      {{ detailServer.error }}
    </div>

    <div>
      <span class="text-xs uppercase tracking-wide text-fg-3">
        {{ $t('settings.status.nTools', { n: detailTools.length }) }}
      </span>
      <div v-if="detailTools.length" class="mt-1.5 rounded-lg border border-border divide-y divide-border overflow-hidden">
        <div v-for="d in detailTools" :key="d.name" class="px-3 py-2">
          <div class="font-mono text-xs text-fg-1">{{ d.name }}</div>
          <p class="text-xs text-fg-3 mt-0.5 leading-relaxed line-clamp-3">{{ d.description }}</p>
        </div>
      </div>
      <p v-else class="mt-1.5 text-xs text-fg-3">{{ $t('settings.noToolsHere') }}</p>
    </div>
  </div>

  <!-- ═══ Main ═══ -->
  <div v-else class="space-y-5">
    <!-- ▸ Recommended, installed only -->
    <div class="flex items-center justify-between">
      <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.recommended') }}</span>
      <button class="text-xs text-accent hover:underline" @click="open({ name: 'catalog' })">
        {{ $t('settings.browseAll') }}
      </button>
    </div>
    <div v-if="installedEntries.length" class="rounded-lg border border-border divide-y divide-border overflow-hidden">
      <button
        v-for="e in installedEntries"
        :key="e.id"
        class="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-bg-2 text-left transition-colors"
        @click="open({ name: 'entry', id: e.id })"
      >
        <span class="text-sm text-fg-1 shrink-0">{{ $t(`settings.catalog.${e.id}.title`) }}</span>
        <span
          v-if="entryStatus(e)"
          class="text-[10px] shrink-0"
          :class="entryStatus(e)!.cls"
        >{{ entryStatus(e)!.label }}</span>
        <span v-else class="text-[10px] text-fg-3 shrink-0">
          {{ $t('settings.status.nTools', { n: entryToolCount(e) }) }}
        </span>
        <span class="flex-1" />
        <span class="codicon codicon-sm codicon-chevron-right text-fg-3 shrink-0" />
      </button>
    </div>
    <p v-else class="text-sm text-fg-3">{{ $t('settings.noneInstalled') }}</p>

    <!-- ▸ Tools the KB carries, awaiting approval -->
    <div v-if="tools.kbPending.length" class="rounded-lg border border-accent/40 bg-accent/5 px-3 py-3 space-y-2">
      <div class="text-sm text-fg-1">{{ $t('settings.kbToolsTitle') }}</div>
      <p class="text-xs text-fg-3 leading-relaxed">{{ $t('settings.kbToolsDesc') }}</p>
      <ul class="text-xs font-mono text-fg-2 space-y-0.5">
        <li v-for="s in tools.kbPending" :key="s.id">{{ s.name }} → {{ s.request.url }}</li>
      </ul>
      <button class="btn text-xs" @click="tools.trustKbTools()">{{ $t('settings.kbToolsApprove') }}</button>
    </div>

    <!-- ▸ Your tools -->
    <div>
      <div class="flex items-center justify-between">
        <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.customTools') }}</span>
        <div v-if="!editorOpen" class="flex items-center gap-3">
          <button class="text-xs text-accent hover:underline" @click="askAgent">
            {{ $t('settings.askAgent') }}
          </button>
          <button class="text-xs text-fg-3 hover:text-fg-0" @click="newTool">
            {{ $t('settings.addManually') }}
          </button>
        </div>
      </div>
      <p class="mt-1 text-xs text-fg-3 leading-relaxed">{{ $t('settings.customToolsDesc') }}</p>
    </div>

    <div
      v-if="store.state.httpTools.length"
      class="rounded-lg border border-border divide-y divide-border overflow-hidden"
    >
      <div
        v-for="s in store.state.httpTools"
        :key="s.id"
        class="group flex items-center gap-2 px-3 py-2.5 hover:bg-bg-2 text-xs transition-colors"
      >
        <span class="font-mono text-fg-1 shrink-0">{{ s.name }}</span>
        <span class="text-fg-3 truncate flex-1" :title="s.request.url">{{ s.request.url }}</span>
        <button
          class="text-fg-3 hover:text-fg-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          :title="$t('common.edit')"
          @click="editTool(s)"
        >
          <span class="codicon codicon-sm codicon-edit" />
        </button>
        <button
          class="text-fg-3 hover:text-removed shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          :title="$t('common.delete')"
          @click="removeTool(s.id)"
        >
          <span class="codicon codicon-sm codicon-trash" />
        </button>
      </div>
    </div>

    <!-- ▸ Custom tool editor -->
    <div v-if="editorOpen" class="rounded-lg border border-border px-3 py-3 space-y-3">
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-xs text-fg-3 mb-1">{{ $t('settings.toolName') }}</label>
          <input v-model="form.name" class="input text-xs font-mono" placeholder="openalex_search" />
        </div>
        <div>
          <label class="block text-xs text-fg-3 mb-1">{{ $t('settings.toolTransport') }}</label>
          <select v-model="form.transport" class="input text-xs">
            <option value="auto">{{ $t('settings.transportAuto') }}</option>
            <option value="direct">{{ $t('settings.transportDirect') }}</option>
            <option value="webcli">{{ $t('settings.transportWebcli') }}</option>
          </select>
        </div>
      </div>
      <p v-if="nameTaken" class="text-xs text-removed">{{ $t('settings.toolNameTaken') }}</p>

      <div>
        <label class="block text-xs text-fg-3 mb-1">{{ $t('settings.toolDescription') }}</label>
        <textarea
          v-model="form.description"
          rows="2"
          class="input text-xs"
          :placeholder="$t('settings.toolDescriptionPlaceholder')"
        />
      </div>

      <div>
        <label class="block text-xs text-fg-3 mb-1">{{ $t('settings.toolUrl') }}</label>
        <div class="flex gap-2">
          <select v-model="form.method" class="input text-xs w-24 shrink-0">
            <option>GET</option>
            <option>POST</option>
            <option>PUT</option>
            <option>PATCH</option>
            <option>DELETE</option>
          </select>
          <input
            v-model="form.url"
            class="input text-xs font-mono flex-1"
            placeholder="https://api.example.com/search?q={{query}}"
          />
        </div>
        <p class="text-xs text-fg-3 mt-1 leading-relaxed">{{ $t('settings.toolUrlHelp') }}</p>
      </div>

      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-xs text-fg-3">{{ $t('settings.toolParams') }}</label>
          <button class="text-xs text-accent hover:underline" @click="addParam">
            {{ $t('settings.addParam') }}
          </button>
        </div>
        <div v-for="(p, i) in params" :key="i" class="flex gap-1.5 mb-1.5">
          <input v-model="p.key" class="input text-xs font-mono w-28 shrink-0" placeholder="query" />
          <select v-model="p.type" class="input text-xs w-24 shrink-0">
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
          </select>
          <input
            v-model="p.description"
            class="input text-xs flex-1"
            :placeholder="$t('settings.paramDescription')"
          />
          <button
            class="shrink-0 px-1"
            :class="p.required ? 'text-accent' : 'text-fg-3'"
            :title="$t('settings.paramRequired')"
            @click="p.required = !p.required"
          >
            <span class="codicon codicon-sm codicon-star-full" />
          </button>
          <button class="text-fg-3 hover:text-removed shrink-0 px-1" @click="removeParam(i)">
            <span class="codicon codicon-sm codicon-trash" />
          </button>
        </div>
      </div>

      <div>
        <label class="block text-xs text-fg-3 mb-1">{{ $t('settings.toolHeaders') }}</label>
        <textarea
          v-model="form.headers"
          rows="2"
          class="input text-xs font-mono"
          placeholder="Authorization: Bearer {{secret:my_key}}"
        />
      </div>

      <div v-if="form.method !== 'GET' && form.method !== 'DELETE'">
        <label class="block text-xs text-fg-3 mb-1">{{ $t('settings.toolBody') }}</label>
        <textarea v-model="form.body" rows="2" class="input text-xs font-mono" placeholder='{"q":"{{query}}"}' />
      </div>

      <div>
        <label class="block text-xs text-fg-3 mb-1">{{ $t('settings.toolResponse') }}</label>
        <div class="flex gap-2 mb-1.5">
          <select v-model="form.mode" class="input text-xs w-28 shrink-0">
            <option value="text">text</option>
            <option value="json">json</option>
            <option value="xml">xml</option>
          </select>
          <input
            v-if="form.mode !== 'text'"
            v-model="form.pick"
            class="input text-xs font-mono flex-1"
            placeholder="results[]"
          />
        </div>
        <input
          v-if="form.mode !== 'text'"
          v-model="form.template"
          class="input text-xs font-mono"
          placeholder="- {{title}} ({{year}}) {{url}}"
        />
        <p class="text-xs text-fg-3 mt-1 leading-relaxed">{{ $t('settings.toolResponseHelp') }}</p>
      </div>

      <p v-if="draftSecrets.length" class="text-xs text-fg-3">
        {{ $t('settings.toolSecretsNote', { ids: draftSecrets.join(', ') }) }}
      </p>

      <div class="border-t border-border pt-3 space-y-2">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs text-fg-3">{{ $t('settings.toolTest') }}</span>
          <input
            v-for="p in params.filter((x) => x.key.trim())"
            :key="p.key"
            v-model="testArgs[p.key.trim()]"
            class="input text-xs w-32"
            :placeholder="p.key.trim()"
          />
          <button class="btn text-xs" :disabled="!draftSpec || testing" @click="runTest">
            {{ testing ? $t('settings.toolTesting') : $t('settings.toolRunTest') }}
          </button>
        </div>
        <div v-if="testOutput" class="space-y-1">
          <div class="text-xs text-fg-3">
            {{ $t('settings.toolTestChars', { n: testOutput.length }) }}
          </div>
          <pre class="text-[11px] font-mono bg-bg-2 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap">{{ testOutput }}</pre>
        </div>
      </div>

      <div class="flex gap-2">
        <button class="btn text-xs" :disabled="!draftSpec || nameTaken" @click="saveTool">
          {{ $t('common.save') }}
        </button>
        <button class="btn text-xs" @click="resetEditor">{{ $t('common.cancel') }}</button>
        <span v-if="!draftSpec" class="text-xs text-removed self-center">{{ $t('settings.toolInvalid') }}</span>
      </div>
    </div>

    <!-- ▸ Tool servers (user-added) -->
    <div>
      <div class="flex items-center justify-between">
        <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.connectedServers') }}</span>
        <button v-if="!serverFormOpen" class="text-xs text-accent hover:underline" @click="newServer">
          {{ $t('settings.addServer') }}
        </button>
      </div>
      <p class="mt-1 text-xs text-fg-3 leading-relaxed">{{ $t('settings.serversDesc') }}</p>
    </div>

    <div v-if="ownServers.length" class="rounded-lg border border-border divide-y divide-border overflow-hidden">
      <div
        v-for="s in ownServers"
        :key="s.config.id"
        class="group flex items-center gap-2 px-3 py-2.5 hover:bg-bg-2 text-xs transition-colors"
      >
        <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="mcpStatusLabel(s).cls" />
        <button class="text-fg-1 shrink-0 hover:underline" @click="open({ name: 'server', id: s.config.id })">
          {{ s.config.name }}
        </button>
        <span
          v-if="s.source === 'kb'"
          class="text-[10px] px-1 rounded bg-accent/15 text-accent shrink-0"
          :title="$t('settings.kbServerTitle')"
        >KB</span>
        <span class="text-fg-3 truncate flex-1" :title="s.config.url">{{ mcpStatusLabel(s).label }}</span>
        <template v-if="s.source === 'global'">
          <button
            class="text-fg-3 hover:text-fg-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            :title="$t('settings.reconnect')"
            @click="mcp.refresh()"
          >
            <span class="codicon codicon-sm codicon-refresh" />
          </button>
          <button
            class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            :class="editMcpId === s.config.id ? 'text-accent' : 'text-fg-3 hover:text-fg-0'"
            :title="$t('common.edit')"
            @click="startEditMcp(s.config)"
          >
            <span class="codicon codicon-sm codicon-edit" />
          </button>
          <button
            class="text-fg-3 hover:text-fg-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            :title="s.config.enabled === false ? $t('settings.enable') : $t('settings.disable')"
            @click="toggleMcpServer(s.config.id)"
          >
            <span
              class="codicon codicon-sm"
              :class="s.config.enabled === false ? 'codicon-circle-slash' : 'codicon-pass'"
            />
          </button>
          <button
            class="text-fg-3 hover:text-removed shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            :title="$t('common.delete')"
            @click="removeMcpServer(s.config.id)"
          >
            <span class="codicon codicon-sm codicon-trash" />
          </button>
        </template>
      </div>
    </div>
    <p v-else-if="!serverFormOpen" class="text-sm text-fg-3">{{ $t('settings.noGlobalServers') }}</p>

    <div v-if="serverFormOpen" class="rounded-lg border border-border px-3 py-3 space-y-2">
      <div v-if="editMcpId" class="flex items-center gap-1.5 text-xs text-accent">
        <span class="codicon codicon-sm codicon-edit" />
        {{ $t('settings.editingServer', { name: mcpName || 'server' }) }}
      </div>
      <input v-model="mcpName" class="input text-xs" :placeholder="$t('settings.namePlaceholder')" />
      <input v-model="mcpUrl" class="input text-xs font-mono" :placeholder="$t('settings.urlPlaceholder')" />
      <input
        v-model="mcpToken"
        type="password"
        class="input text-xs"
        :placeholder="$t('settings.tokenPlaceholder')"
        autocomplete="off"
      />
      <div class="flex gap-2 pt-0.5">
        <button class="btn text-xs" :disabled="!mcpUrl.trim()" @click="submitMcpServer">
          {{ editMcpId ? $t('common.save') : $t('common.add') }}
        </button>
        <button class="btn text-xs" @click="resetMcpForm">{{ $t('common.cancel') }}</button>
      </div>
      <p class="text-xs text-fg-3 leading-relaxed">{{ $t('settings.toolsHelp') }}</p>
    </div>

    <!-- ▸ Keys -->
    <div v-if="requiredKeys.length">
      <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.keys') }}</span>
      <p class="mt-1 mb-2 text-xs text-fg-3 leading-relaxed">{{ $t('settings.keysDesc') }}</p>
      <div class="space-y-1.5">
        <div v-for="k in requiredKeys" :key="k.id" class="flex items-center gap-2">
          <label class="text-xs text-fg-3 w-32 shrink-0 truncate" :title="k.id">{{ k.label }}</label>
          <input
            :type="k.plain ? 'text' : 'password'"
            class="input text-xs flex-1"
            autocomplete="off"
            :value="secretValue(k.id)"
            :placeholder="k.id"
            @input="onSecretInput(k.id, $event)"
          />
          <a
            v-if="k.url"
            :href="k.url"
            target="_blank"
            rel="noopener"
            class="text-xs text-accent hover:underline shrink-0"
          >{{ $t('settings.getKey') }}</a>
        </div>
      </div>
    </div>
  </div>
</template>
