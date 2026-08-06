/**
 * The agent's HTTP-tool registry — what's installed, from which scope, and how
 * a call actually leaves the browser.
 *
 * Three scopes merge, most specific first (the same precedence MCP servers use):
 *   1. the KB's `.agents/tools.json` — travels with the folder via git
 *   2. the user's own global tools — Settings, localStorage
 *   3. installed catalog entries — lib/toolCatalog.ts
 *
 * KB-scoped tools arrive with the folder, which means a cloned KB can carry
 * tools its user never wrote. They stay inert until that user approves the set
 * once; changing which tools exist, or where they send data, asks again.
 *
 * Two transports. `direct` is a plain fetch and only reaches endpoints that
 * allow browser CORS. `extension` routes through localmd Connect's
 * generic__fetch_url, which runs in a service worker with the user's cookies
 * and no CORS — so it reaches the rest of the web.
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  runHttpTool,
  normalizeHttpToolList,
  dedupeByName,
  toolsFingerprint,
  KB_TOOLS_CONFIG_PATH,
  type HttpToolSpec,
  type HttpReply,
  type HttpTransport,
  type BuiltRequest,
} from '@/lib/httpTools'
import {
  CATALOG,
  catalogEntryById,
  toolsForEntries,
  EXTENSION_FETCH_TOOL,
} from '@/lib/toolCatalog'
import { parseExtensionFetch } from '@/lib/connectRelay'
import { useSettingsStore } from '@/stores/settings'
import { useMcpStore } from '@/stores/mcp'
import { useKbStore } from '@/stores/kb'
import { useLicenceStore } from '@/stores/licence'
import { isBundledToolSource, lockedToolResult } from '@/lib/licence'
import * as fs from '@/lib/fs'

const TRUST_KEY = 'browser-md:kb-tools-trust:v1'
const DIRECT_TIMEOUT_MS = 45_000
/** Enough for a JSON payload we still have to parse; the spec's own maxChars
 *  does the token-facing trimming afterwards. */
const EXTENSION_MAX_BYTES = 500_000

function readTrust(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TRUST_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export const useToolsStore = defineStore('tools', () => {
  const settings = useSettingsStore()
  const mcp = useMcpStore()
  const kb = useKbStore()

  const kbTools = ref<HttpToolSpec[]>([])
  /** Fingerprint the user approved for the open KB (absent = never asked). */
  const kbTrustedFingerprint = ref<string | null>(null)

  const kbFingerprint = computed(() => toolsFingerprint(kbTools.value))
  const kbTrusted = computed(
    () => kbTools.value.length > 0 && kbTrustedFingerprint.value === kbFingerprint.value,
  )
  /** KB tools waiting on the user — surfaced in Settings, never registered. */
  const kbPending = computed(() => (kbTools.value.length && !kbTrusted.value ? kbTools.value : []))
  /** KB tools in force. Listed in Settings so an approved integration stays
   *  visible: approving something and then never seeing it again is how a user
   *  loses track of what the agent can reach. */
  const kbActive = computed(() => (kbTrusted.value ? kbTools.value : []))

  const catalogTools = computed(() => toolsForEntries(settings.state.toolEntries))
  /** The bundled tools — today the web-search pair. Free forever, and never
   *  filtered: a knowledge base that cannot look anything up is not a product. */
  const bundledTools = computed(() =>
    toolsForEntries(settings.state.toolEntries.filter(isBundledToolSource)),
  )

  /** Everything the agent may call this session.
   *
   *  Everything except the bundled tools reaches past the user's own folder and
   *  model — a service the KB folder named, a tool authored against someone's
   *  API — so it waits on a licence. Bundled ones are appended last so the
   *  shadowing order among the paid ones is unchanged from when they were the
   *  whole list. */
  const specs = computed<HttpToolSpec[]>(() => {
    const licence = useLicenceStore()
    const licensed = licence.restricted
      ? []
      : [
          ...(kbTrusted.value ? kbTools.value : []),
          ...settings.state.httpTools,
          ...catalogTools.value,
        ]
    return dedupeByName([...licensed, ...bundledTools.value])
  })

  /* ── catalog install / uninstall ───────────────────────────────────────── */

  function isInstalled(entryId: string): boolean {
    const entry = catalogEntryById(entryId)
    if (!entry) return false
    if (entry.server) return settings.state.mcpServers.some((s) => s.url === entry.server!.url)
    return settings.state.toolEntries.includes(entryId)
  }

  /** Extension and MCP entries become ordinary server rows, so everything that
   *  already handles servers — status, enable/disable, edit, the KB override —
   *  keeps working without a parallel code path. */
  function install(entryId: string): void {
    const entry = catalogEntryById(entryId)
    if (!entry || isInstalled(entryId)) return
    if (entry.server) {
      settings.state.mcpServers = [
        ...settings.state.mcpServers,
        {
          id: crypto.randomUUID(),
          name: entry.server.name,
          url: entry.server.url,
          // Copied as written: any {{secret:…}} stays a reference, so the row
          // works whether the key is entered before or after installing.
          ...(entry.server.token ? { token: entry.server.token } : {}),
          ...(entry.server.headers ? { headers: entry.server.headers } : {}),
        },
      ]
      return
    }
    settings.state.toolEntries = [...settings.state.toolEntries, entryId]
  }

  function uninstall(entryId: string): void {
    const entry = catalogEntryById(entryId)
    if (!entry) return
    if (entry.server) {
      settings.state.mcpServers = settings.state.mcpServers.filter(
        (s) => s.url !== entry.server!.url,
      )
      return
    }
    settings.state.toolEntries = settings.state.toolEntries.filter((id) => id !== entryId)
  }

  function setSecret(id: string, value: string): void {
    const next = { ...settings.state.toolSecrets }
    if (value) next[id] = value
    else delete next[id]
    settings.state.toolSecrets = next
  }

  function hasSecret(id: string): boolean {
    return !!settings.state.toolSecrets[id]
  }

  /* ── KB scope ──────────────────────────────────────────────────────────── */

  async function loadKbTools(): Promise<void> {
    if (!kb.isOpen) {
      kbTools.value = []
      return
    }
    const raw = await fs.tryReadFile(KB_TOOLS_CONFIG_PATH)
    if (!raw) {
      kbTools.value = []
      return
    }
    try {
      const parsed = JSON.parse(raw) as { tools?: unknown }
      kbTools.value = normalizeHttpToolList(parsed.tools, () => crypto.randomUUID())
    } catch {
      kbTools.value = [] // malformed file — the pending list simply stays empty
    }
  }

  /** Approve the KB's current tool set for this KB. */
  function trustKbTools(): void {
    const name = kb.name
    if (!name) return
    kbTrustedFingerprint.value = kbFingerprint.value
    try {
      localStorage.setItem(
        TRUST_KEY,
        JSON.stringify({ ...readTrust(), [name]: kbFingerprint.value }),
      )
    } catch {
      /* private mode — the approval just won't survive a reload */
    }
  }

  /* ── transports ────────────────────────────────────────────────────────── */

  const fetchTool = computed(() => mcp.allTools.find((t) => t.def.name === EXTENSION_FETCH_TOOL))
  const extensionConnected = computed(() => !!fetchTool.value)

  const direct: HttpTransport = async (req: BuiltRequest, signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(DIRECT_TIMEOUT_MS)
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      ...(req.body !== undefined ? { body: req.body } : {}),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    return { status: res.status, ok: res.ok, body: await res.text() }
  }

  const extension: HttpTransport = async (req: BuiltRequest, signal?: AbortSignal) => {
    const tool = fetchTool.value
    if (!tool) throw new Error('no browser extension (localmd Connect) is connected')
    const out = await mcp.callTool(
      tool.serverId,
      EXTENSION_FETCH_TOOL,
      {
        url: req.url,
        method: req.method,
        headers: JSON.stringify(req.headers),
        ...(req.body !== undefined ? { body: req.body } : {}),
        format: 'text',
        max_bytes: EXTENSION_MAX_BYTES,
      },
      signal,
    )
    // `format:'text'` guarantees the payload is in `body`, so one shaping path
    // serves both transports.
    const parsed = parseExtensionFetch(out)
    return {
      status: parsed.status ?? 0,
      ok: parsed.ok === true,
      body: parsed.body ?? '',
    } satisfies HttpReply
  }

  /** Run one installed tool. Returns the model-facing string (errors included). */
  /** Exactly the bundled specs, by id — membership, not a name prefix, so a
   *  hand-written spec calling itself `jina.something` gains nothing. */
  const bundledToolIds = computed(() => new Set(bundledTools.value.map((s) => s.id)))

  async function run(
    spec: HttpToolSpec,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    // `specs` already withholds licensed tools from the agent, but this is the
    // execution point and takes an arbitrary spec: the editor's Test button and
    // the agent's dry run both arrive here with a spec that was never in that
    // list. Gating the list alone would leave a way to run one anyway.
    if (!bundledToolIds.value.has(spec.id) && useLicenceStore().restricted) {
      return lockedToolResult(spec.name)
    }
    return runHttpTool(spec, args, {
      resolveSecret: (id) => settings.state.toolSecrets[id],
      direct,
      extension: extensionConnected.value ? extension : null,
      ...(signal ? { signal } : {}),
    })
  }

  /** Run an unsaved spec — the editor's Test button and the agent's dry run. */
  async function test(
    spec: HttpToolSpec,
    args: Record<string, unknown>,
  ): Promise<string> {
    return run(spec, args)
  }

  // KB tools follow the open folder; the approval is per KB, so both reload
  // together and a KB with no approval starts untrusted.
  watch(
    () => kb.name,
    (name) => {
      kbTrustedFingerprint.value = name ? (readTrust()[name] ?? null) : null
      void loadKbTools()
    },
    { immediate: true },
  )

  return {
    specs,
    catalog: CATALOG,
    kbPending,
    kbActive,
    kbTrusted,
    extensionConnected,
    isInstalled,
    install,
    uninstall,
    setSecret,
    hasSecret,
    trustKbTools,
    reloadKbTools: loadKbTools,
    run,
    test,
  }
})
