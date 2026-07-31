<script setup lang="ts">
/**
 * Settings → Tools.
 *
 * The main page answers one question — what can the agent reach right now — so
 * everything installed sits in ONE list, one integration per row, whoever
 * provided it. Two small tags carry what used to be three top-level groups:
 *   - source (Preset / Yours / KB) — who defined it, the only axis that is
 *     true of every row
 *   - kind (MCP / Extension) — present only on rows backed by a live
 *     connection, because that is exactly where "is it up?" is a question
 * A row with no kind tag is a set of HTTP requests: nothing to connect to, so
 * its tool count is a fact about the config rather than a status. That is why
 * only live rows get a status dot and a colour — the previous layout coloured
 * some counts green and others grey with nothing naming the difference.
 *
 * Everything with a body of its own is a sub-page: the catalog, what is inside
 * a pack or a server, the tools in a group, and both editors. Main stays a
 * list plus two doors — describe the goal to the agent, or browse recommended.
 * Writing an HTTP tool by hand and adding an MCP server are the same act at a
 * lower level, so both sit behind Advanced.
 *
 * Keys live in their own group and are only ever typed by the user. The agent
 * can say WHICH key a tool needs (it writes `{{secret:id}}`) and where to get
 * it, but a value never passes through a conversation.
 */
import { ref, computed, watch, nextTick } from 'vue'
import { useSettingsStore, newProfileId } from '@/stores/settings'
import { useMcpStore } from '@/stores/mcp'
import { useToolsStore } from '@/stores/tools'
import { useUiStore } from '@/stores/ui'
import { sortedCatalog, CATALOG, type CatalogEntry } from '@/lib/toolCatalog'
import { isWebcliRelayUrl } from '@/lib/webcliRelay'
import {
  normalizeHttpTool,
  sanitizeToolName,
  secretRefs,
  groupByBundle,
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

type View =
  | { name: 'main' }
  | { name: 'catalog' }
  | { name: 'entry'; id: string }
  | { name: 'server'; id: string }
  | { name: 'group'; key: string }
  | { name: 'editor' }
  | { name: 'serverForm' }

const view = ref<View>({ name: 'main' })
/** Where an editor returns to — it can be opened from main or from a detail
 *  page, and landing somewhere else than you came from reads as a bug. */
const returnTo = ref<View>({ name: 'main' })

function open(v: View): void {
  view.value = v
}
function back(): void {
  view.value = { name: 'main' }
}

/**
 * The settings pane scrolls, and every view of this section renders into that
 * one container — so without this, opening a sub-page from halfway down the
 * list starts you halfway down the sub-page, and coming back loses your place
 * in the list.
 *
 * A watcher rather than a call in each navigation helper: there are eight ways
 * to change `view` (open, back, the editors' open/close, remove…) and one of
 * them would eventually be missed. Vue's default 'pre' flush runs this before
 * the re-render, so `scrollTop` is still the outgoing view's position here.
 */
const rootEl = ref<HTMLElement | null>(null)
const mainScroll = ref(0)

function scroller(): HTMLElement | null {
  return rootEl.value?.closest('.panel-scroll') ?? null
}

watch(view, (to, from) => {
  checkState.value = 'idle' // a verdict belongs to the page it was produced on
  const el = scroller()
  if (!el) return
  if (from.name === 'main' && to.name !== 'main') mainScroll.value = el.scrollTop
  const target = to.name === 'main' ? mainScroll.value : 0
  void nextTick(() => {
    const after = scroller()
    if (after) after.scrollTop = target
  })
})

/* ── recommended ───────────────────────────────────────────────────────── */

const installedEntries = computed(() => catalogEntries.filter((e) => tools.isInstalled(e.id)))

/** Which entry we are probing right after it was checked on. */
const checkingEntry = ref<string | null>(null)

/** How long that probe may hold the checkbox busy before we hand the user the
 *  page instead. */
const PROBE_MS = 4_000

/** Minimum time a check stays visibly in progress, so the click is perceivable
 *  even when the answer arrives in one frame. */
const MIN_CHECK_MS = 450

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Resolve once this entry's row has a verdict, or PROBE_MS has passed. */
async function settled(entry: CatalogEntry): Promise<void> {
  const until = Date.now() + PROBE_MS
  while (Date.now() < until) {
    const status = entryServer(entry)?.status
    if (status && status !== 'connecting') return
    await wait(100)
  }
}

/**
 * Checking a box installs the entry. For an extension that is only half the job —
 * it also needs permission inside Chrome — so probe immediately and, when it
 * cannot answer, go straight to the page that explains why. Leaving the user to
 * discover "Setup needed" on their way back makes the app look like it worked.
 */
async function toggleEntry(entry: CatalogEntry): Promise<void> {
  if (tools.isInstalled(entry.id)) {
    tools.uninstall(entry.id)
    return
  }
  tools.install(entry.id)
  if (entry.kind !== 'extension' || !entry.server) return
  checkingEntry.value = entry.id
  try {
    mcp.recheckRelay()
    // No marker means it provably cannot answer — don't spend a handshake (or the
    // user's patience) proving it.
    //
    // With a marker: installing already triggers a reconnect, so wait for THIS row
    // to settle rather than forcing a second refresh — a refresh rebuilds every
    // client, which would cut off a tool call the agent has in flight on another
    // server. Bounded, because a refused origin answers with silence and a
    // checkbox that sits busy for 15s is worse than a page that says what is
    // wrong and then turns green by itself.
    if (mcp.relayReady) await settled(entry)
  } finally {
    checkingEntry.value = null
  }
  // Only steer someone who is still standing where they clicked.
  if (view.value.name !== 'catalog') return
  if (entryServer(entry)?.status !== 'ok') open({ name: 'entry', id: entry.id })
}

/** The live server row an entry installed, when it installs one. */
function entryServer(entry: CatalogEntry) {
  return entry.server ? mcp.servers.find((s) => s.config.url === entry.server!.url) : undefined
}

/** Servers the user added by hand — the catalog's own are shown as their entry
 *  instead, so no server appears twice and each row means one integration. */
const catalogServerUrls = computed(() => new Set(CATALOG.filter((e) => e.server).map((e) => e.server!.url)))
const ownServers = computed(() => mcp.servers.filter((s) => !catalogServerUrls.value.has(s.config.url)))

/* ── the installed list ────────────────────────────────────────────────── */

type Source = 'preset' | 'yours' | 'kb'

interface InstalledRow {
  key: string
  title: string
  source: Source
  /** 'mcp' | 'extension' when a live connection backs this row, else null. */
  kind: 'mcp' | 'extension' | null
  label: string
  labelCls: string
  /** Status dot, live rows only. */
  dotCls: string | null
  target: View
}

/** One connection's state as a row reads it. Shared by catalog-installed
 *  servers and hand-added ones so the same state never renders two ways. */
function liveStatus(s: (typeof mcp.servers)[number] | undefined): {
  label: string
  labelCls: string
  dotCls: string
} {
  if (!s) return { label: t('settings.catalogNotConnected'), labelCls: 'text-removed', dotCls: 'bg-removed' }
  if (s.status === 'off') return { label: t('settings.status.off'), labelCls: 'text-fg-3', dotCls: 'bg-fg-3' }
  if (s.status === 'connecting')
    return { label: t('settings.status.connecting'), labelCls: 'text-fg-3', dotCls: 'bg-fg-3' }
  if (s.status === 'error')
    return {
      label: s.error?.slice(0, 60) ?? t('settings.status.failed'),
      labelCls: 'text-removed',
      dotCls: 'bg-removed',
    }
  return {
    label: nTools(s.tools.length),
    labelCls: 'text-added',
    dotCls: 'bg-added',
  }
}

/** A count that is a fact about the config, not a connection — no dot, no
 *  colour, so green never has to mean two different things. */
function staticCount(n: number): { label: string; labelCls: string; dotCls: null } {
  return { label: nTools(n), labelCls: 'text-fg-3', dotCls: null }
}

/** How a catalog entry's row reads. WebCLI gets the one override: every way it
 *  can fail is an unfinished permission (no relay on the page, or a relay whose
 *  extension won't answer this address), and the fix is on its detail page — so
 *  the row says that in two words instead of spending 60 characters on a sentence
 *  the user cannot act on from here. */
function entryStatus(e: CatalogEntry): { label: string; labelCls: string; dotCls: string | null } {
  if (!e.server) return staticCount(e.tools?.length ?? 0)
  const server = entryServer(e)
  if (isWebcliRelayUrl(e.server.url) && (!server || server.status === 'error')) {
    return {
      label: t('settings.webcli.setupNeeded'),
      labelCls: 'text-removed',
      dotCls: 'bg-removed',
    }
  }
  return liveStatus(server)
}

/** The user's own tools plus the open KB's approved set, grouped by
 *  integration — an integration the agent built is one row, not eight. */
const yourGroups = computed(() => groupByBundle([...store.state.httpTools, ...tools.kbActive]))

/** A group's stable identity: its bundle name, or the lone tool's id. */
function groupKey(g: { bundle: string | null; tools: HttpToolSpec[] }): string {
  return g.bundle ?? g.tools[0].id
}

/** KB-scoped tools are defined by a file the agent and git also write, so they
 *  are shown but not edited here. */
function isKbTool(spec: HttpToolSpec): boolean {
  return tools.kbActive.some((s) => s.id === spec.id)
}

const installedRows = computed<InstalledRow[]>(() => {
  const rows: InstalledRow[] = []

  for (const e of installedEntries.value) {
    rows.push({
      key: `entry:${e.id}`,
      title: t(`settings.catalog.${e.id}.title`),
      source: 'preset',
      kind: e.server ? (e.kind === 'extension' ? 'extension' : 'mcp') : null,
      ...entryStatus(e),
      target: { name: 'entry', id: e.id },
    })
  }

  for (const g of yourGroups.value) {
    rows.push({
      key: `group:${groupKey(g)}`,
      title: g.bundle ?? g.tools[0].name,
      source: isKbTool(g.tools[0]) ? 'kb' : 'yours',
      kind: null,
      ...staticCount(g.tools.length),
      target: { name: 'group', key: groupKey(g) },
    })
  }

  for (const s of ownServers.value) {
    const live = liveStatus(s)
    rows.push({
      key: `server:${s.config.id}`,
      title: s.config.name,
      source: s.source === 'kb' ? 'kb' : 'yours',
      kind: 'mcp',
      label: live.label,
      labelCls: live.labelCls,
      dotCls: live.dotCls,
      target: { name: 'server', id: s.config.id },
    })
  }

  return rows
})

const SOURCE_LABEL: Record<Source, string> = {
  preset: 'settings.sourcePreset',
  yours: 'settings.sourceYours',
  kb: 'settings.sourceKb',
}

/** Where each thing is stored, what the tags mean, what a KB switch changes —
 *  the questions this list raises and none of its rows answer. Lives in the
 *  Help panel, which is also what the agent reads, so the answer is the same
 *  whether you open it or ask for it. */
function openToolsHelp(): void {
  ui.settingsOpen = false
  ui.openHelp('tools')
}

/** "1 tools" reads as a bug, and single-tool rows are the common case now that
 *  every integration is one row. The catalog has no plural machinery — two
 *  keys is the whole of it. */
function nTools(n: number): string {
  return n === 1 ? t('settings.status.oneTool') : t('settings.status.nTools', { n })
}

/* ── keys ──────────────────────────────────────────────────────────────── */

const SECRET_META = new Map(
  CATALOG.flatMap((e) => (e.secrets ?? []).map((s) => [s.id, { ...s, entry: e.id }] as const)),
)

/**
 * Every key the installed tools actually reference — catalog packs and
 * agent-written tools alike, so a tool the agent just made has somewhere for
 * its key to go.
 *
 * `users` matters more than it looks: keys live in one flat namespace, so any
 * installed tool that names an existing id receives its value whatever host it
 * points at. Listing who reads each key is how that stays visible.
 */
const requiredKeys = computed(() => {
  const users = new Map<string, string[]>()
  for (const spec of tools.specs) {
    for (const id of secretRefs(spec)) users.set(id, [...(users.get(id) ?? []), spec.name])
  }
  return [...users].map(([id, names]) => ({
    ...(SECRET_META.get(id) ?? { id, label: id, plain: false, url: undefined }),
    users: names,
  }))
})

/** The distinct hosts a group of tools sends to — the line that matters most
 *  when approving something that arrived with the folder. */
function bundleHosts(specs: HttpToolSpec[]): string {
  const hosts = specs.map((s) => {
    try {
      return new URL(s.request.url).host
    } catch {
      return s.request.url
    }
  })
  return [...new Set(hosts)].join(', ')
}

/** Every key a group of tools reads, deduped. */
function bundleSecrets(specs: HttpToolSpec[]): string[] {
  return [...new Set(specs.flatMap((s) => secretRefs(s)))]
}

function secretValue(id: string): string {
  return store.state.toolSecrets[id] ?? ''
}
function onSecretInput(id: string, e: Event): void {
  tools.setSecret(id, (e.target as HTMLInputElement).value.trim())
}

/* ── your tools ────────────────────────────────────────────────────────── */

type ParamRow = { key: string } & HttpToolParam

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
  returnTo.value = view.value
  resetEditor()
  view.value = { name: 'editor' }
}

function editTool(spec: HttpToolSpec): void {
  returnTo.value = view.value
  resetEditor()
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
  view.value = { name: 'editor' }
}

/** Return where the editor was opened from — unless that page is gone, which
 *  is exactly what happens when you delete the last tool in a group. */
function closeEditor(): void {
  const to = returnTo.value
  const stillThere =
    to.name !== 'group' || yourGroups.value.some((g) => groupKey(g) === to.key)
  resetEditor()
  view.value = stillThere ? to : { name: 'main' }
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
  closeEditor()
}

function removeTool(id: string): void {
  store.state.httpTools = store.state.httpTools.filter((s) => s.id !== id)
  if (view.value.name === 'editor') closeEditor()
  else if (view.value.name === 'group' && !detailGroup.value) back()
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

const mcpName = ref('')
const mcpUrl = ref('')
const mcpToken = ref('')
/** true = reach the endpoint through WebCLI instead of fetching it from this
 *  page. Off by default: a direct connection is fewer moving parts, and most
 *  people adding a server by hand have one that works. */
const mcpViaWebcli = ref(false)
const editMcpId = ref<string | null>(null)

function resetMcpForm(): void {
  editMcpId.value = null
  mcpName.value = ''
  mcpUrl.value = ''
  mcpToken.value = ''
  mcpViaWebcli.value = false
}

/** This field takes one thing: the endpoint of an MCP server that allows browser
 *  CORS. Checking it here rather than at connect time is the difference between
 *  "that is not a URL" and a red row reporting a failed fetch of something that
 *  was never an address. */
const mcpUrlValid = computed(() => {
  try {
    return /^https?:$/.test(new URL(mcpUrl.value.trim()).protocol)
  } catch {
    return false
  }
})

function newServer(): void {
  returnTo.value = view.value
  resetMcpForm()
  view.value = { name: 'serverForm' }
}

function startEditMcp(s: {
  id: string
  name: string
  url: string
  token?: string
  transport?: 'direct' | 'webcli'
}): void {
  returnTo.value = view.value
  editMcpId.value = s.id
  mcpName.value = s.name
  mcpUrl.value = s.url
  mcpToken.value = s.token ?? ''
  mcpViaWebcli.value = s.transport === 'webcli'
  view.value = { name: 'serverForm' }
}

function closeMcpForm(): void {
  const to = returnTo.value
  const stillThere =
    to.name !== 'server' || store.state.mcpServers.some((s) => s.id === to.id)
  resetMcpForm()
  view.value = stillThere ? to : { name: 'main' }
}

function submitMcpServer(): void {
  if (!mcpUrlValid.value) return
  const token = mcpToken.value.trim()
  if (editMcpId.value) {
    const s = store.state.mcpServers.find((x) => x.id === editMcpId.value)
    if (s) {
      s.name = mcpName.value.trim() || 'server'
      s.url = mcpUrl.value.trim()
      if (token) s.token = token
      else delete s.token
      if (mcpViaWebcli.value) s.transport = 'webcli'
      else delete s.transport
    }
  } else {
    store.state.mcpServers.push({
      id: newProfileId(),
      name: mcpName.value.trim() || 'server',
      url: mcpUrl.value.trim(),
      ...(token ? { token } : {}),
      ...(mcpViaWebcli.value ? { transport: 'webcli' as const } : {}),
    })
  }
  closeMcpForm()
}

function removeMcpServer(id: string): void {
  store.state.mcpServers = store.state.mcpServers.filter((s) => s.id !== id)
  if (editMcpId.value === id) resetMcpForm()
}

/* ── detail sub-pages ──────────────────────────────────────────────────── */

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
const detailGroup = computed(() => {
  const v = view.value
  return v.name === 'group' ? yourGroups.value.find((g) => groupKey(g) === v.key) : undefined
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
  if (detailGroup.value) return detailGroup.value.bundle ?? detailGroup.value.tools[0].name
  return detailServer.value?.config.name ?? ''
})

/** A catalog server still needs the two fields only the user can supply. */
const detailServerConfig = computed(() =>
  detailServer.value ? store.state.mcpServers.find((s) => s.id === detailServer.value!.config.id) : undefined,
)

/* ── WebCLI: the one integration the user must opt us into ───────────────── */

/** True on the WebCLI row, whose detail page shows connection steps instead of
 *  fields: there is nothing to type, and everything to allow. Read from the
 *  config, not the live row — during a refresh there IS no live row, and falling
 *  through to the generic branch would offer to edit the transport sentinel as if
 *  it were a server address. */
const detailIsWebcli = computed(() =>
  isWebcliRelayUrl(detailServerConfig.value?.url ?? detailEntry.value?.server?.url ?? ''),
)

/* ── connection checks ───────────────────────────────────────────────────── */

/** A click on Reconnect / Check again has to produce something visible. The state
 *  it leaves behind is often identical to the state it started in — same red row,
 *  same message — and a button that answers a click with nothing reads as broken. */
type CheckState = 'idle' | 'checking' | 'ok' | 'failed'
const checkState = ref<CheckState>('idle')

async function runCheck(serverId: string): Promise<void> {
  checkState.value = 'checking'
  mcp.recheckRelay() // the marker may have appeared since this page loaded
  // The floor is the point: a failing check can finish inside one frame, so
  // without it the state goes straight back to the verdict it already showed and
  // the SECOND click looks as dead as the first one did.
  await Promise.all([mcp.reconnect(serverId), wait(MIN_CHECK_MS)])
  checkState.value =
    mcp.servers.find((s) => s.config.id === serverId)?.status === 'ok' ? 'ok' : 'failed'
}

const CHECK_LABEL: Record<Exclude<CheckState, 'idle'>, { key: string; cls: string }> = {
  checking: { key: 'settings.checkChecking', cls: 'text-fg-3' },
  ok: { key: 'settings.checkOk', cls: 'text-added' },
  failed: { key: 'settings.checkFailed', cls: 'text-removed' },
}

/** Whether WebCLI is actually answering — the connection, not the marker. The two
 *  come apart: WebCLI injects its relay per HOST but gates the connection on the
 *  exact ORIGIN, so on another port of an allowed host the marker is there and
 *  every call goes unanswered. Reading the marker here would paint that green. */
const webcliUp = computed(() => detailServer.value?.status === 'ok')

/** What the user types into WebCLI's popup — host and port, the form its own
 *  field accepts. The port is part of the identity, per the note above. */
const pageHost = computed(() => window.location.host)

/** WebCLI starts listening on pages loaded AFTER the origin is added, so a
 *  reload is the step that finishes setup — not a wait. */
function reloadPage(): void {
  window.location.reload()
}

/** The raw connection error, except on WebCLI — there the setup panel above says
 *  the same thing in a form the user can act on. */
const showConnectError = computed(
  () => detailServer.value?.status === 'error' && !detailIsWebcli.value,
)

/** Whether re-probing can possibly change the answer. For WebCLI with no relay on
 *  the page it cannot — only a navigation injects one — so every button that
 *  offers to try again is hidden in that state, Reconnect included. */
const canProbe = computed(() => !detailIsWebcli.value || mcp.relayReady)

/** What is wrong, in one line, before the steps that fix it. The marker cannot
 *  tell "not installed" from "this site was never added" — both leave nothing on
 *  the page — so that diagnosis names both rather than guessing one. */
const webcliProblem = computed(() =>
  mcp.relayReady ? 'settings.webcli.presentButSilent' : 'settings.webcli.notDetected',
)

/** Disable only exists where there is configuration worth keeping — a server's
 *  URL, extension id and token. An HTTP pack has none, so for those "off" and
 *  "removed" are the same thing and only Remove is offered. */
const detailCanDisable = computed(() => !!detailServerConfig.value)
const detailDisabled = computed(() => detailServerConfig.value?.enabled === false)

function toggleDetail(): void {
  const cfg = detailServerConfig.value
  if (cfg) cfg.enabled = cfg.enabled === false ? true : false
}

function removeDetail(): void {
  const v = view.value
  if (v.name === 'entry') tools.uninstall(v.id)
  else if (v.name === 'server') removeMcpServer(v.id)
  back()
}
</script>

<template>
  <!-- One root element so `rootEl` can find the scrolling settings pane; the
       branches below are the actual views. -->
  <div ref="rootEl">
  <!-- ═══ Recommended catalog (sub-page) ═══ -->
  <div v-if="view.name === 'catalog'" class="space-y-4">
    <button class="flex items-center gap-1 text-xs text-fg-3 hover:text-fg-0" @click="back">
      <span class="codicon codicon-sm codicon-arrow-left" />{{ $t('settings.backToTools') }}
    </button>
    <div>
      <span class="text-sm text-fg-1">{{ $t('settings.recommended') }}</span>
      <p class="mt-0.5 text-xs text-fg-3 leading-relaxed">{{ $t('settings.recommendedDesc') }}</p>
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
              <span v-if="e.featured" class="text-[10px] px-1 rounded bg-accent/15 text-accent">
                {{ $t('settings.catalogFeatured') }}
              </span>
              <span
                v-if="e.requiresWebcli"
                class="text-[10px] px-1 rounded"
                :class="tools.webcliConnected ? 'bg-bg-3 text-fg-3' : 'bg-removed/15 text-removed'"
              >{{ $t('settings.catalogNeedsWebcli') }}</span>
              <span v-if="checkingEntry === e.id" class="text-[10px] text-fg-3">
                {{ $t('settings.checkChecking') }}
              </span>
            </div>
            <p class="text-xs text-fg-3 mt-0.5 leading-relaxed">
              {{ $t(`settings.catalog.${e.id}.desc`) }}
            </p>
            <div class="flex items-center gap-3 flex-wrap mt-1.5">
              <!-- For an extension the homepage IS the Web Store listing, and
                   installing is the step the user has to take: say so, rather than
                   filing it under "learn more". -->
              <a
                v-if="e.homepage"
                :href="e.homepage"
                target="_blank"
                rel="noopener"
                class="text-xs text-accent hover:underline"
              >{{ $t(e.kind === 'extension' ? 'settings.installFromStore' : 'settings.catalogLearnMore') }}</a>
              <a
                v-if="e.repo"
                :href="e.repo"
                target="_blank"
                rel="noopener"
                class="flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <span class="codicon codicon-sm codicon-github" />{{ $t('settings.catalogRepo') }}
              </a>
            </div>
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
    <!-- Name and its actions share a line; the description gets the width to
         itself below, instead of being squeezed into whatever the buttons left.
         The actions sit up here rather than after the tool list because a server
         can contribute 25 tools, and "turn this off" should not be behind a
         scroll. -->
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-sm text-fg-1 truncate">{{ detailTitle }}</span>
          <span
            v-if="detailDisabled"
            class="text-[10px] px-1 rounded bg-bg-3 text-fg-3 shrink-0"
          >{{ $t('settings.status.off') }}</span>
        </div>
        <div v-if="detailEntry || detailServerConfig" class="flex items-center gap-1.5 shrink-0">
          <!-- Available whatever the dot says: "it worked a minute ago" is
               exactly the state a stale connection is in, and this row is the
               only place to do something about it. -->
          <button
            v-if="detailServer && !detailDisabled && canProbe"
            class="btn text-xs"
            :disabled="detailServer.status === 'connecting' || checkState === 'checking'"
            @click="runCheck(detailServer.config.id)"
          >
            {{ detailServer.status === 'connecting' || checkState === 'checking'
              ? $t('settings.checkChecking')
              : $t('settings.reconnect') }}
          </button>
          <button
            v-if="view.name === 'server' && detailServerConfig"
            class="btn text-xs"
            @click="startEditMcp(detailServerConfig)"
          >{{ $t('common.edit') }}</button>
          <button
            v-if="detailCanDisable"
            class="btn text-xs"
            @click="toggleDetail"
          >{{ detailDisabled ? $t('settings.enable') : $t('settings.disable') }}</button>
          <button class="btn text-xs hover:!text-removed" @click="removeDetail">
            {{ $t('settings.removeEntry') }}
          </button>
        </div>
      </div>
      <p v-if="detailEntry" class="text-xs text-fg-3 leading-relaxed">
        {{ $t(`settings.catalog.${detailEntry.id}.desc`) }}
      </p>
      <p v-else-if="detailServer" class="text-xs text-fg-3 font-mono break-all">
        {{ detailServer.config.url }}
      </p>
    </div>

    <!-- WebCLI. There is no address and no id to enter — the extension writes its
         own id into the page when it is willing to talk to us — so this panel is
         entirely about the permission: has the user added this site, and if not,
         the three steps that do it. -->
    <div v-if="detailEntry?.kind === 'extension' && detailIsWebcli" class="space-y-2">
      <div v-if="webcliUp" class="space-y-1">
        <div class="flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-added shrink-0" />
          <span class="text-xs text-fg-1">{{ $t('settings.webcli.connected') }}</span>
        </div>
        <div class="text-xs text-fg-3 font-mono break-all">
          {{ $t('settings.webcli.extension', { id: mcp.relayExt ?? '' }) }}
        </div>
      </div>

      <div v-else class="space-y-2">
        <!-- What is wrong comes FIRST. Steps without a diagnosis leave the user
             re-doing the one they already did; and when the relay is on the page,
             the problem is specifically the address, nearly always its port. -->
        <div class="flex items-start gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-removed shrink-0 mt-1.5" />
          <p class="text-xs text-removed leading-relaxed">{{ $t(webcliProblem) }}</p>
        </div>
        <div class="pt-0.5 text-xs text-fg-1">{{ $t('settings.webcli.setupTitle') }}</div>
        <p class="text-xs text-fg-3 leading-relaxed">{{ $t('settings.webcli.setupIntro') }}</p>
        <ol class="text-xs text-fg-2 leading-relaxed space-y-1 list-decimal pl-4">
          <li>
            {{ $t('settings.webcli.step1') }}
            <a
              v-if="detailEntry.homepage"
              :href="detailEntry.homepage"
              target="_blank"
              rel="noopener"
              class="text-accent hover:underline"
            >{{ $t('settings.installFromStore') }}</a>
          </li>
          <!-- The address is shown rather than described: it is the one string
               that has to match exactly, and it differs per dev port. -->
          <li>
            {{ $t('settings.webcli.step2') }}
            <span class="font-mono text-fg-1">{{ pageHost }}</span>
          </li>
          <li>{{ $t('settings.webcli.step3') }}</li>
        </ol>
        <div class="flex items-center gap-1.5 flex-wrap">
          <button class="btn text-xs" @click="reloadPage">{{ $t('settings.webcli.reload') }}</button>
          <!-- Offered only where it can actually succeed. With a relay on the page,
               re-probing works: the origin gate is consulted per connection, so
               adding the address needs no reload. With NO relay, nothing but a
               navigation can put one there — a re-probe would be a button that
               reports failure forever while the real fix sits next to it. -->
          <button
            v-if="detailServer && canProbe"
            class="btn text-xs"
            :disabled="checkState === 'checking'"
            @click="runCheck(detailServer.config.id)"
          >{{ $t('settings.webcli.recheck') }}</button>
          <span
            v-if="checkState !== 'idle'"
            class="text-xs"
            :class="CHECK_LABEL[checkState].cls"
          >{{ $t(CHECK_LABEL[checkState].key) }}</span>
        </div>
      </div>

      <a
        v-if="detailEntry.repo"
        :href="detailEntry.repo"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1 text-xs text-accent hover:underline"
      >
        <span class="codicon codicon-sm codicon-github" />{{ $t('settings.catalogRepo') }}
      </a>
    </div>

    <!-- The only fields a preset leaves to the user. -->
    <div v-else-if="detailEntry?.server && detailServerConfig" class="space-y-2">
      <label class="block text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.serverUrl') }}</label>
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

    <div v-if="detailServer && showConnectError" class="flex items-baseline gap-2 text-xs">
      <span class="text-removed">{{ detailServer.error }}</span>
      <button
        v-if="canProbe"
        class="text-accent hover:underline shrink-0"
        :disabled="checkState === 'checking'"
        @click="runCheck(detailServer.config.id)"
      >
        {{ $t('settings.reconnect') }}
      </button>
    </div>
    <!-- A check that changes nothing still has to say it ran. -->
    <p
      v-if="detailServer && !detailIsWebcli && checkState !== 'idle'"
      class="text-xs"
      :class="CHECK_LABEL[checkState].cls"
    >{{ $t(CHECK_LABEL[checkState].key) }}</p>

    <div>
      <span class="text-xs uppercase tracking-wide text-fg-3">
        {{ nTools(detailTools.length) }}
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

  <!-- ═══ Detail: an HTTP tool group — yours or the KB's (sub-page) ═══ -->
  <div v-else-if="view.name === 'group'" class="space-y-4">
    <button class="flex items-center gap-1 text-xs text-fg-3 hover:text-fg-0" @click="back">
      <span class="codicon codicon-sm codicon-arrow-left" />{{ $t('settings.backToTools') }}
    </button>
    <template v-if="detailGroup">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-fg-1">{{ detailTitle }}</span>
            <span
              v-if="isKbTool(detailGroup.tools[0])"
              class="text-[10px] px-1 rounded bg-accent/15 text-accent"
            >{{ $t('settings.sourceKb') }}</span>
          </div>
          <p class="text-xs text-fg-3 mt-0.5 leading-relaxed">
            {{
              isKbTool(detailGroup.tools[0])
                ? $t('settings.kbToolHint')
                : nTools(detailGroup.tools.length)
            }}
          </p>
        </div>
        <button
          v-if="!isKbTool(detailGroup.tools[0])"
          class="text-xs text-accent hover:underline shrink-0 pt-0.5"
          @click="newTool"
        >{{ $t('settings.addManually') }}</button>
      </div>

      <div class="rounded-lg border border-border divide-y divide-border overflow-hidden">
        <div v-for="s in detailGroup.tools" :key="s.id" class="group px-3 py-2.5">
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs text-fg-1 shrink-0">{{ s.name }}</span>
            <span class="text-[10px] text-fg-3 shrink-0">{{ s.request.method }}</span>
            <span class="flex-1" />
            <template v-if="!isKbTool(s)">
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
            </template>
          </div>
          <p class="text-xs text-fg-3 mt-0.5 font-mono break-all">{{ s.request.url }}</p>
          <p v-if="s.description" class="text-xs text-fg-3 mt-0.5 leading-relaxed line-clamp-3">
            {{ s.description }}
          </p>
        </div>
      </div>
    </template>
  </div>

  <!-- ═══ Tool editor (sub-page) ═══ -->
  <div v-else-if="view.name === 'editor'" class="space-y-4">
    <button class="flex items-center gap-1 text-xs text-fg-3 hover:text-fg-0" @click="closeEditor">
      <span class="codicon codicon-sm codicon-arrow-left" />{{ $t('settings.backToTools') }}
    </button>
    <div>
      <span class="text-sm text-fg-1">
        {{ editingId ? $t('settings.editToolTitle') : $t('settings.newToolTitle') }}
      </span>
      <p class="mt-0.5 text-xs text-fg-3 leading-relaxed">{{ $t('settings.customToolsDesc') }}</p>
    </div>

    <div class="space-y-3">
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
        <!-- A textarea, not an input: the catalog's own templates span lines
             (`# {{title}}\nAuthors: …`) and an <input> silently drops every
             newline pasted into it, so a hand-written tool could never shape
             output the way a preset does. -->
        <textarea
          v-if="form.mode !== 'text'"
          v-model="form.template"
          rows="3"
          class="input text-xs font-mono"
          placeholder="- {{title}} ({{year}})&#10;  {{url}}"
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
        <button class="btn text-xs" @click="closeEditor">{{ $t('common.cancel') }}</button>
        <button
          v-if="editingId"
          class="text-xs text-fg-3 hover:text-removed self-center ml-auto"
          @click="removeTool(editingId)"
        >{{ $t('common.delete') }}</button>
        <span v-if="!draftSpec" class="text-xs text-removed self-center">{{ $t('settings.toolInvalid') }}</span>
      </div>
    </div>
  </div>

  <!-- ═══ MCP server form (sub-page) ═══ -->
  <div v-else-if="view.name === 'serverForm'" class="space-y-4">
    <button class="flex items-center gap-1 text-xs text-fg-3 hover:text-fg-0" @click="closeMcpForm">
      <span class="codicon codicon-sm codicon-arrow-left" />{{ $t('settings.backToTools') }}
    </button>
    <div>
      <span class="text-sm text-fg-1">
        {{ editMcpId ? $t('settings.editServerTitle') : $t('settings.newServerTitle') }}
      </span>
      <p class="mt-0.5 text-xs text-fg-3 leading-relaxed">{{ $t('settings.serversDesc') }}</p>
    </div>

    <div class="space-y-2">
      <input v-model="mcpName" class="input text-xs" :placeholder="$t('settings.namePlaceholder')" />
      <input v-model="mcpUrl" class="input text-xs font-mono" :placeholder="$t('settings.urlPlaceholder')" />
      <p v-if="mcpUrl.trim() && !mcpUrlValid" class="text-xs text-removed">
        {{ $t('settings.serverUrlInvalid') }}
      </p>
      <input
        v-model="mcpToken"
        type="password"
        class="input text-xs"
        :placeholder="$t('settings.tokenPlaceholder')"
        autocomplete="off"
      />
      <label class="flex items-start gap-2 pt-1 cursor-pointer">
        <input v-model="mcpViaWebcli" type="checkbox" class="mt-0.5" />
        <span class="text-xs text-fg-2 leading-relaxed">
          {{ $t('settings.serverViaWebcli') }}
          <span class="block text-fg-3">{{ $t('settings.serverViaWebcliHint') }}</span>
          <span v-if="mcpViaWebcli && !mcp.relayReady" class="block text-removed">
            {{ $t('settings.serverViaWebcliMissing') }}
          </span>
        </span>
      </label>
      <div class="flex gap-2 pt-0.5">
        <button class="btn text-xs" :disabled="!mcpUrlValid" @click="submitMcpServer">
          {{ editMcpId ? $t('common.save') : $t('common.add') }}
        </button>
        <button class="btn text-xs" @click="closeMcpForm">{{ $t('common.cancel') }}</button>
      </div>
      <p class="text-xs text-fg-3 leading-relaxed">{{ $t('settings.toolsHelp') }}</p>
    </div>
  </div>

  <!-- ═══ Main ═══ -->
  <div v-else class="space-y-5">
    <!-- ▸ The front door. Most people arrive wanting a service, not a tool
         format, and the agent can research and build one — so ask for the goal
         instead of making them shop a catalog for a match. -->
    <div class="rounded-xl border border-accent/40 bg-accent/5 px-3 py-3">
      <div class="text-sm text-fg-1">{{ $t('settings.connectTitle') }}</div>
      <p class="mt-0.5 text-xs text-fg-3 leading-relaxed">{{ $t('settings.connectDesc') }}</p>
      <button class="btn text-xs mt-2" @click="askAgent">{{ $t('settings.connectAction') }}</button>
    </div>

    <!-- ▸ Installed — everything the agent can reach, one row per integration.
         Source tag on every row; kind tag and a status dot only where a live
         connection exists, so a colour never means two things. -->
    <div>
      <div class="flex items-center justify-between">
        <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.installed') }}</span>
        <button class="text-xs text-accent hover:underline" @click="open({ name: 'catalog' })">
          {{ $t('settings.browseAll') }}
        </button>
      </div>
      <p class="mt-1 text-xs text-fg-3 leading-relaxed">{{ $t('settings.installedDesc') }}</p>
    </div>
    <div v-if="installedRows.length" class="rounded-lg border border-border divide-y divide-border overflow-hidden">
      <button
        v-for="r in installedRows"
        :key="r.key"
        class="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-bg-2 text-left transition-colors"
        :title="r.title"
        @click="open(r.target)"
      >
        <span v-if="r.dotCls" class="w-1.5 h-1.5 rounded-full shrink-0" :class="r.dotCls" />
        <!-- The only element allowed to shrink: a long integration name gives up
             width to its tags and the chevron instead of pushing them out of the
             row (the list clips overflow). -->
        <span class="text-sm text-fg-1 min-w-0 truncate">{{ r.title }}</span>
        <span class="text-[10px] px-1 rounded bg-bg-3 text-fg-3 shrink-0">
          {{ $t(SOURCE_LABEL[r.source]) }}
        </span>
        <span v-if="r.kind" class="text-[10px] px-1 rounded bg-bg-3 text-fg-3 shrink-0">
          {{ r.kind === 'mcp' ? 'MCP' : $t('settings.kindExtension') }}
        </span>
        <span class="text-[10px] shrink-0 truncate" :class="r.labelCls">{{ r.label }}</span>
        <span class="flex-1" />
        <span class="codicon codicon-sm codicon-chevron-right text-fg-3 shrink-0" />
      </button>
    </div>
    <p v-else class="text-sm text-fg-3">{{ $t('settings.noneInstalled') }}</p>

    <!-- ▸ Tools the KB carries, awaiting approval -->
    <div v-if="tools.kbPending.length" class="rounded-lg border border-accent/40 bg-accent/5 px-3 py-3 space-y-2">
      <div class="text-sm text-fg-1">{{ $t('settings.kbToolsTitle') }}</div>
      <p class="text-xs text-fg-3 leading-relaxed">{{ $t('settings.kbToolsDesc') }}</p>
      <!-- Grouped by integration: eight rows for one service is not more
           informative than one row that names the host and the keys. -->
      <ul class="text-xs font-mono text-fg-2 space-y-1.5">
        <li v-for="(g, i) in groupByBundle(tools.kbPending)" :key="g.bundle ?? i">
          <div v-if="g.bundle" class="break-all">
            {{ g.bundle }} · {{ nTools(g.tools.length) }} →
            {{ bundleHosts(g.tools) }}
          </div>
          <div v-else class="break-all">{{ g.tools[0].name }} → {{ g.tools[0].request.url }}</div>
          <div v-if="g.bundle" class="pl-3 text-fg-3">{{ g.tools.map((t) => t.name).join(', ') }}</div>
          <!-- A tool arriving with the folder can name a key you already hold;
               where it sends data is only half of what you are approving. -->
          <div v-if="bundleSecrets(g.tools).length" class="text-removed">
            ↳ {{ $t('settings.kbToolsUsesKeys', { ids: bundleSecrets(g.tools).join(', ') }) }}
          </div>
        </li>
      </ul>
      <button class="btn text-xs" @click="tools.trustKbTools()">{{ $t('settings.kbToolsApprove') }}</button>
    </div>

    <!-- ▸ Advanced — the manual versions of the two doors above. Folded, and
         each opens its own page, so main stays a list. -->
    <div>
      <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.advanced') }}</span>
      <p class="mt-1 text-xs text-fg-3 leading-relaxed">{{ $t('settings.advancedDesc') }}</p>
      <div class="mt-1.5 rounded-lg border border-border divide-y divide-border overflow-hidden">
        <button
          class="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-bg-2 text-left transition-colors"
          @click="newTool"
        >
          <span class="text-sm text-fg-1">{{ $t('settings.addManually') }}</span>
          <span class="flex-1" />
          <span class="codicon codicon-sm codicon-chevron-right text-fg-3 shrink-0" />
        </button>
        <button
          class="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-bg-2 text-left transition-colors"
          @click="newServer"
        >
          <span class="text-sm text-fg-1">{{ $t('settings.addServer') }}</span>
          <span class="flex-1" />
          <span class="codicon codicon-sm codicon-chevron-right text-fg-3 shrink-0" />
        </button>
      </div>
    </div>

    <!-- ▸ Keys -->
    <div v-if="requiredKeys.length">
      <span class="text-xs uppercase tracking-wide text-fg-3">{{ $t('settings.keys') }}</span>
      <p class="mt-1 mb-2 text-xs text-fg-3 leading-relaxed">{{ $t('settings.keysDesc') }}</p>
      <div class="space-y-2.5">
        <div v-for="k in requiredKeys" :key="k.id">
          <div class="flex items-center gap-2">
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
          <!-- Which tools read this value. One flat namespace means the answer
               is not always the one entry you expect. -->
          <!-- 8.5rem lines up under the input: w-32 label + gap-2. -->
          <p class="mt-1 ml-[8.5rem] text-xs text-fg-3 truncate" :title="k.users.join(', ')">
            {{ $t('settings.keyUsedBy', { tools: k.users.join(', ') }) }}
          </p>
        </div>
      </div>
    </div>

    <!-- Into the Help panel rather than a page of its own: the manual is one
         set of files, and a second copy here would drift from it. -->
    <button class="text-xs text-accent hover:underline" @click="openToolsHelp">
      {{ $t('settings.helpLink') }}
    </button>
  </div>
  </div>
</template>
