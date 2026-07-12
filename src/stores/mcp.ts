/**
 * External tool sources — MCP servers from TWO config scopes, merged:
 *   - global: Settings (localStorage, follows the browser)
 *   - KB-level: `.agents/mcp.json` in the opened folder (travels with the KB
 *     via git; duplicate targets override global — the KB is more specific)
 * Transports: Streamable HTTP, or a chrome.runtime Port when the url field is
 * a 32-char extension ID. Connected servers contribute namespaced tools
 * (mcp__<server>__<tool>) that both agent providers append per turn.
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  McpHttpClient,
  McpExtensionClient,
  isExtensionId,
  externalToolName,
  sanitizeServerName,
  normalizeMcpServerList,
  mergeMcpConfigs,
  KB_MCP_CONFIG_PATH,
  type McpClientLike,
  type McpServerConfig,
  type McpToolDef,
} from '@/lib/mcp'
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

  async function refresh(): Promise<void> {
    const settings = useSettingsStore()
    const kb = useKbStore()
    const kbServers = kb.isOpen ? await loadKbServers() : []
    const merged = mergeMcpConfigs(settings.state.mcpServers, kbServers)

    clients.clear()
    servers.value = merged.map(({ source, ...config }) => ({
      config,
      source,
      status: config.enabled === false ? 'off' : 'connecting',
      tools: [],
    }))
    await Promise.all(
      servers.value.map(async (state, i) => {
        if (state.status === 'off') return
        const config = state.config
        // A Chrome extension ID in the url field selects the Port transport
        // (web-agent bridge); anything else is a Streamable-HTTP endpoint.
        const client: McpClientLike = isExtensionId(config.url)
          ? new McpExtensionClient(config)
          : new McpHttpClient(config)
        clients.set(config.id, client)
        try {
          const tools = await client.connect()
          servers.value[i] = { ...servers.value[i], status: 'ok', tools }
        } catch (err) {
          servers.value[i] = {
            ...servers.value[i],
            status: 'error',
            error: (err as Error).message,
            tools: [],
          }
        }
      }),
    )
  }

  async function callTool(
    serverId: string,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const client = clients.get(serverId)
    if (!client) throw new Error(`MCP server not connected: ${serverId}`)
    return client.callTool(tool, args, signal)
  }

  // Reconnect when the global config or the opened KB changes.
  const settings = useSettingsStore()
  const kb = useKbStore()
  watch(
    () => [JSON.stringify(settings.state.mcpServers), kb.name] as const,
    () => void refresh(),
    { immediate: true },
  )

  return { servers, allTools, refresh, callTool }
})
