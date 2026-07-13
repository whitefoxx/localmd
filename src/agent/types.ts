/** Events emitted while an agent turn runs, consumed by the chat UI. */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  /** A tool call started. When `id` is present the UI tracks it as in-flight
   *  (spinner + live timer) until the matching `tool_result` arrives — used for
   *  external MCP tools, which can take anywhere from instant to minutes. */
  | { type: 'tool'; name: string; detail: string; id?: number }
  /** A previously-started (id-bearing) tool call finished. */
  | { type: 'tool_result'; id: number; ok: boolean }
  /** Per-API-request token usage (a turn with tool calls emits several). */
  | { type: 'usage'; input: number; output: number; cacheRead: number }

export type AgentEventHandler = (e: AgentEvent) => void
