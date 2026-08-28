/**
 * How a tool call reads in the transcript — the one place that decides it.
 *
 * The decision used to be spread across three spots that did not know about
 * each other: the tool's `describeCall` baked a label at emit time, the chat
 * panel kept its own name→glyph table (which had quietly fallen fourteen tools
 * behind TOOLS, so a third of the toolbox rendered as an anonymous wrench), and
 * what a call actually RETURNED was shown nowhere until the row was expanded —
 * a failure looked exactly like a success in a different colour.
 *
 * Both functions are pure over the persisted part, which is the point: a
 * reloaded session presents identically to a live one, the chat panel and the
 * markdown export agree by construction rather than by everyone remembering,
 * and the whole surface is testable without mounting anything.
 *
 * They decide WHAT happened and never how to word it — `kind` is structural, so
 * the panel can translate it while the saved markdown stays English. The one
 * string that crosses is `message`, which is the tool's own text passed
 * through, not our chrome.
 */
import type { MessagePart } from '@/stores/chat'

type ToolPart = Extract<MessagePart, { type: 'tool' }>

/** The result a tool call is handed when the user presses stop mid-flight. It
 *  is both the model-facing text and the string a row recognises, so it lives
 *  with the presentation: a stop is not a failure, and the transcript should
 *  not paint it red. */
export const STOPPED_RESULT = 'Stopped by the user before this tool finished.'

/** Longest failure message a collapsed row carries; the rest is one click away. */
const MAX_MESSAGE = 120

/** Per-tool glyph, so the transcript reads at a glance. Keyed by name rather
 *  than hung off the tool definition on purpose: a saved session names tools
 *  this build may no longer have, and the row still has to render.
 *  `present.test.ts` holds this in lockstep with TOOLS — a new tool without a
 *  glyph fails there instead of silently joining the wrenches. */
const TOOL_ICONS: Record<string, string> = {
  list_files: 'codicon-list-tree',
  read_file: 'codicon-file',
  write_file: 'codicon-edit',
  edit_file: 'codicon-edit',
  delete_path: 'codicon-trash',
  move_path: 'codicon-file-symlink-file',
  create_directory: 'codicon-new-folder',
  open_file: 'codicon-go-to-file',
  create_artifact: 'codicon-file-code',
  search_files: 'codicon-search',
  kb_health: 'codicon-pulse',
  index_document: 'codicon-book',
  save_transcript: 'codicon-save',
  read_session: 'codicon-comment-discussion',
  update_plan: 'codicon-checklist',
  use_skill: 'codicon-lightbulb',
  app_help: 'codicon-question',
  app_settings: 'codicon-settings-gear',
  enable_tools: 'codicon-plug',
  manage_tools: 'codicon-extensions',
  request_setup: 'codicon-key',
  git_init: 'codicon-repo',
  git_status: 'codicon-source-control',
  git_diff: 'codicon-diff',
  git_restore: 'codicon-discard',
  git_log: 'codicon-history',
  git_commit: 'codicon-git-commit',
  git_push: 'codicon-repo-push',
  git_pull: 'codicon-repo-pull',
  git_remote_add: 'codicon-cloud',
  github_create_repo: 'codicon-github',
  view_image: 'codicon-device-camera',
  generate_image: 'codicon-file-media',
  run_subagent: 'codicon-run-all',
  compact: 'codicon-fold',
}

/** Rows the runner emits that are not entries in TOOLS: `compact` is the
 *  history shrink announced by both the pre-turn compaction and the
 *  context-overflow repair. The lockstep test allows exactly these extras. */
export const SYNTHETIC_TOOL_ROWS: readonly string[] = ['compact']

const GENERIC_ICON = 'codicon-tools'
const SPINNER = 'codicon-loading codicon-modifier-spin'

/**
 * What came back.
 *
 * - `pending` — still running.
 * - `failed` — the tool errored; `message` is its own first line.
 * - `stopped` — the user pressed stop before it finished.
 * - `empty` — it finished and returned nothing, which the row should say
 *   rather than leave looking identical to a row still waiting.
 * - `ok` — it finished with output, or the call was never tracked (a nested
 *   subagent row carries no status). Either way there is nothing to add.
 */
export type ResultKind = 'pending' | 'ok' | 'empty' | 'stopped' | 'failed'

export interface ResultPresentation {
  kind: ResultKind
  /** A failure's own words — first non-blank line, `Error:` prefix dropped,
   *  capped. Absent when the tool failed without saying anything. */
  message?: string
}

export function presentResult(part: ToolPart): ResultPresentation {
  if (part.status === 'running') return { kind: 'pending' }
  const text = part.result?.trim() ?? ''
  if (text === STOPPED_RESULT) return { kind: 'stopped' }
  if (part.status === 'error') {
    const message = firstLine(text)
    return message ? { kind: 'failed', message } : { kind: 'failed' }
  }
  if (part.status === 'done' && !text) return { kind: 'empty' }
  return { kind: 'ok' }
}

function firstLine(text: string): string {
  const line = (text.split('\n').find((l) => l.trim()) ?? '').replace(/^Error:\s*/i, '').trim()
  return line.length > MAX_MESSAGE ? `${line.slice(0, MAX_MESSAGE)}…` : line
}

/** How the row itself is drawn. `tone` is the semantic state; each renderer
 *  maps it to its own colours (the panel) or markers (the markdown export). */
export type CallTone = 'running' | 'failed' | 'stopped' | 'plain'

export interface CallPresentation {
  /** Codicon class(es), ready for the panel's `:class`. */
  icon: string
  /** The one-line summary the tool wrote for this call. */
  label: string
  tone: CallTone
  /** There is something behind the chevron — arguments, a result, or both. */
  expandable: boolean
}

export function presentCall(part: ToolPart): CallPresentation {
  const { kind } = presentResult(part)
  return {
    icon: iconFor(part, kind),
    label: part.detail,
    tone: toneFor(kind),
    expandable: hasArgs(part) || !!part.result,
  }
}

function toneFor(kind: ResultKind): CallTone {
  if (kind === 'pending') return 'running'
  if (kind === 'failed') return 'failed'
  if (kind === 'stopped') return 'stopped'
  return 'plain'
}

function iconFor(part: ToolPart, kind: ResultKind): string {
  if (kind === 'pending') return SPINNER
  if (kind === 'failed') return 'codicon-error'
  if (kind === 'stopped') return 'codicon-circle-slash'
  const own = TOOL_ICONS[part.name]
  if (own) return own
  // An external tool (an MCP server's, an installed HTTP one) has no glyph of
  // its own; a finished one shows a check so the row still reads as arrived.
  return part.status === 'done' ? 'codicon-pass' : GENERIC_ICON
}

/** Arguments worth expanding. Only the dynamically-registered tools carry them
 *  — a built-in's would put whole file contents in the persisted session. */
export function hasArgs(part: ToolPart): boolean {
  return !!part.args && Object.keys(part.args).length > 0
}

/** A duration as short as it can be without lying: tenths under ten seconds,
 *  whole seconds past that. Shared by tool rows and thinking blocks so the two
 *  cannot drift into different-looking clocks. */
export function formatDuration(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`
}
