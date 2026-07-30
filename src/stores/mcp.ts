/**
 * External tool sources — MCP servers from TWO config scopes, merged:
 *   - global: Settings (localStorage, follows the browser)
 *   - KB-level: `.agents/mcp.json` in the opened folder (travels with the KB
 *     via git; duplicate targets override global — the KB is more specific)
 * Two transports, selected by the url field: WebCLI's postMessage relay
 * (WEBCLI_RELAY_URL — see lib/webcliRelay.ts) or Streamable HTTP. Connected
 * servers contribute namespaced tools
 * (mcp__<server>__<tool>) that both agent providers append per turn.
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  McpHttpClient,
  externalToolName,
  sanitizeServerName,
  normalizeMcpServerList,
  mergeMcpConfigs,
  isDeferredTool,
  isRecoverable,
  recallTouch,
  KB_MCP_CONFIG_PATH,
  type McpClientLike,
  type McpServerConfig,
  type McpToolDef,
} from '@/lib/mcp'
import { McpRelayClient, isWebcliRelayUrl, relayExtensionId } from '@/lib/webcliRelay'
import { useSettingsStore } from '@/stores/settings'
import { useKbStore } from '@/stores/kb'
import * as fs from '@/lib/fs'

export interface McpServerState {
  config: McpServerConfig
  source: 'global' | 'kb'
  status: 'connecting' | 'ok' | 'error' | 'off'
  error?: string
  tools: McpToolDef[]
}

export interface ExternalTool {
  /** Namespaced model-facing name: mcp__<server>__<tool>. */
  qualifiedName: string
  serverId: string
  serverName: string
  def: McpToolDef
}

/* ── recall store (which deferred tools this KB actually uses) ───────────── */

const RECALL_KEY = 'browser-md:mcp-recall:v1'

/** Persisted per KB folder name, matching how viewMemory keys reading
 *  positions — identical tool names in different KBs must not collide. */
function readRecall(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(RECALL_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {}
  } catch {
    return {} // best-effort: a lost recall list only costs one enable_tools round trip
  }
}

/** Which transport a row's url selects: WebCLI's relay, or a Streamable-HTTP
 *  endpoint. */
function clientFor(config: McpServerConfig): McpClientLike {
  return isWebcliRelayUrl(config.url) ? new McpRelayClient() : new McpHttpClient(config)
}

/** How often we re-read the relay marker while a WebCLI row is waiting on it.
 *  Reading one dataset property is free; the timer only runs in that state. */
const RELAY_POLL_MS = 5_000

async function loadKbServers(): Promise<McpServerConfig[]> {
  const raw = await fs.tryReadFile(KB_MCP_CONFIG_PATH)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { servers?: unknown }
    return normalizeMcpServerList(parsed.servers, (s) => `kb:${s.name}:${s.url}`)
  } catch {
    return [] // malformed file — surfaced implicitly (no kb servers appear)
  }
}

export const useMcpStore = defineStore('mcp', () => {
  const servers = ref<McpServerState[]>([])
  const clients = new Map<string, McpClientLike>()

  const allTools = computed<ExternalTool[]>(() =>
    servers.value.flatMap((s) =>
      s.status === 'ok'
        ? s.tools.map((def) => ({
            qualifiedName: externalToolName(s.config.name, def.name),
            serverId: s.config.id,
            serverName: sanitizeServerName(s.config.name),
            def,
          }))
        : [],
    ),
  )

  /** Deferred tools the model activated, keyed by chat session — concurrent
   *  sessions activate independently (deferred-loading escape hatch). */
  const activated = ref(new Map<string, Set<string>>())

  const toolCountByServer = computed(() => {
    const counts = new Map<string, number>()
    for (const s of servers.value) counts.set(s.config.id, s.tools.length)
    return counts
  })

  function activatedFor(sessionId: string): Set<string> {
    return activated.value.get(sessionId) ?? new Set()
  }

  /** Tools whose schemas ride along with every request of this session. */
  function activeToolsFor(sessionId: string): ExternalTool[] {
    const set = activatedFor(sessionId)
    return allTools.value.filter(
      (t) => !isDeferredTool(t.qualifiedName, toolCountByServer.value.get(t.serverId) ?? 0, set),
    )
  }

  /** Big-server tools kept OUT of this session's requests until activated —
   *  the system prompt lists them as a compact catalog instead. */
  function deferredToolsFor(sessionId: string): ExternalTool[] {
    const set = activatedFor(sessionId)
    return allTools.value.filter(
      (t) => isDeferredTool(t.qualifiedName, toolCountByServer.value.get(t.serverId) ?? 0, set),
    )
  }

  const NO_ACTIVATIONS: ReadonlySet<string> = new Set()

  /** Every policy-deferred tool, IGNORING session activation — the system
   *  prompt lists this frozen catalog so its bytes stay identical across turns
   *  (activation would otherwise shrink the list and invalidate the provider's
   *  prompt-cache prefix). Activation changes which schemas are sent, never
   *  the catalog text. */
  const deferredCatalog = computed<ExternalTool[]>(() =>
    allTools.value.filter((t) =>
      isDeferredTool(t.qualifiedName, toolCountByServer.value.get(t.serverId) ?? 0, NO_ACTIVATIONS),
    ),
  )

  /* ── recall ───────────────────────────────────────────────────────────── */

  /** Deferred tools this KB has actually used, most recent first (capped). A
   *  fresh session starts with these already active, so the common case costs
   *  no enable_tools round trip AND keeps its tool set — the very front of the
   *  provider's cache prefix — byte-stable from the first request. Mid-session
   *  activation still works; it just stops being the norm. */
  const recalled = ref<string[]>([])

  function persistRecall(): void {
    const kbName = useKbStore().name
    if (!kbName) return
    try {
      localStorage.setItem(RECALL_KEY, JSON.stringify({ ...readRecall(), [kbName]: recalled.value }))
    } catch {
      /* quota exceeded or private mode — recall is best-effort */
    }
  }

  /** Record a tool the agent actually CALLED. Only policy-deferred tools earn a
   *  slot: everything else is already in every request, so remembering it would
   *  waste the cap. */
  function rememberUse(qualifiedName: string): void {
    const t = allTools.value.find((x) => x.qualifiedName === qualifiedName)
    if (!t) return
    const count = toolCountByServer.value.get(t.serverId) ?? 0
    if (!isDeferredTool(qualifiedName, count, NO_ACTIVATIONS)) return
    const next = recallTouch(recalled.value, qualifiedName)
    if (next.join('\n') === recalled.value.join('\n')) return
    recalled.value = next
    persistRecall()
  }

  /** Seed a new session with the recalled tools (those that still exist and are
   *  still policy-deferred). Called once per session, before its first request. */
  function preactivate(sessionId: string): void {
    const names = recalled.value.filter((n) => {
      const t = allTools.value.find((x) => x.qualifiedName === n)
      return !!t && isDeferredTool(n, toolCountByServer.value.get(t.serverId) ?? 0, NO_ACTIVATIONS)
    })
    if (names.length) activate(sessionId, names)
  }

  /** Activate deferred tools by qualified name; returns what actually matched. */
  function activate(sessionId: string, names: string[]): string[] {
    const known = new Set(allTools.value.map((t) => t.qualifiedName))
    const accepted = names.filter((n) => known.has(n))
    if (accepted.length) {
      const next = new Set(activatedFor(sessionId))
      for (const n of accepted) next.add(n)
      const map = new Map(activated.value)
      map.set(sessionId, next)
      activated.value = map
    }
    return accepted
  }

  /** Drop a session's activations (its tab closed) — or all on KB switch. */
  function clearActivated(sessionId?: string): void {
    if (sessionId === undefined) {
      if (activated.value.size) activated.value = new Map()
    } else if (activated.value.has(sessionId)) {
      const map = new Map(activated.value)
      map.delete(sessionId)
      activated.value = map
    }
  }

  /** Write a row by id rather than by index: connects run concurrently and a
   *  refresh can rebuild the array underneath one of them. */
  function patch(serverId: string, next: Partial<McpServerState>): void {
    const i = servers.value.findIndex((s) => s.config.id === serverId)
    if (i >= 0) servers.value[i] = { ...servers.value[i], ...next }
  }

  /** Build a client for one row and handshake it. Any previous client for that
   *  id is disposed first, so ports and HTTP sessions never pile up. */
  async function connectServer(config: McpServerConfig): Promise<void> {
    clients.get(config.id)?.dispose()
    const client: McpClientLike = clientFor(config)
    // A transport that drops on its own must show up as red, not stay green
    // until someone happens to run a tool.
    client.onLost = (reason) => {
      if (clients.get(config.id) === client) patch(config.id, { status: 'error', error: reason })
    }
    clients.set(config.id, client)
    patch(config.id, { status: 'connecting', error: undefined })
    try {
      const tools = await client.connect()
      patch(config.id, { status: 'ok', error: undefined, tools })
    } catch (err) {
      patch(config.id, { status: 'error', error: (err as Error).message, tools: [] })
    }
  }

  async function refresh(): Promise<void> {
    const settings = useSettingsStore()
    const kb = useKbStore()
    const kbServers = kb.isOpen ? await loadKbServers() : []
    const merged = mergeMcpConfigs(settings.state.mcpServers, kbServers)

    for (const client of clients.values()) client.dispose()
    clients.clear()
    servers.value = merged.map(({ source, ...config }) => ({
      config,
      source,
      status: config.enabled === false ? 'off' : 'connecting',
      tools: [],
    }))
    await Promise.all(
      servers.value.filter((s) => s.status !== 'off').map((s) => connectServer(s.config)),
    )
  }

  /** Reconnect ONE server, leaving every healthy connection alone — the button
   *  in Settings, and what an auto-retry uses. */
  async function reconnect(serverId: string): Promise<void> {
    const state = servers.value.find((s) => s.config.id === serverId)
    if (!state || state.config.enabled === false) return
    await connectServer(state.config)
  }

  /* ── WebCLI relay presence ────────────────────────────────────────────── */

  /**
   * WebCLI's extension id when its relay is on this page, else null — the whole
   * of "is WebCLI connectable?", read straight from the DOM marker.
   *
   * It is re-checked rather than read once because the answer is a user action
   * away: they open WebCLI's popup, add this origin, and come back. Note what
   * re-checking can and cannot do — the extension registers its relay for FUTURE
   * navigations, so the marker appears on the next page load, not the moment the
   * origin is added. That is why the setup panel offers Reload as the action and
   * this only heals the cases that need no reload (WebCLI enabled again, a dev
   * build swapped in, a stored id that turns out to be the installed one).
   */
  const relayExt = ref<string | null>(relayExtensionId())
  const relayReady = computed(() => relayExt.value !== null)

  const webcliRows = computed(() => servers.value.filter((s) => isWebcliRelayUrl(s.config.url)))

  function recheckRelay(): void {
    const next = relayExtensionId()
    if (next === relayExt.value) return
    relayExt.value = next
    // The marker turned up (or names a different build now): the WebCLI rows are
    // connectable, so heal them instead of making the user find Reconnect.
    if (next) for (const s of webcliRows.value) void reconnect(s.config.id)
  }

  if (typeof window !== 'undefined') {
    // Coming back to the tab is the moment setup is most likely to have finished.
    window.addEventListener('focus', recheckRelay)
    document.addEventListener('visibilitychange', recheckRelay)
    let timer: ReturnType<typeof setInterval> | null = null
    watch(
      () => webcliRows.value.length > 0 && !relayReady.value,
      (waiting) => {
        if (waiting && timer === null) timer = setInterval(recheckRelay, RELAY_POLL_MS)
        else if (!waiting && timer !== null) {
          clearInterval(timer)
          timer = null
        }
      },
      { immediate: true },
    )
  }

  /** Re-probe only the rows that are currently failing. Cheap enough to run
   *  whenever the user comes back to the tab: a server that came up while they
   *  were away, or an extension that finished reloading, heals by itself. */
  async function retryFailed(): Promise<void> {
    const dead = servers.value.filter((s) => s.status === 'error').map((s) => s.config.id)
    await Promise.all(dead.map((id) => reconnect(id)))
  }

  async function callTool(
    serverId: string,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const client = clients.get(serverId)
      if (!client) throw new Error(`MCP server not connected: ${serverId}`)
      const out = await client.callTool(tool, args, signal)
      // The call proves the connection is alive — say so if the row had gone red.
      patch(serverId, { status: 'ok', error: undefined })
      return out
    } catch (err) {
      // The user stopping their turn says nothing about the server: leave the
      // row alone and don't retry — they asked for it to stop, not to happen.
      if (signal?.aborted) throw err
      if (!isRecoverable(err)) {
        patch(serverId, { status: 'error', error: (err as Error).message })
        throw err
      }
      // The request never landed (dead port, expired session), so sending it
      // again cannot run the tool twice. One attempt, then the error stands.
      await reconnect(serverId)
      const client = clients.get(serverId)
      if (!client) throw err
      return client.callTool(tool, args, signal)
    }
  }

  // Reconnect when the global config or the opened KB changes.
  const settings = useSettingsStore()
  const kb = useKbStore()
  watch(
    () => [JSON.stringify(settings.state.mcpServers), kb.name] as const,
    () => void refresh(),
    { immediate: true },
  )

  // Recall belongs to the KB it was learned in — swap it on KB open/close.
  watch(
    () => kb.name,
    (name) => {
      recalled.value = name ? (readRecall()[name] ?? []) : []
    },
    { immediate: true },
  )

  return {
    servers,
    relayExt,
    relayReady,
    recheckRelay,
    allTools,
    activeToolsFor,
    deferredToolsFor,
    deferredCatalog,
    recalled,
    activate,
    preactivate,
    rememberUse,
    clearActivated,
    refresh,
    reconnect,
    retryFailed,
    callTool,
  }
})
