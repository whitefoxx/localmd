/**
 * External tool sources — remote MCP servers (Streamable HTTP) registered in
 * Settings. Each connected server contributes namespaced tools
 * (mcp__<server>__<tool>) that both agent providers append to their tool
 * lists. Designed so other transports (e.g. a Chrome-extension bridge like
 * web-agent) can slot in later as additional source types.
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  McpHttpClient,
  McpExtensionClient,
  isExtensionId,
  externalToolName,
  sanitizeServerName,
  type McpClientLike,
  type McpServerConfig,
  type McpToolDef,
} from '@/lib/mcp'
import { useSettingsStore } from '@/stores/settings'

export interface McpServerState {
  config: McpServerConfig
  status: 'connecting' | 'ok' | 'error'
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
    const configs = settings.state.mcpServers
    clients.clear()
    servers.value = configs.map((config) => ({ config, status: 'connecting', tools: [] }))
    await Promise.all(
      configs.map(async (config, i) => {
        // A Chrome extension ID in the url field selects the Port transport
        // (web-agent bridge); anything else is a Streamable-HTTP endpoint.
        const client: McpClientLike = isExtensionId(config.url)
          ? new McpExtensionClient(config)
          : new McpHttpClient(config)
        clients.set(config.id, client)
        try {
          const tools = await client.connect()
          servers.value[i] = { config, status: 'ok', tools }
        } catch (err) {
          servers.value[i] = { config, status: 'error', error: (err as Error).message, tools: [] }
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

  // Reconnect when the configured server list changes (incl. app start).
  const settings = useSettingsStore()
  watch(
    () => JSON.stringify(settings.state.mcpServers),
    () => void refresh(),
    { immediate: true },
  )

  return { servers, allTools, refresh, callTool }
})
