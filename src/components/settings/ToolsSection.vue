<script setup lang="ts">
/**
 * Settings → Tools. Three groups, in the order a new user needs them:
 *
 *   1. Recommended — the verified catalog, checked on or off. WebCLI leads it
 *      because installing the extension is what lets every other tool reach an
 *      endpoint that refuses browsers.
 *   2. Your tools — hand-written HTTP tools, with a Test button that runs the
 *      draft for real. A tool you can't try before saving is a tool you find
 *      out about mid-conversation.
 *   3. Tool servers — the MCP list (moved here verbatim from SettingsModal).
 *
 * Tools the open KB carries in .agents/tools.json appear above the list and
 * stay inert until approved: they arrived with the folder, not from this user.
 */
import { ref, computed } from 'vue'
import { useSettingsStore, newProfileId } from '@/stores/settings'
import { useMcpStore } from '@/stores/mcp'
import { useToolsStore } from '@/stores/tools'
import { sortedCatalog, type CatalogEntry } from '@/lib/toolCatalog'
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

const catalogEntries = sortedCatalog()
const RESERVED = new Set(TOOLS.map((x) => x.name))

/* ── recommended catalog ───────────────────────────────────────────────── */

function toggleEntry(entry: CatalogEntry): void {
  if (tools.isInstalled(entry.id)) tools.uninstall(entry.id)
  else tools.install(entry.id)
}

/** For entries that install a server row, the live connection state. */
function entryServer(entry: CatalogEntry) {
  return entry.server ? mcp.servers.find((s) => s.config.url === entry.server!.url) : undefined
}

function entryStatus(entry: CatalogEntry): { label: string; cls: string } | null {
  if (!tools.isInstalled(entry.id)) return null
  const server = entryServer(entry)
  if (!server) {
    const n = entry.tools?.length ?? 0
    return { label: t('settings.status.nTools', { n }), cls: 'text-fg-3' }
  }
  if (server.status === 'ok') {
    return { label: t('settings.status.nTools', { n: server.tools.length }), cls: 'text-added' }
  }
  if (server.status === 'connecting') return { label: t('settings.status.connecting'), cls: 'text-fg-3' }
  if (server.status === 'off') return { label: t('settings.status.off'), cls: 'text-fg-3' }
  return { label: t('settings.catalogNotConnected'), cls: 'text-removed' }
}

function secretValue(id: string): string {
  return store.state.toolSecrets[id] ?? ''
}
function onSecretInput(id: string, e: Event): void {
  tools.setSecret(id, (e.target as HTMLInputElement).value.trim())
}

/* ── custom tools ──────────────────────────────────────────────────────── */

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

/* ── MCP servers ───────────────────────────────────────────────────────── */

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
</script>

<template>
  <div class="space-y-5">
    <!-- ▸ Recommended -->
    <div>
      <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.recommended') }}</span>
      <p class="mt-1 text-xs text-fg-3 leading-relaxed">{{ $t('settings.recommendedDesc') }}</p>
    </div>
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
              <span
                v-if="e.featured"
                class="text-[10px] px-1 rounded bg-accent/15 text-accent"
              >{{ $t('settings.catalogFeatured') }}</span>
              <span
                v-if="e.requiresWebcli"
                class="text-[10px] px-1 rounded"
                :class="tools.webcliConnected ? 'bg-bg-3 text-fg-3' : 'bg-removed/15 text-removed'"
              >{{ $t('settings.catalogNeedsWebcli') }}</span>
              <span
                v-if="entryStatus(e)"
                class="text-[10px]"
                :class="entryStatus(e)!.cls"
              >{{ entryStatus(e)!.label }}</span>
            </div>
            <p class="text-xs text-fg-3 mt-0.5 leading-relaxed">
              {{ $t(`settings.catalog.${e.id}.desc`) }}
            </p>

            <!-- An extension is installed here but has to exist in Chrome too. -->
            <p
              v-if="tools.isInstalled(e.id) && e.kind === 'extension' && entryServer(e)?.status === 'error'"
              class="text-xs text-fg-3 mt-1.5 leading-relaxed"
            >
              {{ $t('settings.catalogExtensionHint') }}
            </p>

            <!-- Keys the entry needs before its tools work. -->
            <div v-if="tools.isInstalled(e.id) && e.secrets?.length" class="mt-2 space-y-1.5">
              <div v-for="s in e.secrets" :key="s.id" class="flex items-center gap-2">
                <label class="text-xs text-fg-3 w-20 shrink-0">{{ s.label }}</label>
                <input
                  :type="s.plain ? 'text' : 'password'"
                  class="input text-xs flex-1"
                  autocomplete="off"
                  :value="secretValue(s.id)"
                  :placeholder="s.label"
                  @input="onSecretInput(s.id, $event)"
                />
              </div>
            </div>

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

    <!-- ▸ Tools this KB carries, awaiting approval -->
    <div v-if="tools.kbPending.length" class="rounded-lg border border-accent/40 bg-accent/5 px-3 py-3 space-y-2">
      <div class="text-sm text-fg-1">{{ $t('settings.kbToolsTitle') }}</div>
      <p class="text-xs text-fg-3 leading-relaxed">{{ $t('settings.kbToolsDesc') }}</p>
      <ul class="text-xs font-mono text-fg-2 space-y-0.5">
        <li v-for="s in tools.kbPending" :key="s.id">{{ s.name }} → {{ s.request.url }}</li>
      </ul>
      <button class="btn text-xs" @click="tools.trustKbTools()">{{ $t('settings.kbToolsApprove') }}</button>
    </div>

    <!-- ▸ Custom tools -->
    <div class="flex items-center justify-between">
      <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.customTools') }}</span>
      <button v-if="!editorOpen" class="text-xs text-accent hover:underline" @click="newTool">
        {{ $t('settings.newTool') }}
      </button>
    </div>
    <div
      v-if="store.state.httpTools.length"
      class="rounded-lg border border-border divide-y divide-border overflow-hidden"
    >
      <div
        v-for="s in store.state.httpTools"
        :key="s.id"
        class="flex items-center gap-2 px-3 py-2.5 hover:bg-bg-2 text-xs transition-colors"
      >
        <span class="font-mono text-fg-1 shrink-0">{{ s.name }}</span>
        <span class="text-fg-3 truncate flex-1" :title="s.request.url">{{ s.request.url }}</span>
        <button class="text-fg-3 hover:text-fg-0 shrink-0" :title="$t('common.edit')" @click="editTool(s)">
          <span class="codicon codicon-sm codicon-edit" />
        </button>
        <button class="text-fg-3 hover:text-removed shrink-0" :title="$t('common.delete')" @click="removeTool(s.id)">
          <span class="codicon codicon-sm codicon-trash" />
        </button>
      </div>
    </div>
    <p v-else-if="!editorOpen" class="text-sm text-fg-3">{{ $t('settings.noCustomTools') }}</p>

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

      <!-- Parameters -->
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

      <!-- Response shaping — the difference between 200 tokens and 20,000. -->
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

      <!-- Test -->
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

    <!-- ▸ MCP servers -->
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
</template>
