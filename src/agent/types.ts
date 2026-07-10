/** Events emitted while an agent turn runs, consumed by the chat UI. */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; detail: string }

export type AgentEventHandler = (e: AgentEvent) => void
