import type { HunkLine } from '@/lib/diff'
import type { ApprovalDecision } from '@/stores/approvals'

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
   *  provider's prompt cache (billed at a fraction of fresh input).
   *
   *  `subagent` marks usage from a delegated context rather than this turn's.
   *  It still counts towards what the turn COST, but it measures a different
   *  and much smaller history — so anything reading `input` as "how big is
   *  this conversation" (lib/tokenMeter's anchor) must skip these. */
  | {
      type: 'usage'
      input: number
      output: number
      cacheRead: number
      cacheWrite: number
      subagent?: true
    }
  /** An artifact (self-contained interactive HTML). `pending` fires when the
   *  model STARTS emitting one (its HTML streams for a while) so the chat can
   *  show a loading card; the non-pending event (once written) fills in the
   *  title/path and makes the card clickable. */
  | { type: 'artifact'; title: string; path: string; pending?: boolean }
  /** A generated image saved into the KB (generate_image tool) — the chat shows
   *  it inline; `path` is its KB location. */
  | { type: 'image'; path: string }
  /** An ask-first write paused on the user: renders as a decision card in the
   *  transcript, right where the request was made. `diff` is precomputed and
   *  capped at emit time so the part stays small enough to persist; `truncated`
   *  counts diff lines dropped by the cap. The tool stays blocked until the
   *  matching `approval_result`. */
  | {
      type: 'approval'
      id: string
      path: string
      /** The change REMOVES the path; the diff is then the doomed content. */
      deleted?: boolean
      /** The removed path is a directory — the diff is its file listing. */
      dir?: boolean
      /** A rejected/undone deletion can put the file back (text snapshot). */
      restorable?: boolean
      diff: HunkLine[]
      added: number
      removed: number
      truncated?: number
    }
  /** The paused write above was decided (or the turn died first) — stamps the
   *  card so it becomes a read-only record of what happened. */
  | { type: 'approval_result'; id: string; decision: ApprovalDecision }
  /** The turn stopped because it ran out of steps, not because the work was
   *  done. Without this the two are indistinguishable: the model's last
   *  sentence often promises an action that never came, and any plan it was
   *  keeping is left mid-flight. */
  | { type: 'limit'; steps: number }

export type AgentEventHandler = (e: AgentEvent) => void
