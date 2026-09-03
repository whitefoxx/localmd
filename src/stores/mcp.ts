/**
 * External tool sources — MCP servers from TWO config scopes, merged:
 *   - global: Settings (localStorage, follows the browser)
 *   - KB-level: `.agents/mcp.json` in the opened folder (travels with the KB
 *     via git; duplicate targets override global — the KB is more specific)
 * Two transports, selected by the url field: localmd Connect's postMessage
 * relay (LOCALMD_CONNECT_RELAY_URL — see lib/connectRelay.ts) or Streamable
 * HTTP. Connected servers contribute namespaced tools
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
  isAuthFailure,
  recallTouch,
  directWire,
  resolveServerSecrets,
  serverSecretRefs,
  KB_MCP_CONFIG_PATH,
  type McpClientLike,
  type McpServerConfig,
  type McpToolDef,
  type McpWire,
} from '@/lib/mcp'
import {
  discover,
  supportsPublicPkce,
  clientIdentity,
  buildAuthorizeUrl,
  parseCallback,
  callbackFault,
  tokenRequestBody,
  requestToken,
  pkceChallenge,
  randomToken,
  isExpired,
} from '@/lib/mcpOAuth'
import { authorizeInPopup, redirectUri, cimdUrl } from '@/lib/oauthPopup'
import {
  McpRelayClient,
  isLocalmdConnectRelayUrl,
  relayExtensionId,
  extensionWire,
} from '@/lib/connectRelay'
import { INBOX_NOTIFICATION, drainInbox } from '@/lib/connectInbox'
import { importTempFile } from '@/lib/capture'
import { EXTENSION_FETCH_TOOL, CONNECT_ACTIVE_TOOLS } from '@/lib/toolCatalog'
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

const RECALL_KEY = 'localmd:mcp-recall:v1'

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

/** Shown when a row asks for the extension transport and no extension is
 *  there. Says what to do, because "failed to fetch" would not. */
const EXTENSION_TRANSPORT_MISSING =
  'This server is set to reach its endpoint through the browser extension, and none is connected — install or enable localmd Connect in Settings → Tools.'

/** A KB-carried row that reached for one of the reader's stored keys. Worth
 *  naming plainly: this is someone else's config asking for your credential. */
const KB_SECRET_REFUSED =
  'This server came with the knowledge base folder and asks for one of your saved keys. Folder config cannot spend your keys — add the server yourself under Settings → Tools if you trust it.'

/** A row that names a key nobody has entered yet. Naming the ids matters: the
 *  row is the only place that knows WHICH key, and without it the user is left
 *  reading a 401 from a service they never got to configure. */
function missingSecretMessage(ids: readonly string[]): string {
  return `Needs a value for ${ids.join(', ')} — add it under Settings → Tools → Keys.`
}

/**
 * The store's own `callTool`, reachable from `clientFor` — which runs while the
 * store body is still being built. A notification cannot arrive before a
 * connection exists, so by the time this is read it is set.
 */
const callToolRef: {
  value: ((serverId: string, tool: string, args: Record<string, unknown>) => Promise<string>) | null
} = { value: null }

/**
 * Which client a row gets. Three cases, and only the first is about the url:
 *   - the relay sentinel — the row IS localmd Connect, over its postMessage
 *     relay
 *   - transport 'extension' — a normal endpoint, reached through the
 *     extension's fetch_url
 *   - otherwise — a normal endpoint, reached by the browser directly
 */
function clientFor(config: McpServerConfig, extension: McpWire | null): McpClientLike {
  if (isLocalmdConnectRelayUrl(config.url)) {
    const client = new McpRelayClient()
    // The extension is the only tool source that talks to us unprompted: it
    // pokes when the user has captured something in their browser. Bound here
    // because this is where the row's id is known, and the drain calls back
    // over that same row (lib/connectInbox).
    client.onNotification = (method) => {
      if (method !== INBOX_NOTIFICATION) return
      const call = callToolRef.value
      if (!call) return
      void drainInbox({ serverId: config.id, call: (t, a) => call(config.id, t, a) }).catch(() => {
        /* a failed drain leaves the items queued for the next poke */
      })
    }
    return client
  }
  if (config.transport !== 'extension') return new McpHttpClient(config)
  if (!extension) throw new Error(EXTENSION_TRANSPORT_MISSING)
  return new McpHttpClient(config, extension)
}

/** How often we re-read the relay marker while the extension row is waiting on
 *  it. Reading one dataset property is free; the timer only runs in that state. */
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

  function serverUrl(serverId: string): string {
    return servers.value.find((s) => s.config.id === serverId)?.config.url ?? ''
  }

  /** localmd Connect's workhorse trio (find_adapters / run_adapter / fetch_url)
   *  is pinned active — never deferred, whatever the server's tool count. Keyed
   *  on the server's url, not the tool name alone: another server exposing the
   *  same tool names stays under the ordinary defer policy. */
  function pinnedActive(t: ExternalTool): boolean {
    return CONNECT_ACTIVE_TOOLS.has(t.def.name) && isLocalmdConnectRelayUrl(serverUrl(t.serverId))
  }

  /** The defer policy with the pin applied — the one place both rules meet. */
  function deferred(t: ExternalTool, activatedSet: ReadonlySet<string>): boolean {
    if (pinnedActive(t)) return false
    return isDeferredTool(t.qualifiedName, toolCountByServer.value.get(t.serverId) ?? 0, activatedSet)
  }

  /** Tools whose schemas ride along with every request of this session. */
  function activeToolsFor(sessionId: string): ExternalTool[] {
    const set = activatedFor(sessionId)
    return allTools.value.filter((t) => !deferred(t, set))
  }

  /** Big-server tools kept OUT of this session's requests until activated —
   *  the system prompt lists them as a compact catalog instead. */
  function deferredToolsFor(sessionId: string): ExternalTool[] {
    const set = activatedFor(sessionId)
    return allTools.value.filter((t) => deferred(t, set))
  }

  const NO_ACTIVATIONS: ReadonlySet<string> = new Set()

  /** Every policy-deferred tool, IGNORING session activation — the system
   *  prompt lists this frozen catalog so its bytes stay identical across turns
   *  (activation would otherwise shrink the list and invalidate the provider's
   *  prompt-cache prefix). Activation changes which schemas are sent, never
   *  the catalog text. */
  const deferredCatalog = computed<ExternalTool[]>(() =>
    allTools.value.filter((t) => deferred(t, NO_ACTIVATIONS)),
  )

  /* ── recall ───────────────────────────────────────────────────────────── */

  /** Deferred tools this KB has actually used, most recent first (capped). A
   *  fresh session starts with these already active, so the common case costs
   *  no enable_tools round trip AND keeps its tool set — the very front of the
   *  provider's cache prefix — byte-stable from the first request. Mid-session
   *  activation still works; it just stops being the norm. */
  const recalled = ref<string[]>([])

  /** The KB's recall list, hydrating from storage when the ref is empty.
   *  The kb-switch watch also hydrates, but callers cannot rely on it having
   *  run: watchers on `kb.name` fire in store-construction order, and the chat
   *  store's (which calls `preactivate` while opening tabs) may sit ahead of
   *  ours — with only the watch, a freshly loaded page preactivated nothing.
   *  Reading here removes the race; the ref still carries state where storage
   *  is unavailable (private mode, node tests). */
  function currentRecall(): string[] {
    const kbName = useKbStore().name
    if (!recalled.value.length && kbName) {
      recalled.value = readRecall()[kbName] ?? []
    }
    return recalled.value
  }

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
    if (!deferred(t, NO_ACTIVATIONS)) return
    const cur = currentRecall()
    const next = recallTouch(cur, qualifiedName)
    if (next.join('\n') === cur.join('\n')) return
    recalled.value = next
    persistRecall()
  }

  /** Seed a new session with the recalled tools. Called once per session,
   *  before its first request.
   *
   *  Deliberately NOT validated against `allTools`: on a cold page load this
   *  runs while servers are still connecting, and filtering against the
   *  not-yet-populated list dropped the recall precisely when it mattered.
   *  Names go into the set raw; one whose server never (re)connects simply
   *  never matches a tool, which is the same outcome the filter bought. */
  function preactivate(sessionId: string): void {
    const names = currentRecall()
    if (!names.length) return
    const next = new Set(activatedFor(sessionId))
    for (const n of names) next.add(n)
    const map = new Map(activated.value)
    map.set(sessionId, next)
    activated.value = map
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
  /**
   * The extension's fetch_url bound as an MCP wire, or null when localmd
   * Connect isn't connected.
   *
   * Resolved per connect rather than cached: the extension row can drop and
   * come back under a proxied row that outlives it, and routing through a stale
   * serverId would keep failing after the thing it depends on had healed.
   */
  function extensionWireOrNull(): McpWire | null {
    const fetchTool = allTools.value.find((t) => t.def.name === EXTENSION_FETCH_TOOL)
    if (!fetchTool) return null
    const { serverId } = fetchTool
    return extensionWire((args, signal) => callTool(serverId, EXTENSION_FETCH_TOOL, args, signal))
  }

  /* ── OAuth ─────────────────────────────────────────────────────────────── */

  /** The wire a row's own OAuth traffic must take: a server that refuses
   *  browsers refuses its token endpoint too. */
  function wireFor(config: McpServerConfig): McpWire | null {
    if (config.transport !== 'extension') return directWire
    return extensionWireOrNull()
  }

  /** The Authorization header a signed-in row should connect with, refreshing
   *  first when the stored token has expired. Empty for rows that never signed
   *  in, which is most of them. */
  /**
   * Spend the refresh token and store what comes back. True when a new access
   * token was obtained.
   *
   * A failure leaves the old token in place rather than signing the user out:
   * the server may simply have been unreachable, and discarding a credential
   * over a network blip is the wrong trade — a red row is recoverable, a
   * discarded refresh token is not.
   */
  async function refreshAuth(config: McpServerConfig): Promise<boolean> {
    const settings = useSettingsStore()
    const auth = settings.state.mcpAuth[config.id]
    if (!auth?.refreshToken) return false
    const wire = wireFor(config)
    if (!wire) return false
    const found = await discover(wire, config.url)
    if ('error' in found) return false
    const next = await requestToken(
      wire,
      found.meta,
      tokenRequestBody({
        grant: 'refresh_token',
        // A token can only be refreshed by the client it was issued to.
        clientId: auth.clientId ?? cimdUrl() ?? '',
        refreshToken: auth.refreshToken,
        resource: config.url,
      }),
    )
    if ('error' in next) return false
    settings.state.mcpAuth = {
      ...settings.state.mcpAuth,
      [config.id]: { ...auth, ...next, issuer: found.issuer },
    }
    return true
  }

  /** The Authorization header a signed-in row connects with, renewed first when
   *  the stored one has expired by the clock. Empty for rows that never signed
   *  in, which is most of them. */
  async function bearerFor(config: McpServerConfig): Promise<{ token?: string }> {
    const settings = useSettingsStore()
    const auth = settings.state.mcpAuth[config.id]
    if (!auth) return {}
    if (isExpired(auth)) await refreshAuth(config)
    // Whatever is stored now: the renewed token, or the old one when renewing
    // could not happen. Sending a stale token and letting the server say 401 is
    // better than refusing to connect on our own authority — the clock is ours,
    // and it can be wrong.
    return { token: settings.state.mcpAuth[config.id]?.accessToken ?? auth.accessToken }
  }

  /**
   * Sign one row in. Returns null on success, else a message to show.
   *
   * The order matters and is the spec's: find the authorization server from the
   * endpoint itself, decide how to identify as a client, then send the user to
   * a page we do not control and wait for a code we can only redeem with a
   * verifier that never left this tab.
   */
  async function signIn(serverId: string): Promise<string | null> {
    const settings = useSettingsStore()
    const state = servers.value.find((s) => s.config.id === serverId)
    if (!state) return 'That server is no longer configured.'
    const config = state.config

    const wire = wireFor(config)
    if (!wire) return EXTENSION_TRANSPORT_MISSING

    const found = await discover(wire, config.url)
    if ('error' in found) return found.error
    if (!supportsPublicPkce(found.meta)) {
      // Worth saying plainly: no amount of retrying fixes a server that will
      // only talk to a client holding a secret, which a page cannot be.
      return 'This server only accepts apps that can keep a client secret, which a browser app cannot do.'
    }

    const identity = await clientIdentity(wire, found.meta, {
      ...(cimdUrl() ? { cimdUrl: cimdUrl()! } : {}),
      clientName: 'localmd',
      redirectUris: [redirectUri()],
      known: settings.state.mcpClients[found.issuer],
    })
    if ('error' in identity) return identity.error
    if (identity.via === 'dcr' && !settings.state.mcpClients[found.issuer]) {
      settings.state.mcpClients = {
        ...settings.state.mcpClients,
        [found.issuer]: identity.clientId,
      }
    }

    const verifier = randomToken()
    const expected = { state: randomToken(), issuer: found.issuer }
    const popup = await authorizeInPopup(
      buildAuthorizeUrl({
        meta: found.meta,
        clientId: identity.clientId,
        redirectUri: redirectUri(),
        challenge: await pkceChallenge(verifier),
        state: expected.state,
        resource: config.url,
        ...(found.meta.scopes_supported?.length
          ? { scope: found.meta.scopes_supported.join(' ') }
          : {}),
      }),
    )
    if (popup.error || !popup.href) return popup.error ?? 'Sign-in did not complete.'

    const cb = parseCallback(popup.href)
    const fault = callbackFault(cb, expected)
    if (fault) return fault

    const token = await requestToken(
      wire,
      found.meta,
      tokenRequestBody({
        grant: 'authorization_code',
        clientId: identity.clientId,
        code: cb.code,
        verifier,
        redirectUri: redirectUri(),
        resource: config.url,
      }),
    )
    if ('error' in token) return token.error

    settings.state.mcpAuth = {
      ...settings.state.mcpAuth,
      [serverId]: { ...token, issuer: found.issuer, clientId: identity.clientId },
    }
    await reconnect(serverId)
    return null
  }

  /** Forget this row's tokens. The registration stays: it belongs to the
   *  authorization server and signing in again should reuse it. */
  function signOut(serverId: string): void {
    const settings = useSettingsStore()
    if (!settings.state.mcpAuth[serverId]) return
    const next = { ...settings.state.mcpAuth }
    delete next[serverId]
    settings.state.mcpAuth = next
    void reconnect(serverId)
  }

  function isSignedIn(serverId: string): boolean {
    return !!useSettingsStore().state.mcpAuth[serverId]
  }

  async function connectServer(raw: McpServerConfig, source: 'global' | 'kb' = 'global'): Promise<void> {
    clients.get(raw.id)?.dispose()
    // A row that arrived with the folder may NAME a key but never receives one.
    //
    // Keys live in one flat namespace, so a shared knowledge base could ship an
    // .agents/mcp.json pointing at any host and referencing a key the user
    // stored for someone else — opening the folder would hand it over. HTTP
    // tools already refuse the same combination (see httpTools' anyOrigin
    // check); this is that rule for servers. A KB row wanting authentication
    // has to carry its own literal, which is the KB author's secret to spend,
    // not the reader's.
    if (source === 'kb' && serverSecretRefs(raw).length) {
      patch(raw.id, { status: 'error', error: KB_SECRET_REFUSED, tools: [] })
      return
    }
    // Secrets are substituted here, not at install: the row holds references,
    // so entering or rotating a key takes effect on the next connect with
    // nothing to re-add.
    const resolved = resolveServerSecrets(raw, (id) => useSettingsStore().state.toolSecrets[id])
    if ('missing' in resolved) {
      patch(raw.id, {
        status: 'error',
        error: missingSecretMessage(resolved.missing),
        tools: [],
      })
      return
    }
    // A signed-in row carries its access token here rather than in stored
    // config: it is minted and refreshed by the flow, so it belongs to the
    // connection, not to what the user typed. Refreshing on connect covers the
    // ordinary case of a token that went stale while the tab was closed.
    const config = { ...resolved.config, ...(await bearerFor(raw)) }
    let client: McpClientLike
    try {
      client = clientFor(config, extensionWireOrNull())
    } catch (err) {
      // Only clientFor's "extension isn't connected" case reaches here, and it
      // is a setup problem rather than a failed handshake — same red row, but
      // the message tells them what to install.
      patch(config.id, { status: 'error', error: (err as Error).message, tools: [] })
      return
    }
    // A transport that drops on its own must show up as red, not stay green
    // until someone happens to run a tool.
    client.onLost = (reason) => {
      if (clients.get(config.id) === client) patch(config.id, { status: 'error', error: reason })
    }
    // A tool's image lands in `.tmp/` like a pasted screenshot does, and the
    // model gets the path to view_image. Only with a folder open — the sink
    // says so by returning null, and the result then says the image could not
    // be shown rather than pretending it was.
    client.imageSink = async (img) => {
      if (!useKbStore().name) return null
      const bin = atob(img.data)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const ext = img.mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
      return importTempFile(new File([bytes], `tool-image.${ext}`, { type: img.mimeType }))
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
    // The extension first, and only then everything else: a row with transport
    // 'extension' reaches its endpoint THROUGH the extension's own fetch_url,
    // so connecting the two concurrently would race — the proxied row would
    // look up fetch_url before the row providing it had finished its handshake.
    const live = servers.value.filter((s) => s.status !== 'off')
    const [relay, rest] = [
      live.filter((s) => isLocalmdConnectRelayUrl(s.config.url)),
      live.filter((s) => !isLocalmdConnectRelayUrl(s.config.url)),
    ]
    await Promise.all(relay.map((s) => connectServer(s.config, s.source)))
    await Promise.all(rest.map((s) => connectServer(s.config, s.source)))
  }

  /** Reconnect ONE server, leaving every healthy connection alone — the button
   *  in Settings, and what an auto-retry uses. */
  async function reconnect(serverId: string): Promise<void> {
    const state = servers.value.find((s) => s.config.id === serverId)
    if (!state || state.config.enabled === false) return
    await connectServer(state.config, state.source)
  }

  /* ── localmd Connect relay presence ───────────────────────────────────── */

  /**
   * The extension's id when its relay is on this page, else null — the whole
   * of "is localmd Connect connectable?", read straight from the DOM marker.
   *
   * Re-checked rather than read once because the answer is a user action away:
   * they open the extension's popup, add this origin, and come back. Note what
   * re-checking can and cannot do — the extension registers its relay for FUTURE
   * navigations, so the marker appears on the next page load, not the moment the
   * origin is added. That is why the setup panel offers Reload as the action and
   * this only heals the cases that need no reload (the extension enabled again,
   * a dev build swapped in, a stored id that turns out to be the installed one).
   */
  const connectExt = ref<string | null>(relayExtensionId())
  const connectReady = computed(() => connectExt.value !== null)

  const connectRows = computed(() =>
    servers.value.filter((s) => isLocalmdConnectRelayUrl(s.config.url)),
  )

  function recheckRelay(): void {
    const next = relayExtensionId()
    if (next === connectExt.value) return
    connectExt.value = next
    // The marker turned up (or names a different build now): the extension's
    // rows are connectable, so heal them instead of making the user find
    // Reconnect.
    if (next) for (const s of connectRows.value) void reconnect(s.config.id)
  }

  if (typeof window !== 'undefined') {
    // Coming back to the tab is the moment setup is most likely to have finished.
    window.addEventListener('focus', recheckRelay)
    document.addEventListener('visibilitychange', recheckRelay)
    let timer: ReturnType<typeof setInterval> | null = null
    watch(
      () => connectRows.value.length > 0 && !connectReady.value,
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

      // Two ways a call can be worth sending again, and they need different
      // remedies. A dropped port or a dead session is fixed by reconnecting. An
      // expired token is not: reconnecting with the same rejected credential
      // earns a second 401, so the token has to be renewed FIRST and the
      // reconnect then picks it up. Renewing is also the gate — a 401 we cannot
      // do anything about stays an error rather than becoming a retry loop.
      const state = servers.value.find((s) => s.config.id === serverId)
      const retryable =
        isRecoverable(err) || (isAuthFailure(err) && !!state && (await refreshAuth(state.config)))
      if (!retryable) {
        patch(serverId, { status: 'error', error: (err as Error).message })
        throw err
      }
      // Whichever path got here, the request provably never ran: the transport
      // was gone, or the server turned it away before dispatching anything. So
      // sending it once more cannot run the tool twice. One attempt, then the
      // error stands.
      await reconnect(serverId)
      const client = clients.get(serverId)
      if (!client) throw err
      return client.callTool(tool, args, signal)
    }
  }

  // Published for clientFor's notification handler, which is built before this
  // function exists but can only ever run after a connection does.
  callToolRef.value = (serverId, tool, args) => callTool(serverId, tool, args)

  /**
   * Pull whatever the user captured in their browser, without waiting to be
   * told about it.
   *
   * The extension pokes when something arrives, and that poke needs a live
   * port — which Chrome takes away whenever it recycles the extension's service
   * worker. So the push half is a fast path, not a delivery guarantee, and the
   * PULL half had no trigger of its own: captures sat in the queue until
   * something else happened to reconnect.
   *
   * Asking is cheap and self-healing: the relay redials its port on the way
   * OUT, so a call revives a connection a notification could never have
   * reached. Called on every return to this tab, which is exactly the moment
   * someone arrives from their browser having pressed "Ask localmd".
   */
  async function drainConnectInboxes(): Promise<void> {
    for (const s of connectRows.value) {
      if (s.status === 'error') continue // retryFailed is already on it
      try {
        await drainInbox({
          serverId: s.config.id,
          call: (tool, args) => callTool(s.config.id, tool, args),
        })
      } catch {
        // A drain that cannot reach the extension leaves the queue alone; the
        // next return to the tab tries again.
      }
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

  /**
   * Entering a key a row was waiting on should bring it up, without the user
   * having to know that "add the key" and "connect" are two steps.
   *
   * Watched by PRESENCE, not value: the secrets field writes on every keystroke,
   * so watching values would dial the server once per character. And only the
   * failing rows are retried — a healthy connection is never dropped because
   * some unrelated key changed. Rotating a key in place therefore still needs
   * Reconnect, which is the rarer act and the one worth being deliberate about.
   */
  watch(
    () =>
      settings.state.mcpServers
        .flatMap((s) => serverSecretRefs(s))
        .map((id) => `${id}:${settings.state.toolSecrets[id] ? 1 : 0}`)
        .sort()
        .join(','),
    () => void retryFailed(),
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
    connectExt,
    connectReady,
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
    drainConnectInboxes,
    signIn,
    signOut,
    isSignedIn,
    callTool,
  }
})
