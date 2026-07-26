/** Events emitted while an agent turn runs, consumed by the chat UI. */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  /** A tool call started. When `id` is present the UI tracks it as in-flight
   *  (spinner + live timer) until the matching `tool_result` arrives — used for
   *  external MCP tools, which can take anywhere from instant to minutes. */
  | { type: 'tool'; name: string; detail: string; id?: number; args?: Record<string, unknown> }
  /** A previously-started (id-bearing) tool call finished. `result` is the raw
   *  output string (the UI caps it) so the transcript can show what it returned. */
  | { type: 'tool_result'; id: number; ok: boolean; result?: string }
  /** Per-API-request token usage (a turn with tool calls emits several).
   *  cacheRead/cacheWrite let the UI show how much of the input hit the
   *  provider's prompt cache (billed at a fraction of fresh input). */
  | { type: 'usage'; input: number; output: number; cacheRead: number; cacheWrite: number }
  /** An artifact (self-contained interactive HTML). `pending` fires when the
   *  model STARTS emitting one (its HTML streams for a while) so the chat can
   *  show a loading card; the non-pending event (once written) fills in the
   *  title/path and makes the card clickable. */
  | { type: 'artifact'; title: string; path: string; pending?: boolean }
  /** A generated image saved into the KB (generate_image tool) — the chat shows
   *  it inline; `path` is its KB location. */
  | { type: 'image'; path: string }
  /** The turn stopped because it ran out of steps, not because the work was
   *  done. Without this the two are indistinguishable: the model's last
   *  sentence often promises an action that never came, and any plan it was
   *  keeping is left mid-flight. */
  | { type: 'limit'; steps: number }

export type AgentEventHandler = (e: AgentEvent) => void
