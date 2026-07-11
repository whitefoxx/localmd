/** Events emitted while an agent turn runs, consumed by the chat UI. */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool'; name: string; detail: string }
  /** Per-API-request token usage (a turn with tool calls emits several). */
  | { type: 'usage'; input: number; output: number; cacheRead: number }

export type AgentEventHandler = (e: AgentEvent) => void
