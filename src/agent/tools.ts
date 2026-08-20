/**
 * The agent's tool surface over the opened KB folder — the browser replacement
 * for trace-app's "Claude Code in a terminal". Tools are defined once with Zod
 * schemas; the Anthropic runner consumes them via betaZodTool and the
 * OpenAI-compatible loop derives JSON Schema with z.toJSONSchema().
 *
 * write_file records a before/after snapshot in the review store so the user
 * can approve or discard agent edits afterwards (the browser equivalent of
 * trace-app's git-based review flow). In ask mode a write instead pauses on an
 * approval card in the conversation (stores/approvals) until the user decides
 * there. delete_path composes both — an undoable snapshot for text files, an
 * always-ask card for the directories and binaries no snapshot can bring back.
 */
import { z } from 'zod'
import * as fs from '@/lib/fs'
import * as g from '@/lib/git'
import { withGitLock, GitBusyError } from '@/lib/gitlock'
import {
  push as ghPush,
  pull as ghPull,
  parseGithubRemote,
  createRepo as ghCreateRepo,
  explainGithubError,
} from '@/lib/github'
import { applyEdit } from '@/lib/edits'
import { renderFileList } from '@/lib/fileList'
import { isTextName } from '@/lib/filetypes'
import { refreshGitStatus } from '@/lib/fileOps'
import { isAnnotationsPath, renderAnnotationsDigest } from '@/lib/annotations'
import {
  httpToolJsonSchema,
  describeHttpCall,
  normalizeHttpTool,
  normalizeHttpToolList,
  groupByBundle,
  secretRefs,
  staticOrigin,
  KB_TOOLS_CONFIG_PATH,
  type HttpToolSpec,
} from '@/lib/httpTools'
import { clipWithRecall, storeToolResult } from '@/lib/toolResults'
import { syncAfterFsChange } from '@/lib/fileOps'
import { clipText } from '@/lib/wellFormed'
import { diffLines, collapseContext, type DiffLine, type HunkLine } from '@/lib/diff'
import { loadSkill, listSkills } from '@/lib/skills'
import { listAppDocsForAgent, appDocForAgent } from '@/lib/appDocs'
import { WRITABLE, WRITABLE_BY_KEY, describeWritable } from '@/lib/appSettings'
import { getLocale } from '@/i18n'
import { CATALOG, catalogEntryById } from '@/lib/toolCatalog'
import { isLocalmdConnectRelayUrl } from '@/lib/connectRelay'
import { confirmConnectCall, noteConnectResult } from '@/agent/connectGuard'
import { noteOpenedTab } from '@/agent/connectJanitor'
import { formatLintReport } from '@/lib/lint'
import { slugify } from '@/lib/docindex/util'
import type { AgentEvent } from '@/agent/types'
import { useReviewStore } from '@/stores/review'
import { useApprovalsStore, type ApprovalDecision } from '@/stores/approvals'
import { useFilesStore } from '@/stores/files'
import { usePlanStore, type PlanItem } from '@/stores/plan'
import { useSettingsStore } from '@/stores/settings'
import { useGitStore } from '@/stores/git'
import { useMcpStore } from '@/stores/mcp'
import { useToolsStore } from '@/stores/tools'
import { useSetupStore } from '@/stores/setup'
import { useKbIndexStore } from '@/stores/kbIndex'
import { useKbStore } from '@/stores/kb'

/** Per-turn execution context threaded from the runners into every tool call,
 *  attributing side effects (writes, plan updates, tool activations) to the
 *  chat session the turn belongs to — concurrent sessions stay isolated. */
export interface ToolCtx {
  sessionId: string
  /** Emit a UI event mid-tool (e.g. an artifact card). Optional so tools that
   *  don't need it stay simple; runners wire it to their onEvent. */
  emit?: (e: AgentEvent) => void
  /** Aborted when the user presses stop. A tool that reaches the network or
   *  grinds through a lot of files hands it on (or checks it) — otherwise the
   *  work outlives the turn that asked for it, and the spinner with it. An
   *  approval pause listens on it too, releasing the waiting tool as 'stopped'
   *  instead of dangling. */
  signal?: AbortSignal
}

/** Longest diff an approval card carries. Cards persist with the session, so
 *  a huge rewrite stores a capped diff plus a "+N more" count, never the lot. */
const MAX_APPROVAL_DIFF_LINES = 300

/** What the paused write shows: for a deletion, the doomed content (or a
 *  directory's file listing) as pure removals; otherwise a collapsed diff. */
function approvalDiff(
  before: string | null,
  after: string,
  deleted: boolean,
): { diff: HunkLine[]; added: number; removed: number; truncated: number } {
  const lines: DiffLine[] = deleted
    ? (before ?? '').split('\n').map((text) => ({ type: 'del', text }))
    : diffLines(before ?? '', after)
  const added = lines.filter((l) => l.type === 'add').length
  const removed = lines.filter((l) => l.type === 'del').length
  const collapsed = collapseContext(lines)
  return {
    diff: collapsed.slice(0, MAX_APPROVAL_DIFF_LINES),
    added,
    removed,
    truncated: Math.max(0, collapsed.length - MAX_APPROVAL_DIFF_LINES),
  }
}

interface AskMeta {
  deleted?: boolean
  dir?: boolean
  restorable?: boolean
}

/** Pause on a decision card in the conversation until the user settles it.
 *  The card (an `approval` message part) is the ONLY prompt — nothing pops
 *  over the user's work; the turn simply waits where the request was made.
 *  A stopped turn (abort signal) releases the pause as 'stopped'. */
async function askUser(
  ctx: ToolCtx,
  path: string,
  before: string | null,
  after: string,
  meta: AskMeta = {},
): Promise<ApprovalDecision> {
  if (ctx.signal?.aborted) return 'stopped'
  const id = crypto.randomUUID()
  ctx.emit?.({ type: 'approval', id, path, ...meta, ...approvalDiff(before, after, !!meta.deleted) })
  const approvals = useApprovalsStore()
  const onAbort = (): void => approvals.settle(id, 'stopped')
  ctx.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const decision = await approvals.ask({ id, sessionId: ctx.sessionId, path })
    ctx.emit?.({ type: 'approval_result', id, decision })
    return decision
  } finally {
    ctx.signal?.removeEventListener('abort', onAbort)
  }
}

/** Gate an ordinary write on the write mode: auto proceeds immediately (the
 *  review store snapshots it afterwards), ask pauses on the user. */
async function approved(
  ctx: ToolCtx,
  path: string,
  before: string | null,
  after: string,
): Promise<ApprovalDecision> {
  if (useSettingsStore().state.writeMode !== 'ask') return 'approved'
  return askUser(ctx, path, before, after)
}

/** What the model is told when a write did not go through. A rejection is an
 *  answer; a stop is the absence of one — conflating them taught the agent to
 *  argue with a refusal nobody had made. */
function notApproved(decision: Exclude<ApprovalDecision, 'approved'>, what: string): string {
  return decision === 'rejected'
    ? `User declined ${what}. Ask them how to proceed instead of retrying.`
    : `The turn was stopped before the user decided about ${what} — nothing was changed, and they did NOT say no. If they follow up, just continue; re-propose the change if it is still wanted.`
}

async function performWrite(
  path: string,
  before: string | null,
  content: string,
): Promise<void> {
  await fs.writeFile(path, content)
  useReviewStore().recordWrite(path, before, content)
  await syncAfterFsChange()
  await useFilesStore().reloadIfClean(path)
}

const MAX_READ_CHARS = 100_000
/** A test preview is for reading structure, not for consuming the data. */
const RAW_TEST_CHARS = 4000
const MAX_SEARCH_RESULTS = 50

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolSpec<S extends z.ZodType = any> {
  name: string
  description: string
  schema: S
  /** One-line human summary of a call, shown in the chat transcript. */
  describeCall: (args: z.infer<S>) => string
  run: (args: z.infer<S>, ctx: ToolCtx) => Promise<string>
}

function defineTool<S extends z.ZodType>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec
}

const listFiles = defineTool({
  name: 'list_files',
  description:
    'List files as newline-separated paths relative to the KB root. Call with no arguments first to understand the KB structure. Pass "dir" to list inside a specific directory — including app-generated index directories under .trace/ (e.g. ".trace/pdf-index"), which the default listing hides.',
  schema: z.object({
    dir: z.string().optional().describe('Directory to list, e.g. ".trace/pdf-index"'),
  }),
  describeCall: (a) => (a.dir ? `list ${a.dir}` : 'list files'),
  run: async ({ dir }) => {
    try {
      const tree = dir ? await fs.readTreeFrom(dir) : await fs.readTree()
      const paths = fs.collectFiles(tree)
      // Huge listings fold into a per-directory summary — drill down with dir.
      return paths.length ? renderFileList(paths) : '(empty directory)'
    } catch (err) {
      if ((err as DOMException).name === 'NotFoundError') return `Error: no such directory: ${dir}`
      throw err
    }
  },
})

/** Serve one window of `content`, telling the model how to read the rest — a
 *  long file is otherwise unreachable past the first MAX_READ_CHARS. */
function clip(content: string, offset = 0): string {
  const from = Math.max(0, Math.trunc(offset))
  if (from && from >= content.length) {
    return `Error: offset ${from} is past the end of the file (${content.length} chars).`
  }
  const window = content.slice(from, from + MAX_READ_CHARS)
  const end = from + window.length
  return end >= content.length
    ? window
    : `${window}\n\n[truncated at ${end} of ${content.length} chars — continue with read_file offset=${end}]`
}

const readFile = defineTool({
  name: 'read_file',
  description:
    'Read a file from the knowledge base. Path is relative to the KB root. PDF files are returned as extracted text with [page N] markers. A long file comes back truncated, with the offset to continue from.',
  schema: z.object({
    path: z.string().describe('KB-relative path, e.g. "wiki/index.md"'),
    offset: z
      .number()
      .optional()
      .describe('Character offset to start at — how you continue a truncated read'),
  }),
  describeCall: (a) => `read ${a.path}${a.offset ? ` @${a.offset}` : ''}`,
  run: async ({ path, offset }) => {
    let content: string
    if (isAnnotationsPath(path)) {
      // Highlight sidecars are rect/CFI-heavy JSON — serve the rendered digest,
      // which is what annotation Q&A actually needs. Unparseable → raw JSON.
      const raw = await fs.tryReadFile(path)
      if (raw === null) return `Error: file not found: ${path}`
      const digest = renderAnnotationsDigest(path, raw)
      if (digest) return clip(digest, offset)
      content = raw
    } else if (/\.(pdf|epub|docx?)$/i.test(path)) {
      // Binary documents go through the structured index (block ids, citeable).
      const { hasIndex, indexDirFor, indexableKind } = await import('@/lib/docindex')
      const kind = indexableKind(path)!
      if (await hasIndex(path)) {
        const dir = indexDirFor(kind, path)
        return `This document has a structured index at ${dir}/ — read ${dir}/_README.md and ${dir}/toc.md, then the relevant sections/*.md files (they carry citeable [[block-id]] tags). Use list_files/search_files with dir="${dir}".`
      }
      return `Error: ${path} is a ${kind.toUpperCase()} without an AI index yet. Call index_document with this path first, then read the generated index.`
    } else {
      const read = await fs.readTextFile(path)
      if (!read.ok) {
        if (read.reason === 'missing') return `Error: file not found: ${path}`
        return read.reason === 'binary'
          ? `Error: ${path} holds binary data, not text — there is nothing to read.`
          : `Error: ${path} is too large to read as text.`
      }
      content = read.text
    }
    return clip(content, offset)
  },
})

const writeFile = defineTool({
  name: 'write_file',
  description:
    'Create a NEW text file, or fully rewrite an existing one. For partial modifications prefer edit_file — it is cheaper and reviewable. Always read_file first when overwriting, and write the complete new content. Parent directories are created automatically.',
  schema: z.object({
    path: z.string().describe('KB-relative path, e.g. "wiki/concepts/foo.md"'),
    content: z.string().describe('Full file content'),
  }),
  describeCall: (a) => `write ${a.path}`,
  run: async ({ path, content }, ctx) => {
    const before = await fs.tryReadFile(path)
    const decision = await approved(ctx, path, before, content)
    if (decision !== 'approved') return notApproved(decision, `the write to ${path}`)
    await performWrite(path, before, content)
    return `Wrote ${path} (${content.length} chars)`
  },
})

const editFile = defineTool({
  name: 'edit_file',
  description:
    'Replace an exact string in an existing file — the preferred way to modify files. old_string must match the file content exactly (including whitespace) and be unique unless replace_all is set. Read the file first.',
  schema: z.object({
    path: z.string().describe('KB-relative path'),
    old_string: z.string().describe('Exact text to replace (must be unique in the file)'),
    new_string: z.string().describe('Replacement text'),
    replace_all: z.boolean().optional().describe('Replace every occurrence (default false)'),
  }),
  describeCall: (a) => `edit ${a.path}`,
  run: async ({ path, old_string, new_string, replace_all }, ctx) => {
    const before = await fs.tryReadFile(path)
    if (before === null) return `Error: file not found: ${path}`
    const result = applyEdit(before, old_string, new_string, replace_all ?? false)
    if (!result.ok) return `Error: ${result.error}`
    const decision = await approved(ctx, path, before, result.content)
    if (decision !== 'approved') return notApproved(decision, `the edit to ${path}`)
    await performWrite(path, before, result.content)
    return `Edited ${path} (${result.count} replacement${result.count > 1 ? 's' : ''})`
  },
})

/* ── deleting and moving ─────────────────────────────────────────────────── */

/** Normalize a path argument: tolerate "./x" and trailing slashes from the model. */
function cleanPath(p: string): string {
  return p.trim().replace(/^\.\//, '').replace(/\/+$/, '')
}

/** Git's own storage is not KB content — losing it loses the history. */
const PROTECTED_RE = /^\.git(\/|$)/

/** Reject the paths no tool may touch: the KB root itself and .git. */
function guardPath(path: string, what: string): string | null {
  if (!path || path === '.') return `Error: refusing to ${what} the KB root.`
  if (PROTECTED_RE.test(path)) return `Error: .git holds the repository history and is off limits.`
  return null
}

/** Files we can read and write back as a string — the ones content search can
 *  scan and the review panel can restore after a delete. Named kinds only: the
 *  bytes get the last word wherever one is actually read. */
const isTextFile = isTextName

/** The `before` snapshot the review panel restores from — null when the file
 *  has no text to snapshot, which is what makes a deletion final. */
async function textSnapshot(path: string): Promise<string | null> {
  if (!isTextFile(path)) return null
  const read = await fs.readTextFile(path)
  return read.ok ? read.text : null
}

/** Listing of everything a recursive delete would remove, for the approval diff. */
const MAX_LISTED = 200
async function dirListing(dir: string): Promise<{ text: string; count: number }> {
  const paths = fs.collectFiles(await fs.readTreeFrom(dir))
  const shown = paths.slice(0, MAX_LISTED)
  const more = paths.length - shown.length
  return {
    text: shown.join('\n') + (more > 0 ? `\n… and ${more} more` : ''),
    count: paths.length,
  }
}

const deletePath = defineTool({
  name: 'delete_path',
  description:
    'Delete a file, or a whole directory with everything inside it (needs recursive: true). Only delete what the user asked you to remove — never tidy up on your own initiative. A deleted text file can be restored from the Agent-changes panel; directories and binaries (PDF/EPUB/images) cannot, so those always ask the user first.',
  schema: z.object({
    path: z.string().describe('KB-relative path to delete, e.g. "inbox/draft.md"'),
    recursive: z
      .boolean()
      .optional()
      .describe('Required for a directory: delete it and everything inside'),
  }),
  describeCall: (a) => `delete ${a.path}`,
  run: async ({ path, recursive }, ctx) => {
    const target = cleanPath(path)
    const guard = guardPath(target, 'delete')
    if (guard) return guard
    const kind = await fs.statKind(target)
    if (!kind) return `Error: no such file or directory: ${target}`
    const isDir = kind === 'dir'
    if (isDir && !recursive) {
      return `Error: ${target} is a directory. Pass recursive: true to delete it and everything inside — after checking with the user that this is what they want.`
    }
    const listing = isDir ? await dirListing(target) : null
    const before = isDir ? listing!.text : await textSnapshot(target)
    const restorable = !isDir && before !== null
    // Ask when the user reviews every write — and always when the deletion is
    // final, since there is no snapshot to undo it with.
    if (useSettingsStore().state.writeMode === 'ask' || !restorable) {
      const decision = await askUser(ctx, target, before, '', {
        deleted: true,
        dir: isDir,
        restorable,
      })
      if (decision !== 'approved') return notApproved(decision, `deleting ${target}`)
    }
    await useFilesStore().deleteEntry(target, isDir)
    useReviewStore().recordDelete(target, before, isDir)
    refreshGitStatus()
    if (isDir) return `Deleted directory ${target} and its ${listing!.count} file(s). This cannot be undone.`
    return restorable
      ? `Deleted ${target}. The user can still restore it from the Agent-changes panel.`
      : `Deleted ${target}. This cannot be undone.`
  },
})

const movePath = defineTool({
  name: 'move_path',
  description:
    'Move or rename a file or directory inside the KB. Missing destination folders are created; an existing destination is never overwritten. [[wikilinks]] resolve by file name, so MOVING a page keeps its links working while RENAMING one breaks them — search for the old name afterwards and update the links.',
  schema: z.object({
    from: z.string().describe('Current KB-relative path'),
    to: z.string().describe('New KB-relative path, including the new file name'),
  }),
  describeCall: (a) => `move ${a.from} → ${a.to}`,
  run: async ({ from, to }) => {
    const src = cleanPath(from)
    const dest = cleanPath(to)
    const guard = guardPath(src, 'move') ?? guardPath(dest, 'move onto')
    if (guard) return guard
    if (src === dest) return `Error: source and destination are the same (${src}).`
    const kind = await fs.statKind(src)
    if (!kind) return `Error: no such file or directory: ${src}`
    if (kind === 'dir' && dest.startsWith(`${src}/`)) {
      return `Error: cannot move ${src} into itself.`
    }
    if (await fs.statKind(dest)) {
      return `Error: ${dest} already exists — pick another destination, or delete it first.`
    }
    await useFilesStore().renameEntry(src, dest, kind === 'dir')
    refreshGitStatus()
    return `Moved ${kind === 'dir' ? 'directory ' : ''}${src} → ${dest}`
  },
})

const createDirectory = defineTool({
  name: 'create_directory',
  description:
    'Create an empty directory. write_file already creates the folders in its path, so use this only when the folder itself is the deliverable — scaffolding a layout the user asked for.',
  schema: z.object({
    path: z.string().describe('KB-relative directory path, e.g. "wiki/concepts"'),
  }),
  describeCall: (a) => `mkdir ${a.path}`,
  run: async ({ path }) => {
    const target = cleanPath(path)
    const guard = guardPath(target, 'create')
    if (guard) return guard
    const kind = await fs.statKind(target)
    if (kind === 'dir') return `${target}/ already exists.`
    if (kind === 'file') return `Error: ${target} already exists as a file.`
    await fs.mkdir(target)
    await syncAfterFsChange()
    return `Created directory ${target}/ (empty — git only records it once it holds a file).`
  },
})

const openFile = defineTool({
  name: 'open_file',
  description:
    "Open a file in the user's editor pane so they can SEE it — after writing a page, or when they ask you to open/show something. It displays the file to the user and returns nothing to you; use read_file when you need the content yourself.",
  schema: z.object({
    path: z.string().describe('KB-relative path to show the user'),
  }),
  describeCall: (a) => `open ${a.path}`,
  run: async ({ path }) => {
    const target = cleanPath(path)
    const kind = await fs.statKind(target)
    if (kind !== 'file') {
      return kind === 'dir'
        ? `Error: ${target} is a directory — open one of the files inside it.`
        : `Error: file not found: ${target}`
    }
    await useFilesStore().openFile(target)
    return `Opened ${target} in the user's editor — it is on their screen now, so don't paste the content back.`
  },
})

/** Pick `artifacts/<slug>.html`, appending -2, -3… on collision. */
async function uniqueArtifactPath(title: string): Promise<string> {
  const slug = slugify(title) || 'artifact'
  for (let n = 1; n < 1000; n++) {
    const path = `artifacts/${slug}${n > 1 ? `-${n}` : ''}.html`
    if (!(await fs.exists(path))) return path
  }
  return `artifacts/${slug}-${Date.now()}.html`
}

const createArtifact = defineTool({
  name: 'create_artifact',
  description:
    'Create a self-contained interactive HTML artifact (a study guide, learning path, roadmap, interactive explainer, diagram, etc.) saved under artifacts/. The user opens it in a sandboxed viewer. Requirements: return a COMPLETE standalone HTML document (start with <!doctype html>), inline ALL CSS and JS, no external network/CDN dependencies (it must work fully offline and runs sandboxed with no access to the app). Use it when the user wants a rich, interactive, or visually structured deliverable that plain markdown cannot express; otherwise prefer write_file.',
  schema: z.object({
    title: z.string().describe('Short human title, e.g. "Machine Learning Study Path"'),
    html: z.string().describe('The complete standalone HTML document'),
  }),
  describeCall: (a) => `artifact: ${a.title}`,
  run: async ({ title, html }, ctx) => {
    const path = await uniqueArtifactPath(title)
    const decision = await approved(ctx, path, null, html)
    if (decision !== 'approved') return notApproved(decision, `the artifact ${path}`)
    await performWrite(path, null, html)
    ctx.emit?.({ type: 'artifact', title, path })
    return `Created artifact "${title}" at ${path} (${html.length} chars). It opens in a sandboxed viewer; a clickable card was shown to the user — do not paste the HTML back.`
  },
})

const PLAN_STATUSES = ['pending', 'in_progress', 'done'] as const

const updatePlan = defineTool({
  name: 'update_plan',
  description:
    'Maintain a visible task checklist for multi-step work. Pass the FULL list every call (it replaces the previous one). Use it when a task has 3+ steps: create it up front, mark items in_progress/done as you go. Exactly one item should be in_progress at a time.',
  schema: z.object({
    items: z
      .array(
        z.object({
          text: z.string().describe('Short imperative step description'),
          status: z.enum(PLAN_STATUSES),
        }),
      )
      .describe('The complete, updated plan'),
  }),
  describeCall: (a) => {
    const done = a.items.filter((i) => i.status === 'done').length
    return `plan ${done}/${a.items.length}`
  },
  run: async ({ items }, ctx) => {
    usePlanStore().set(ctx.sessionId, items as PlanItem[])
    // Name the open items instead of a generic "continue": this result lives in
    // the wire history, so it is what a LATER turn sees when it finishes the
    // remaining work — the measured failure mode is exactly that turn ending
    // without the final all-done update. Just-in-time, costs no prompt bytes.
    const open = (items as PlanItem[]).filter((i) => i.status !== 'done')
    if (!open.length) return `Plan complete — all ${items.length} items done.`
    const listed = open
      .map((i) => `"${i.text}"${i.status === 'in_progress' ? ' (in progress)' : ''}`)
      .join(', ')
    return `Plan updated (${items.length - open.length}/${items.length} done). Still open: ${listed}. Before ending the task, call update_plan once more with every finished item marked done — an unchecked item reads as unfinished work.`
  },
})

/** Compile a query: `/re/flags` is a regular expression, anything else a
 *  case-insensitive substring. Returns the error message on a bad regex. */
function matcher(query: string): ((s: string) => boolean) | string {
  const slashed = /^\/(.+)\/([gimsuy]*)$/.exec(query)
  if (!slashed) {
    const needle = query.toLowerCase()
    return (s) => s.toLowerCase().includes(needle)
  }
  try {
    // `g`/`y` would carry lastIndex between calls and skip matches — drop them.
    const re = new RegExp(slashed[1], slashed[2].replace(/[gy]/g, ''))
    return (s) => re.test(s)
  } catch (err) {
    return `Error: invalid regular expression ${query} — ${(err as Error).message}`
  }
}

const searchFiles = defineTool({
  name: 'search_files',
  description:
    'Search the knowledge base and return "path:line: text" matches. The query is a case-insensitive substring, or a regular expression when wrapped in slashes ("/^#+ .*API/"). Pass names: true to match file PATHS instead of contents (how you find a file by name in a big KB), and dir to restrict the scan — including index directories under .trace/.',
  schema: z.object({
    query: z.string().describe('Substring, or /regex/ to match with a regular expression'),
    dir: z.string().optional().describe('Directory to search in, e.g. ".trace/pdf-index/foo-123"'),
    names: z.boolean().optional().describe('Match file paths instead of file contents'),
  }),
  describeCall: (a) =>
    `${a.names ? 'find' : 'search'} "${a.query}"${a.dir ? ` in ${a.dir}` : ''}`,
  run: async ({ query, dir, names }, ctx) => {
    const match = matcher(query)
    if (typeof match === 'string') return match
    const tree = dir ? await fs.readTreeFrom(dir) : await fs.readTree()
    const all = fs.collectFiles(tree)

    if (names) {
      // Every file, not just the readable ones — finding "that PDF" is the point.
      const hits = all.filter(match)
      if (!hits.length) return `No file paths match "${query}"`
      return (
        hits.slice(0, MAX_SEARCH_RESULTS).join('\n') +
        (hits.length > MAX_SEARCH_RESULTS ? `\n[${hits.length} matches, capped at ${MAX_SEARCH_RESULTS}]` : '')
      )
    }

    const out: string[] = []
    for (const p of all.filter(isTextFile)) {
      if (out.length >= MAX_SEARCH_RESULTS) break
      // Reading every text file in a large KB is the one built-in that can run
      // for a while; give up as soon as the user stops the turn.
      if (ctx.signal?.aborted) return 'Search stopped.'
      // A name can only guess at text; a file whose bytes say otherwise is
      // skipped rather than grepped for accidental matches in its binary noise.
      const read = await fs.readTextFile(p)
      if (!read.ok) continue
      const lines = read.text.split('\n')
      for (let i = 0; i < lines.length && out.length < MAX_SEARCH_RESULTS; i++) {
        if (match(lines[i])) out.push(`${p}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
      }
    }
    if (!out.length) return `No matches for "${query}"`
    const capped = out.length >= MAX_SEARCH_RESULTS ? `\n[capped at ${MAX_SEARCH_RESULTS} results]` : ''
    return out.join('\n') + capped
  },
})

const kbHealth = defineTool({
  name: 'kb_health',
  description:
    'Deterministic structural lint of the WHOLE knowledge base — broken wikilinks, orphan and weakly-linked pages, pages unreachable from the index, pages missing frontmatter, thin / self-linking / placeholder pages, sources no page mentions (unread material), dangling [[pdfN:path]] source declarations, pages last written before a source they cite was revised, log entries whose pages have moved on since, and near-duplicate tags. Computed from the content index with NO page reads, so it is cheap and complete: for structural/health checks call this ONCE instead of listing and reading pages. It does NOT check semantics (contradictions, stale claims) — those need reading content and are token-heavy, so report these findings first and confirm scope with the user before scanning content. Everything it returns is a suggestion, not a defect: report it and let the user decide — never mass-rewrite tags, delete unread sources, or "fix" the KB off the back of this.',
  schema: z.object({}),
  describeCall: () => 'kb health',
  run: async () => {
    const kb = useKbIndexStore()
    await kb.refresh()
    return formatLintReport(kb.lintReport())
  },
})

const indexDocument = defineTool({
  name: 'index_document',
  description:
    'Generate (or refresh) the structured AI index for a PDF, EPUB, Word (.docx), or markdown source under .trace/. Returns the index directory. Read its _README.md and toc.md next, then the relevant sections/*.md — every block carries a citeable [[block-id]] tag. Skips work when a usable index already exists — including one built by an older algorithm revision, which keeps working and is never rebuilt without being asked. Pass rebuild: true ONLY when the user has explicitly chosen to re-index.',
  schema: z.object({
    path: z.string().describe('KB-relative source path, e.g. "raw/papers/x.pdf"'),
    rebuild: z
      .boolean()
      .optional()
      .describe('Rebuild with the current algorithm even though a usable index exists — requires the user having asked for it'),
  }),
  describeCall: (a) => `${a.rebuild ? 'reindex' : 'index'} ${a.path}`,
  run: async ({ path, rebuild }) => {
    const { indexDocument: run } = await import('@/lib/docindex')
    const s = await run(path, undefined, { rebuild })
    return (
      `${s.cached ? 'Index already fresh' : 'Index generated'} at ${s.indexDir}/ — ` +
      `"${s.title}", ${s.sectionCount} sections, ${s.blockCount} blocks. ` +
      `Read ${s.indexDir}/_README.md first, then ${s.indexDir}/toc.md.`
    )
  },
})

const saveTranscript = defineTool({
  name: 'save_transcript',
  description:
    'Save THIS conversation as a markdown file in the knowledge base. Use when the user asks to save, record, or archive the chat. It is a plain snapshot — a normal KB file. Defaults to the KB\'s conversations landing dir (raw/conversations/browser-md/ in raw-layout KBs, inbox/conversations/ otherwise); pass `path` to save elsewhere. Returns the saved path.',
  schema: z.object({
    path: z
      .string()
      .optional()
      .describe('KB-relative destination, e.g. "notes/chat.md". Defaults to the KB\'s conversations landing dir.'),
  }),
  describeCall: (a) => `save session${a.path ? ` → ${a.path}` : ''}`,
  run: async ({ path }, ctx) => {
    const { useChatStore } = await import('@/stores/chat')
    const { transcriptDirFor } = await import('@/lib/transcript')
    const { usesRawLayout } = await import('@/lib/capture')
    const r = useChatStore().renderSession(ctx.sessionId)
    if (!r) return 'Nothing to save — the conversation is empty.'
    const target = path ?? `${transcriptDirFor(await usesRawLayout())}/${r.name}`
    await fs.writeFile(target, r.content)
    await syncAfterFsChange()
    return `Session saved to ${target}`
  },
})

const enableTools = defineTool({
  name: 'enable_tools',
  description:
    'Activate deferred external tools before calling them. The system prompt lists deferred tools (name + summary) — their full schemas are loaded only on demand to save context. Pass the EXACT qualified names (e.g. ["mcp__localmd-connect__generic__open_url"]); they become callable immediately.',
  schema: z.object({
    names: z.array(z.string()).min(1).describe('Qualified tool names from the deferred catalog'),
  }),
  describeCall: (a) => `enable ${a.names.length} tool(s)`,
  run: async ({ names }, ctx) => {
    // Two registries answer to one catalog: MCP servers and installed HTTP
    // tools defer by the same policy, so activation must span both — the
    // model has one list and should not need to know which registry a name
    // came from.
    const accepted = [
      ...useMcpStore().activate(ctx.sessionId, names),
      ...useToolsStore().activate(ctx.sessionId, names),
    ]
    const unknown = names.filter((n) => !accepted.includes(n))
    if (!accepted.length) {
      return `Error: no matching tools. Unknown: ${unknown.join(', ')}. Use exact names from the deferred-tools catalog in the system prompt.`
    }
    return (
      `Enabled and now callable: ${accepted.join(', ')}.` +
      (unknown.length ? ` Unknown (skipped): ${unknown.join(', ')}.` : '')
    )
  },
})

const useSkill = defineTool({
  name: 'use_skill',
  description:
    'Load the full instructions of a skill listed in the system prompt. Call this BEFORE following a skill — the listing only has the summary. Then execute the loaded instructions.',
  schema: z.object({
    name: z.string().describe('Skill name from the system-prompt listing'),
  }),
  describeCall: (a) => `skill: ${a.name}`,
  run: async ({ name }) => {
    const skill = await loadSkill(name)
    if (!skill) {
      // Only what the model was offered — listing a `invocation: user` skill
      // here would re-introduce, at failure time, the bytes the filter saves.
      const available = (await listSkills()).filter((s) => s.modelInvocable).map((s) => s.name)
      return `Error: no skill named "${name}". Available: ${available.join(', ') || '(none)'}`
    }
    const resources = skill.resources.length
      ? `\n\nBundled resources (read with read_file when the instructions reference them):\n${skill.resources.map((r) => `- ${r}`).join('\n')}`
      : ''
    return `# Skill: ${skill.name}\n\n${skill.body}${resources}`
  },
})

/**
 * The app's own manual, on demand.
 *
 * Neither the topic list nor any body is in the system prompt: the index is one
 * call away and a body is two, so the always-on cost is this description alone
 * however far the manual grows. That is the point — it is meant to cover the
 * whole app eventually, and a listing that grew with it would be paid for on
 * every step of every turn by the turns that never ask.
 *
 * Reference, not workflow — which is why it is not a skill. Skills are listed
 * in the prompt because the agent must recognise when to run one; nobody
 * "runs" a fact about where keys are stored.
 */
const appHelp = defineTool({
  name: 'app_help',
  description:
    "Look up how localmd itself works — tools, MCP servers, API keys, the knowledge-base layout, skills, document indexing and citations, git sync, models, memory, and where each thing is stored. Call with no topic to list what is covered, then again with one. Use this whenever the user asks about the app rather than about their content ('where are my keys stored?', 'what's the difference between a tool and an MCP server?', 'what happens if I switch KB?') — answer from the doc, not from memory.",
  schema: z.object({
    topic: z
      .string()
      .optional()
      .describe('Topic id from the index. Omit to get the index.'),
  }),
  describeCall: (a) => (a.topic ? `help: ${a.topic}` : 'help: contents'),
  run: async ({ topic }) => {
    const doc = topic ? appDocForAgent(topic) : undefined
    if (doc) return `# ${doc.title}\n\n${doc.body}`

    // A guessed id ("api-keys" for "keys") is the common way to arrive here, so
    // a miss returns the same full index as calling with no topic — enough to
    // pick correctly on the next call rather than guess a second time.
    const contents = listAppDocsForAgent()
      .map((d) => `- ${d.id}: ${d.title} — ${d.summary}`)
      .join('\n')
    const miss = topic ? `No topic "${topic}". ` : ''
    return `${miss}Topics — call app_help again with one of these ids:\n${contents}`
  },
})

/**
 * Change the app's own configuration, so "turn on ask-first mode" or "install
 * the research tools" is something the user can say rather than something they
 * have to go and find.
 *
 * The readable/writable surface is an allowlist in lib/appSettings — see the
 * reasoning there. Nothing that could carry a credential is in it, so there is
 * no path from this tool to an API key, a token, or a secret's value.
 *
 * `get` also carries the field reference, which is why the description does not:
 * the vocabulary is needed by the rare turn that configures something, and
 * always-on bytes are paid by every step of every turn.
 */
const appSettings = defineTool({
  name: 'app_settings',
  description:
    "Read or change this app's own settings, and install/remove recommended tool sets. Use when the user asks to configure localmd itself — \"make writes ask first\", \"install the research tools\", \"turn on multi-tab\", \"set my commit name\". Call action:'get' first: it returns the current setup plus every field you may change and what each accepts. Cannot read or write API keys, tokens or secrets — use request_setup for those.",
  schema: z.object({
    action: z
      .enum(['get', 'set', 'install', 'uninstall'])
      .describe(
        "'get' (current setup + the fields you may change), 'set' (change one field), 'install'/'uninstall' (a recommended tool set, by catalog id)",
      ),
    key: z.string().optional().describe("set: the field name, e.g. \"write_mode\""),
    value: z.string().optional().describe('set: the new value, as a string'),
    id: z.string().optional().describe("install/uninstall: a catalog entry id, e.g. \"research\""),
  }),
  describeCall: (a) =>
    a.action === 'set' ? `settings: ${a.key} = ${a.value}` : `settings: ${a.action}${a.id ? ` ${a.id}` : ''}`,
  run: async ({ action, key, value, id }) => {
    const settings = useSettingsStore()
    const toolsStore = useToolsStore()

    if (action === 'get') {
      const s = settings.state
      const slot = (name: 'primary' | 'vision' | 'image'): string => {
        const p = s.profiles.find((x) => x.id === s.slots[name])
        return p ? `${p.label} (${p.provider} · ${p.model})` : 'not set'
      }
      const installed = CATALOG.filter((e) => toolsStore.isInstalled(e.id)).map((e) => e.id)
      const available = CATALOG.filter((e) => !toolsStore.isInstalled(e.id)).map((e) => e.id)
      return [
        'Current setup:',
        `- interface language: ${getLocale()}`,
        `- models: primary = ${slot('primary')}; vision = ${slot('vision')}; image = ${slot('image')}`,
        ...WRITABLE.map((f) => `- ${f.key}: ${f.read(s)}`),
        `- recommended tool sets installed: ${installed.join(', ') || '(none)'}`,
        `- available to install: ${available.join(', ') || '(none)'}`,
        '',
        "Fields you can change with action:'set':",
        describeWritable(),
        '',
        'Not readable or writable here: API keys, the GitHub token, and tool secrets. To get a value from the user, call request_setup. To change models, point them at Settings → Models.',
      ].join('\n')
    }

    if (action === 'install' || action === 'uninstall') {
      if (!id) return `Error: ${action} needs an "id". Call action:'get' for the available ids.`
      const entry = catalogEntryById(id)
      if (!entry) {
        return `Error: no recommended tool set called "${id}". Available: ${CATALOG.map((e) => e.id).join(', ')}`
      }
      const already = toolsStore.isInstalled(id)
      if (action === 'install' && already) return `"${id}" is already installed.`
      if (action === 'uninstall' && !already) return `"${id}" is not installed.`
      if (action === 'install') {
        toolsStore.install(id)
        // A server-backed entry has to connect before it has any tools, and the
        // missing-key case is the usual reason a fresh install does nothing.
        const needs = (entry.secrets ?? []).filter((sec) => !toolsStore.hasSecret(sec.id))
        const note = needs.length
          ? ` It needs ${needs.map((sec) => sec.id).join(', ')} before it will work — collect with request_setup.`
          : entry.server
            ? ' It connects in the background; check back before relying on it.'
            : ''
        return `Installed "${id}".${note}`
      }
      toolsStore.uninstall(id)
      return `Removed "${id}".`
    }

    if (!key) return "Error: set needs a \"key\". Call action:'get' for the field list."
    const field = WRITABLE_BY_KEY.get(key)
    if (!field) {
      return `Error: "${key}" is not a settable field. Settable: ${WRITABLE.map((f) => f.key).join(', ')}`
    }
    if (value === undefined) return `Error: set needs a "value" for ${key}.`
    const err = field.write(settings.state, value)
    if (err) return `Error: ${err}`
    return `Set ${key} to ${field.read(settings.state)}.`
  },
})

/* ── guided setup ────────────────────────────────────────────────────────── */

/**
 * Ask the APP to collect something from the user mid-turn. The two things the
 * agent genuinely cannot do for itself — a secret it must never see, and an
 * extension only the user can install — used to end a guided setup with a
 * navigation instruction. Now the agent describes the need and the app renders
 * the control.
 */
const requestSetup = defineTool({
  name: 'request_setup',
  description:
    "Ask the user for something the setup needs, as a card in the chat rather than instructions to go and find a settings page. Use for: an API key a tool references ({{secret:<id>}}) — the user types it straight into the app and you never see the value; a browser extension a tool requires; adding an MCP server (kind:'confirm' + server_url — you propose, they see the address and click); signing in to a server that answered 401 (kind:'signin'); or a choice only they can make. Blocks until they answer. Never ask for a key or token as chat text, and never claim to have added or connected something a card has not come back confirmed — always use this.",
  schema: z.object({
    kind: z
      .enum(['key', 'extension', 'choice', 'confirm', 'signin'])
      .describe(
        "'key' = an API key/token, 'extension' = a browser extension, 'choice' = pick one option, 'confirm' = propose a change that only happens if they click (use with server_url to add an MCP server), 'signin' = let them authorize a server that answered 401 (use with server_id)",
      ),
    label: z.string().describe('Title of the card — what you are asking for, in the user\'s terms'),
    help: z.string().optional().describe('One line on how to obtain it (where to click, which page)'),
    url: z.string().optional().describe('Where to get the key / install the extension'),
    secret_id: z
      .string()
      .optional()
      .describe("kind 'key': the id the tools reference, e.g. \"weread_api_key\" for {{secret:weread_api_key}}"),
    entry_id: z
      .string()
      .optional()
      .describe(
        "kind 'extension': the recommended-tools entry to install — \"localmd-connect\"",
      ),
    options: z.array(z.string()).optional().describe("kind 'choice': the options to offer"),
    server_url: z
      .string()
      .optional()
      .describe(
        "kind 'confirm': the https MCP endpoint to add. Shown to the user in full before anything connects.",
      ),
    server_name: z
      .string()
      .optional()
      .describe("kind 'confirm' with server_url: short name for the row, e.g. \"notion\""),
    server_id: z.string().optional().describe("kind 'signin': the server row id, from list_tools"),
  }),
  describeCall: (a) => `ask user: ${a.label}`,
  run: async (args, ctx) => {
    if (args.kind === 'key' && !args.secret_id) return 'Error: kind "key" needs secret_id.'
    if (args.kind === 'choice' && !args.options?.length) return 'Error: kind "choice" needs options.'
    if (args.kind === 'signin' && !args.server_id) return 'Error: kind "signin" needs server_id.'

    // A proposal, not a write. The agent reads untrusted things, so a page can
    // talk it into suggesting an address — the user seeing that address and
    // clicking is what makes it real.
    let apply: (() => void) | undefined
    let detail: string | undefined
    if (args.kind === 'confirm' && args.server_url) {
      const url = args.server_url.trim()
      let host: string
      try {
        const u = new URL(url)
        if (u.protocol !== 'https:') return 'Error: an MCP endpoint must be https.'
        host = u.host
      } catch {
        return `Error: "${url}" is not a URL.`
      }
      const name = (args.server_name || host.split('.')[0] || 'server').trim()
      detail = `${name} → ${url}`
      apply = () => {
        const settings = useSettingsStore()
        if (settings.state.mcpServers.some((s) => s.url === url)) return
        settings.state.mcpServers = [
          ...settings.state.mcpServers,
          { id: crypto.randomUUID(), name, url },
        ]
      }
    }

    const outcome = await useSetupStore().ask({
      id: crypto.randomUUID(),
      sessionId: ctx.sessionId,
      kind: args.kind,
      label: args.label,
      ...(args.help ? { help: args.help } : {}),
      ...(args.url ? { url: args.url } : {}),
      ...(args.secret_id ? { secretId: args.secret_id } : {}),
      ...(args.entry_id ? { entryId: args.entry_id } : {}),
      ...(args.options ? { options: args.options } : {}),
      ...(detail ? { detail } : {}),
      ...(apply ? { apply } : {}),
      ...(args.server_id ? { serverId: args.server_id } : {}),
    })

    if (outcome === 'provided') {
      return `The user saved a value for "${args.secret_id}". You cannot read it — just carry on and let the tool use it.`
    }
    if (outcome === 'confirmed') {
      return args.server_url
        ? `Added. It connects in the background — check list_tools before relying on it, and if it reports 401 ask for a sign-in with kind:"signin".`
        : 'The user confirmed. Continue.'
    }
    if (outcome === 'connected') {
      return args.kind === 'signin'
        ? 'Signed in, and the server reconnected. Check list_tools for what it offers now.'
        : 'The extension is connected. Continue.'
    }
    if (outcome.startsWith('failed:')) {
      return `That did not work: ${outcome.slice('failed:'.length)}. Tell the user plainly and stop — do not retry the same thing.`
    }
    if (outcome.startsWith('chose:')) return `The user chose: ${outcome.slice('chose:'.length)}`
    return 'The user skipped this. Do not ask again in a loop — say what stays unavailable without it, and continue with whatever still works.'
  },
})

/* ── tool authoring ──────────────────────────────────────────────────────── */

/**
 * The format reference, delivered by `list` rather than carried in the tool
 * description — always-on prompt bytes are paid on every step of every turn,
 * and this is only needed by the rare turn that actually authors a tool.
 */
const TOOL_SPEC_HELP = `Spec format (JSON):
{
  "name": "openalex_search",              // [a-z][a-z0-9_]*, must not collide
  "description": "What it does and when to use it — the agent reads only this.",
  "params": { "query": {"type":"string","required":true,"description":"…"},
              "limit": {"type":"number","default":5} },
  "request": {
    "method": "GET",                      // GET|POST|PUT|PATCH|DELETE
    "url": "https://api.example.com/s?q={{query}}&n={{limit}}",
    "headers": {"Authorization":"Bearer {{secret:my_key}}"},
    "body": "{\\"q\\":\\"{{query}}\\"}"    // non-GET only
  },
  "response": {
    "mode": "json",                       // "text" = body as-is; "json" = pick+template
    "pick": "results[]",                  // path: a.b[] maps, a.b.0 indexes
    "template": "- {{title}} ({{year}}) {{url}}"
  },
  "maxChars": 20000,
  "transport": "auto",                    // auto | direct | extension
  "bundle": "weread"                      // group an integration's tools; set
                                          // it via save_bundle, not by hand
}

Rules that will reject a spec:
- https only, and the HOST may not contain a placeholder (a tool always talks to
  the server it was approved for).
- {{secret:id}} reads a key the USER stored in Settings; you can reference one
  but never read, set, or see its value. NEVER ask the user to paste a key or
  token into the chat: put {{secret:<id>}} in the spec, then call request_setup
  with kind:"key" and that same id — the app shows them a field, stores what
  they type, and tells you only that a value arrived.
- {{now:unix}} {{now:ms}} {{now:iso}} {{uuid:v4}} are filled in by the app at
  request time. Reach for one when a header must be FRESH per call — plenty of
  Bearer APIs also validate a timestamp header, and an idempotency key must be
  new each time. Never declare a parameter for the current time and pass it
  yourself (you have no reliable clock, and a stale value comes back as an
  authorization error that looks like a bad key), and never store one as a
  secret (it would be stale on the second call).
- A placeholder in the REQUEST that is not a param, not a {{secret:id}} and not
  one of those runtime values is rejected, not silently blanked. In a response
  "template" the opposite still holds: an unfilled one means a wrong field name.
Guidance:
- ALWAYS shape the response. A raw JSON payload can cost thousands of tokens per
  call; pick + template is the difference between 200 tokens and 20,000.
- Test with raw:true FIRST to see the untouched response and learn the real
  field names, then write pick + template and test again. An unfilled
  {{placeholder}} means the field name is wrong.
- If a direct call fails on CORS, set transport "extension" — the localmd
  Connect route (needs the extension connected).
- Adding a SERVICE means several tools. Build them all, then save_bundle once:
  the user approves one integration instead of clicking through five diffs.`

function describeSpec(spec: HttpToolSpec, scope: string): string {
  // (bundle shown by the caller, which groups them)
  const params = Object.entries(spec.params)
    .map(([k, p]) => `${k}${p.required ? '*' : ''}:${p.type}`)
    .join(', ')
  return `- ${spec.name}(${params}) [${scope}] → ${spec.request.method} ${staticOrigin(spec.request.url)}`
}

/** Read the KB's tool file as a spec list plus its raw text (for the diff). */
async function readKbToolFile(): Promise<{ raw: string | null; tools: HttpToolSpec[] }> {
  const raw = await fs.tryReadFile(KB_TOOLS_CONFIG_PATH)
  if (!raw) return { raw: null, tools: [] }
  try {
    const parsed = JSON.parse(raw) as { tools?: unknown }
    return { raw, tools: normalizeHttpToolList(parsed.tools, () => crypto.randomUUID()) }
  } catch {
    return { raw, tools: [] }
  }
}

/**
 * Author tools by conversation. Saving is the only gated action, and it is
 * gated on the real file diff — the user approves the exact bytes, seeing the
 * name and the destination host, whatever their write mode says.
 *
 * `test` deliberately is NOT gated: an arbitrary outbound request is already
 * within reach of any installed web tool, so a confirmation there would buy
 * nothing and cost the author loop its iteration. What test does NOT do is hand
 * over the user's stored keys — a secret resolves only for an origin that an
 * already-installed tool uses it with, so a freshly-proposed spec can never
 * carry a key somewhere new.
 */
const manageTools = defineTool({
  name: 'manage_tools',
  description:
    "Create, test, update or remove the knowledge base's own HTTP tools (stored in .agents/tools.json, so they travel with the KB). Use when the user asks you to give yourself — or the app — a new capability, e.g. \"add a tool that searches <service>\". Call action:'list' first: it returns what exists plus the exact spec format. Saving asks the user to approve the file change.",
  schema: z.object({
    action: z
      .enum(['list', 'test', 'save', 'save_bundle', 'remove'])
      .describe(
        "'list' (what exists + the spec format), 'test' (run a spec without saving), 'save' (one tool), 'save_bundle' (a whole integration in ONE approval — prefer this when adding a service), 'remove' (a tool, or a whole bundle by name)",
      ),
    tool: z.string().optional().describe('The tool spec as a JSON object string (test/save)'),
    tools: z
      .string()
      .optional()
      .describe('save_bundle: a JSON ARRAY of tool specs, saved together under one approval'),
    bundle: z
      .string()
      .optional()
      .describe('save_bundle: the integration name the tools belong to, e.g. "weread"'),
    name: z.string().optional().describe('Tool name to remove — or a bundle name to remove all of it'),
    sample_args: z
      .string()
      .optional()
      .describe('JSON object of arguments for a test run, e.g. {"query":"cats"}'),
    raw: z
      .boolean()
      .optional()
      .describe(
        'test only: return the untouched response instead of the shaped one — how you find the field names for pick/template',
      ),
  }),
  describeCall: (a) => `manage_tools: ${a.action}${a.name ? ` ${a.name}` : ''}`,
  run: async ({ action, tool, tools: toolsJson, bundle, name, sample_args, raw }, ctx) => {
    const toolsStore = useToolsStore()

    if (action === 'list') {
      const kb = await readKbToolFile()
      const kbNames = new Set(kb.tools.map((t) => t.name))
      // Grouped so an existing integration reads as one thing — that is also
      // how the agent learns which bundle name to reuse when extending it.
      const render = (specs: HttpToolSpec[], scope: string): string[] =>
        groupByBundle(specs).flatMap((g) =>
          g.bundle
            ? [`${g.bundle} (bundle, ${g.tools.length} tools) [${scope}]`, ...g.tools.map((s) => `  ${describeSpec(s, scope).slice(2)}`)]
            : g.tools.map((s) => describeSpec(s, scope)),
        )
      const lines = [
        ...render(kb.tools, 'this KB'),
        ...render(toolsStore.specs.filter((s) => !kbNames.has(s.name)), 'user settings'),
      ]
      return `${lines.length ? `Installed HTTP tools:\n${lines.join('\n')}` : 'No HTTP tools installed.'}\n\nBuilt-in names you may not reuse: ${TOOLS.map((t) => t.name).join(', ')}\n\n${TOOL_SPEC_HELP}`
    }

    if (action === 'remove') {
      if (!name) return 'Error: remove needs a "name".'
      const kb = await readKbToolFile()
      const isBundle = kb.tools.some((t) => t.bundle === name)
      const doomed = kb.tools.filter((t) => (isBundle ? t.bundle === name : t.name === name))
      if (!doomed.length) {
        return `Error: this KB has no tool or bundle named "${name}" (manage_tools only edits .agents/tools.json; tools from Settings are the user's to remove).`
      }
      const next = kb.tools.filter((t) => !doomed.includes(t))
      const what = isBundle ? `remove the ${name} bundle (${doomed.length} tools)` : `remove ${name}`
      return writeKbTools(ctx, kb.raw, next, what)
    }

    if (action === 'save_bundle') {
      if (!toolsJson) return 'Error: save_bundle needs "tools" — a JSON array of specs.'
      if (!bundle?.trim()) return 'Error: save_bundle needs a "bundle" name.'
      let parsedList: unknown
      try {
        parsedList = JSON.parse(toolsJson)
      } catch (err) {
        return `Error: "tools" is not valid JSON — ${(err as Error).message}`
      }
      if (!Array.isArray(parsedList) || !parsedList.length) {
        return 'Error: "tools" must be a non-empty JSON array of specs.'
      }
      const specs = parsedList.map((raw) =>
        normalizeHttpTool({ ...(raw as object), bundle }, () => crypto.randomUUID()),
      )
      const badIndex = specs.findIndex((s) => !s)
      if (badIndex >= 0) {
        return `Error: spec #${badIndex + 1} is invalid — every tool needs a name matching [a-z][a-z0-9_]* and an https request.url whose host contains no placeholder.`
      }
      const valid = specs as HttpToolSpec[]
      const kb = await readKbToolFile()
      // Replacing a bundle means dropping its previous members, so a second
      // pass doesn't leave orphans from an earlier attempt.
      const keep = kb.tools.filter((t) => t.bundle !== bundle && !valid.some((v) => v.name === t.name))
      const clash = valid.find(
        (v) =>
          TOOLS.some((t) => t.name === v.name) ||
          toolsStore.specs.some((s) => s.name === v.name && s.bundle !== bundle),
      )
      if (clash) {
        return `Error: the name "${clash.name}" is already taken by a built-in or another installed tool. Rename it and try again.`
      }
      const missing = [...new Set(valid.flatMap((v) => secretRefs(v)))].filter(
        (id) => !toolsStore.hasSecret(id),
      )
      const note = missing.length
        ? `\nNow call request_setup with kind:"key" for ${missing.map((m) => `"${m}"`).join(', ')} — the tools fail until a value is stored, and that is the only way to collect one. Do NOT ask them to paste it into this chat.`
        : ''
      return (
        (await writeKbTools(
          ctx,
          kb.raw,
          [...keep, ...valid],
          `add the ${bundle} integration (${valid.length} tools)`,
        )) + note
      )
    }

    // test / save both need a parseable, valid spec.
    if (!tool) return `Error: ${action} needs a "tool" spec. Call action:'list' for the format.`
    let parsed: unknown
    try {
      parsed = JSON.parse(tool)
    } catch (err) {
      return `Error: "tool" is not valid JSON — ${(err as Error).message}`
    }
    const spec = normalizeHttpTool(parsed, () => crypto.randomUUID())
    if (!spec) {
      return 'Error: invalid spec. It needs a name matching [a-z][a-z0-9_]*, and request.url must be an https URL whose host contains no placeholder.'
    }

    if (action === 'test') {
      let args: Record<string, unknown> = {}
      if (sample_args) {
        try {
          args = JSON.parse(sample_args) as Record<string, unknown>
        } catch (err) {
          return `Error: "sample_args" is not valid JSON — ${(err as Error).message}`
        }
      }
      const origin = staticOrigin(spec.request.url)
      // A key may not be DIVERTED: an existing one only follows the origin an
      // installed tool already uses it with. But a key the user just handed
      // over through request_setup has no origin yet — refusing it there made
      // a first-time setup untestable, which pushed the agent to save
      // unverified tools instead. So: usable while it is still unattached,
      // pinned to whatever installed tools use it from then on.
      const usedWith = (id: string): string[] =>
        toolsStore.specs
          .filter((s) => secretRefs(s).includes(id))
          .map((s) => staticOrigin(s.request.url) ?? '?')
      const justProvided = useSetupStore().providedSecrets
      const blocked = secretRefs(spec)
        .map((id) => ({ id, origins: usedWith(id) }))
        .filter(({ id, origins }) => {
          if (origins.includes(origin ?? '?')) return false
          return !(justProvided.has(id) && origins.length === 0)
        })
      if (blocked.length) {
        const why = blocked
          .map(({ id, origins }) =>
            origins.length
              ? `{{secret:${id}}} is used by installed tools with ${[...new Set(origins)].join(', ')}, not ${origin}`
              : `{{secret:${id}}} is a stored key that nothing currently uses`,
          )
          .join('; ')
        return `Error: ${why}. A stored key does not follow a spec to a new host. If this key belongs to the service you are setting up, collect it with request_setup (kind:"key", the same id) — a key the user hands over for this setup can be tested straight away. Otherwise check the URL.`
      }
      // raw: shape nothing, so the model can read the real field names. The
      // spec's own pick/template are what it is trying to write, so showing
      // their output first would be circular.
      const probe = raw
        ? { ...spec, response: { mode: 'text' as const }, maxChars: RAW_TEST_CHARS }
        : spec
      const out = await toolsStore.test(probe, args)
      const label = raw
        ? `Raw response (${out.length} chars shown). Find the list you want, then write pick + template:`
        : `Test result (${out.length} chars — this is what a call would return):`
      return `${label}\n\n${out.slice(0, RAW_TEST_CHARS)}${out.length > RAW_TEST_CHARS ? '\n\n[preview truncated]' : ''}`
    }

    // save
    const clash =
      TOOLS.some((t) => t.name === spec.name) ||
      toolsStore.specs.some((s) => s.name === spec.name && s.id !== spec.id)
    const kb = await readKbToolFile()
    const replacing = kb.tools.find((t) => t.name === spec.name)
    if (clash && !replacing) {
      return `Error: the name "${spec.name}" is already taken by a built-in or an installed tool. Pick another.`
    }
    const next = replacing
      ? kb.tools.map((t) => (t.name === spec.name ? { ...spec, id: t.id } : t))
      : [...kb.tools, spec]
    const missing = secretRefs(spec).filter((id) => !toolsStore.hasSecret(id))
    const note = missing.length
      ? `\nNow call request_setup with kind:"key" for ${missing.map((m) => `"${m}"`).join(', ')} — the tool fails until a value is stored, and that is the only way to collect one. Do NOT ask them to paste it into this chat.`
      : ''
    return (await writeKbTools(ctx, kb.raw, next, `${replacing ? 'update' : 'add'} ${spec.name}`)) + note
  },
})

/** Serialize, gate on the write mode like any other write (ask mode pauses on
 *  the diff card; auto writes now and stays reviewable in Agent changes),
 *  write, and re-register. */
async function writeKbTools(
  ctx: ToolCtx,
  before: string | null,
  tools: HttpToolSpec[],
  what: string,
): Promise<string> {
  const after = `${JSON.stringify({ tools }, null, 2)}\n`
  const decision = await approved(ctx, KB_TOOLS_CONFIG_PATH, before, after)
  if (decision !== 'approved') return notApproved(decision, `the tool change (${what})`)
  await performWrite(KB_TOOLS_CONFIG_PATH, before, after)
  const store = useToolsStore()
  await store.reloadKbTools()
  // The trust gate guards tools that arrive unseen with a cloned KB. These
  // were authored in the user's own conversation (and in ask mode approved by
  // diff), so gating them again would only be noise.
  store.trustKbTools()
  return `Done: ${what}. ${KB_TOOLS_CONFIG_PATH} now defines ${tools.length} tool(s); they are callable from your next message.`
}

/* ── git tools ───────────────────────────────────────────────────────────── */

/** Run a git-mutating tool body under the app-wide git lock. On contention
 *  past the timeout (e.g. another session's push), give the model a clear
 *  busy message to relay instead of stalling the turn. */
async function lockedGit(fn: () => Promise<string>): Promise<string> {
  try {
    return await withGitLock(fn, { timeoutMs: 15_000 })
  } catch (err) {
    if (err instanceof GitBusyError) {
      return 'Error: another session is running a git operation (commit/sync); retry shortly. Tell the user that git is currently busy.'
    }
    throw err
  }
}

async function githubContext(): Promise<
  { owner: string; repo: string; token: string } | string
> {
  const remotes = await g.listRemotes()
  const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0]
  const repo = origin ? parseGithubRemote(origin.url) : null
  if (!repo) return 'Error: no GitHub remote configured (or the remote is not github.com)'
  return { ...repo, token: useSettingsStore().state.githubToken }
}

const gitInit = defineTool({
  name: 'git_init',
  description:
    'Initialize a new git repository in the opened KB folder (default branch `main`) so it can be versioned and committed. Use this when the folder is not a git repository and the user wants version control; the other git tools become available once it succeeds. No-op if a repo already exists.',
  schema: z.object({}),
  describeCall: () => 'git init',
  run: () => lockedGit(async () => {
    if (await g.isRepo()) return 'Already a git repository — nothing to initialize.'
    await g.init()
    void useGitStore().refresh()
    return 'Initialized an empty git repository on branch main. Stage and commit files with git_commit.'
  }),
})

const gitStatus = defineTool({
  name: 'git_status',
  description:
    'Show the git state of the KB: current branch, GitHub remote, and text files changed vs HEAD. Note: .trace/ and large binaries (PDF/EPUB/media) are excluded from in-app git — those are committed from a terminal.',
  schema: z.object({}),
  describeCall: () => 'git status',
  run: () => lockedGit(async () => {
    if (!(await g.isRepo())) return 'The opened folder is not a git repository.'
    const branch = await g.currentBranch()
    const changes = await g.changedFiles()
    const remotes = await g.listRemotes()
    const lines = [
      `branch: ${branch ?? '(unborn)'}`,
      `remote: ${remotes.map((r) => `${r.name} ${r.url}`).join(', ') || '(none)'}`,
      changes.length
        ? `changes (${changes.length}):\n${changes
            .map(
              (c) =>
                `  ${c.kind}: ${c.path}${c.oversized ? ' [binary >100MB — terminal only]' : c.binary ? ' [binary]' : ''}`,
            )
            .join('\n')}`
        : 'working tree clean (content changes to tracked binaries are not detectable here)',
    ]
    return lines.join('\n')
  }),
})

const gitDiff = defineTool({
  name: 'git_diff',
  description:
    'Show the diff of one changed text file vs HEAD (unchanged regions collapsed). Use it to review a change before committing.',
  schema: z.object({
    path: z.string().describe('KB-relative path from git_status'),
  }),
  describeCall: (a) => `git diff ${a.path}`,
  run: async ({ path }) => {
    if (!(await g.isRepo())) return 'Error: not a git repository'
    const before = await g.readHeadText(path)
    const after = await fs.tryReadFile(path)
    if (before === null && after === null) return `Error: ${path} not found in HEAD or worktree`
    const lines = collapseContext(diffLines(before ?? '', after ?? ''))
    const rendered = lines
      .map((l) =>
        l.type === 'skip'
          ? `⋯ ${l.count} unchanged lines ⋯`
          : `${l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '} ${l.text}`,
      )
      .join('\n')
    return rendered.length > 20_000
      ? rendered.slice(0, 20_000) + '\n[diff truncated]'
      : rendered || '(no changes)'
  },
})

const gitRestore = defineTool({
  name: 'git_restore',
  description:
    'Restore text files to their committed state (HEAD), throwing away the uncommitted changes — this also brings back a file that was deleted after being committed. Pass exact paths from git_status. It overwrites current work, so confirm with the user before restoring anything they might still want.',
  schema: z.object({
    paths: z.array(z.string()).min(1).describe('KB-relative paths to restore from HEAD'),
  }),
  describeCall: (a) => `git restore ${a.paths.join(', ').slice(0, 60)}`,
  run: async ({ paths }, ctx) => {
    if (!(await g.isRepo())) return 'Error: not a git repository'
    const done: string[] = []
    const failed: string[] = []
    for (const raw of paths) {
      const path = cleanPath(raw)
      // HEAD blobs are decoded as UTF-8, so a binary would come back corrupted.
      if (!isTextFile(path)) {
        failed.push(`${path} (binary — restore it from a terminal)`)
        continue
      }
      const head = await g.readHeadText(path)
      if (head === null) {
        failed.push(`${path} (not in HEAD)`)
        continue
      }
      // …and a working copy whose bytes are binary tells us the name lied,
      // whatever extension it wears.
      const read = await fs.readTextFile(path)
      if (!read.ok && read.reason !== 'missing') {
        failed.push(`${path} (binary — restore it from a terminal)`)
        continue
      }
      const before = read.ok ? read.text : null
      if (before === head) {
        failed.push(`${path} (already matches HEAD)`)
        continue
      }
      const decision = await approved(ctx, path, before, head)
      if (decision === 'stopped') {
        // The turn is dead — asking about the remaining paths would dangle.
        failed.push(`${path} (turn stopped before a decision — not restored)`)
        break
      }
      if (decision === 'rejected') {
        failed.push(`${path} (declined by the user)`)
        continue
      }
      await performWrite(path, before, head)
      done.push(path)
    }
    refreshGitStatus()
    const head = done.length ? `Restored ${done.length} file(s) from HEAD:\n${done.map((p) => `  ${p}`).join('\n')}` : ''
    const tail = failed.length ? `${head ? '\n' : ''}Skipped: ${failed.join(', ')}` : ''
    return head + tail || 'Error: nothing to restore.'
  },
})

const gitLog = defineTool({
  name: 'git_log',
  description: 'Show recent commits (newest first).',
  schema: z.object({
    depth: z.number().optional().describe('How many commits (default 10, max 50)'),
  }),
  describeCall: (a) => `git log${a.depth ? ` -${a.depth}` : ''}`,
  run: async ({ depth }) => {
    if (!(await g.isRepo())) return 'Error: not a git repository'
    const entries = await g.recentLog(Math.min(depth ?? 10, 50))
    if (!entries.length) return 'No commits yet.'
    return entries
      .map((e) => `${e.oid.slice(0, 7)} ${new Date(e.when).toISOString().slice(0, 10)} ${e.author}: ${e.message}`)
      .join('\n')
  },
})

const gitCommit = defineTool({
  name: 'git_commit',
  description:
    'Commit changed text files. Omit "paths" to commit every changed text file from git_status; pass specific paths to commit a subset. Write a concise message summarizing the change.',
  schema: z.object({
    message: z.string().describe('Commit message'),
    paths: z.array(z.string()).optional().describe('Subset of changed paths (default: all)'),
  }),
  describeCall: (a) => `git commit${a.paths ? ` (${a.paths.length} files)` : ''}: ${a.message.slice(0, 50)}`,
  run: ({ message, paths }) => lockedGit(async () => {
    if (!(await g.isRepo())) return 'Error: not a git repository'
    if (!message.trim()) return 'Error: commit message must not be empty'
    const changes = await g.changedFiles()
    let chosen = paths?.length ? changes.filter((c) => paths.includes(c.path)) : changes
    // Files above the 100MB API limit can't be added in-app — drop with a note.
    const blocked = chosen.filter((c) => c.oversized)
    chosen = chosen.filter((c) => !c.oversized)
    if (!chosen.length) {
      if (blocked.length) {
        return `Error: only >100MB binary files were selected (${blocked.map((c) => c.path).join(', ')}) — those must be committed from a terminal.`
      }
      return paths?.length
        ? `Error: none of the given paths are in the changed list. Changed: ${changes.map((c) => c.path).join(', ') || '(none)'}`
        : 'Nothing to commit — no committable changes.'
    }
    const settings = useSettingsStore()
    const author = await g.resolveAuthor({
      name: settings.state.gitName || 'browser-md',
      email: settings.state.gitEmail || 'browser-md@local',
    })
    const oid = await g.commitPaths(chosen, message.trim(), author)
    // Committing is an approval — drop these from the agent-changes review list.
    useReviewStore().markCommitted(chosen.map((c) => c.path))
    void useGitStore().refresh()
    const note = blocked.length
      ? `\n(skipped >100MB files — commit from a terminal: ${blocked.map((c) => c.path).join(', ')})`
      : ''
    return `Committed ${chosen.length} file(s) as ${oid.slice(0, 7)}:\n${chosen.map((c) => `  ${c.path}`).join('\n')}${note}`
  }),
})

const gitPush = defineTool({
  name: 'git_push',
  description:
    'Push local commits to the GitHub remote (fast-forward only, via the GitHub API). Requires a GitHub token in Settings. Commit first; on divergence tell the user to resolve in a terminal.',
  schema: z.object({}),
  describeCall: () => 'git push',
  run: () => lockedGit(async () => {
    if (!(await g.isRepo())) return 'Error: not a git repository'
    const ctx = await githubContext()
    if (typeof ctx === 'string') return ctx
    if (!ctx.token) {
      return 'Error: push requires a GitHub token. Ask the user to add a fine-grained token in Settings → Git & GitHub with Contents: Read and write, and Repository access that includes this repo ("All repositories", or add it under "Only select repositories"). The README has a step-by-step guide under "Getting a GitHub Token".'
    }
    try {
      const summary = await ghPush(ctx)
      void useGitStore().refresh()
      return summary
    } catch (err) {
      return `Push failed: ${explainGithubError(err, 'push', `${ctx.owner}/${ctx.repo}`)}`
    }
  }),
})

const gitPull = defineTool({
  name: 'git_pull',
  description:
    'Pull new commits from the GitHub remote (fast-forward only, via the GitHub API) and update the working tree. Public repos work without a token.',
  schema: z.object({}),
  describeCall: () => 'git pull',
  run: () => lockedGit(async () => {
    if (!(await g.isRepo())) return 'Error: not a git repository'
    const ctx = await githubContext()
    if (typeof ctx === 'string') return ctx
    try {
      const summary = await ghPull(ctx)
      await useFilesStore().refreshTree()
      void useGitStore().refresh()
      return summary
    } catch (err) {
      return `Pull failed: ${explainGithubError(err, 'pull', `${ctx.owner}/${ctx.repo}`)}`
    }
  }),
})

const gitRemoteAdd = defineTool({
  name: 'git_remote_add',
  description:
    'Point the KB at a git remote (usually `origin` on GitHub) so git_push/git_pull can sync to it. Pass the repo URL (https://github.com/owner/name, with or without .git). Replaces the remote if one with the same name exists.',
  schema: z.object({
    url: z.string().describe('Remote repository URL'),
    name: z.string().optional().describe('Remote name (default: origin)'),
  }),
  describeCall: (a) => `git remote add ${a.name ?? 'origin'} ${a.url}`,
  run: ({ url, name }) => lockedGit(async () => {
    if (!(await g.isRepo())) return 'Error: not a git repository — run git_init first.'
    const remote = name?.trim() || 'origin'
    await g.addRemote(url.trim(), remote)
    void useGitStore().refresh()
    return `Set remote ${remote} → ${url.trim()}`
  }),
})

const githubCreateRepo = defineTool({
  name: 'github_create_repo',
  description:
    "Create a new GitHub repository for the authenticated user (via the GitHub token in Settings) and set it as the KB's `origin` remote — no need to open the GitHub website or a terminal. Defaults: name = the open KB's folder name, and private. Afterwards git_commit then git_push publishes the history (the first push to the empty repo is supported). Requires a token allowed to create repos (fine-grained: Administration write).",
  schema: z.object({
    name: z.string().optional().describe('Repository name (default: the KB folder name)'),
    private: z.boolean().optional().describe('Create a private repo (default: true)'),
  }),
  describeCall: (a) =>
    `github create repo ${a.name ?? '(kb name)'}${a.private === false ? ' (public)' : ' (private)'}`,
  run: ({ name, private: priv }) => lockedGit(async () => {
    const token = useSettingsStore().state.githubToken
    if (!token) {
      return 'Error: creating a repo requires a GitHub token. Ask the user to add a fine-grained token in Settings → Git & GitHub with Administration: Read and write and Repository access set to "All repositories" (see the README under "Getting a GitHub Token"). If a browser tool is connected, creating the repo on the GitHub website is an alternative.'
    }
    const repoName = (name?.trim() || useKbStore().name || '').trim()
    if (!repoName) return 'Error: no repository name given and no KB is open.'
    let created
    try {
      created = await ghCreateRepo(token, repoName, { private: priv ?? true })
    } catch (err) {
      return `Create repo failed: ${explainGithubError(err, 'create', repoName)}`
    }
    const isRepo = await g.isRepo()
    if (isRepo) {
      await g.addRemote(created.htmlUrl)
      void useGitStore().refresh()
    }
    const tail = isRepo
      ? 'Set as origin remote — now git_commit, then git_push to publish.'
      : `The KB isn't a git repo yet — run git_init, then git_remote_add ${created.htmlUrl}, then commit and push.`
    return `Created ${created.private ? 'private' : 'public'} repo ${created.owner}/${created.repo} (${created.htmlUrl}). ${tail}`
  }),
})

/* ── external tool sources (remote MCP servers) ─────────────────────────── */

export interface ExternalToolSpec {
  /** Namespaced model-facing name (mcp__<server>__<tool>). */
  name: string
  description: string
  jsonSchema: Record<string, unknown>
  describeCall: (args: Record<string, unknown>) => string
  /** `signal` is the turn's: stop must cancel the request in flight, not just
   *  the model stream that asked for it. */
  run: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>
}

type McpTool = ReturnType<ReturnType<typeof useMcpStore>['activeToolsFor']>[number]

/**
 * Ceiling on what one external tool call may put into the turn.
 *
 * An HTTP tool's own `maxChars` is applied AFTER its template has already shaped
 * the response down, so its 20k default is a budget. Nothing shapes an MCP
 * result — a third-party server returns whatever it returns, straight into the
 * context — so this is a backstop against unbounded rather than a budget, and it
 * sits above what servers actually send: measured live, the talkative ones land
 * around 28k characters (Parallel web_search, scite search_literature), and doc
 * readers well under that. A cap that clipped those would be tuning a number
 * against real, wanted output; this one only fires on a server that has lost the
 * plot. `clip` says how much it dropped, so the model can narrow and retry
 * instead of silently working from a severed result.
 */
const MAX_EXTERNAL_TOOL_CHARS = 40_000

/** Whether a tool's server row is localmd Connect — the one server whose write
 *  surface confirms with the user (see agent/connectGuard.ts). */
function isConnectServer(mcp: ReturnType<typeof useMcpStore>, serverId: string): boolean {
  const url = mcp.servers.find((s) => s.config.id === serverId)?.config.url ?? ''
  return isLocalmdConnectRelayUrl(url)
}

function toExternalSpec(
  mcp: ReturnType<typeof useMcpStore>,
  t: McpTool,
  sessionId: string,
): ExternalToolSpec {
  return {
    name: t.qualifiedName,
    description: clipText(`[External MCP: ${t.serverName}] ${t.def.description}`, 1024, ''),
    jsonSchema: t.def.inputSchema,
    describeCall: (a) => `${t.serverName}: ${t.def.name}(${JSON.stringify(a).slice(0, 60)})`,
    run: async (args, signal) => {
      try {
        // localmd Connect's write surface — a write-access adapter, a site
        // script — confirms with the user BEFORE the call reaches the
        // extension: the extension trusts this app's UI and gates nothing
        // itself. A declined call reports the decline instead of running.
        if (isConnectServer(mcp, t.serverId)) {
          const declined = await confirmConnectCall({
            sessionId,
            serverId: t.serverId,
            tool: t.def.name,
            args,
            callTool: (tool, a) => mcp.callTool(t.serverId, tool, a, signal),
          })
          if (declined) return declined
        }
        const out = await mcp.callTool(t.serverId, t.def.name, args, signal)
        // find_adapters results feed the write-adapter gate's access cache —
        // fed the UNclipped result, so a row past the budget still counts.
        // A call that left a browser tab behind is recorded for the turn's end
        // reap (agent/connectJanitor.ts): the extension hands us the tab and
        // considers its job done, so closing it is this side's contract.
        if (isConnectServer(mcp, t.serverId)) {
          noteConnectResult(t.serverId, t.def.name, out)
          noteOpenedTab(sessionId, t.serverId, out)
        }
        // A tool that actually ran earns a recall slot, so the next session in
        // this KB starts with it already active (see the store's `recalled`).
        // Only successful calls count — a tool that always throws shouldn't
        // squat on the cap.
        mcp.rememberUse(t.qualifiedName)
        // Capped here rather than in the store: internal callers reach
        // callTool too — the extension HTTP transport and the MCP-over-extension
        // wire both read a JSON envelope out of it, and clipping that would
        // corrupt the plumbing rather than save tokens. This is the model-facing
        // path.
        //
        // Past the budget the tail would be gone for good, so save the whole
        // thing first and let the clip note point at it: re-reading a file is
        // deterministic and free, where re-calling the tool may re-rank, be
        // refused, or have no way to ask for the part that went missing. Only
        // this branch writes — a result that fits is not losing anything.
        if (out.length <= MAX_EXTERNAL_TOOL_CHARS) return out
        const stored = await storeToolResult(sessionId, t.qualifiedName, out)
        return clipWithRecall(out, MAX_EXTERNAL_TOOL_CHARS, stored)
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
  }
}

/** The session's currently-ACTIVE external tools (deferred ones stay out until
 *  enable_tools activates them). Used to gate which registered tools are sent
 *  to the model each step, so activation takes effect within the same turn. */
export function externalToolSpecs(sessionId: string): ExternalToolSpec[] {
  const mcp = useMcpStore()
  return mcp.activeToolsFor(sessionId).map((t) => toExternalSpec(mcp, t, sessionId))
}

/** ALL of the session's external tools, active AND deferred — registered up
 *  front with the AI SDK so a deferred tool can be enabled into the active set
 *  mid-turn (the SDK can only gate a fixed tool set, not grow it per step). */
export function allExternalToolSpecs(sessionId: string): ExternalToolSpec[] {
  const mcp = useMcpStore()
  return [...mcp.activeToolsFor(sessionId), ...mcp.deferredToolsFor(sessionId)].map((t) =>
    toExternalSpec(mcp, t, sessionId),
  )
}

/**
 * Installed HTTP tools (recommended catalog + the user's own + the KB's),
 * shaped like external tools so the runner registers them the same way. There
 * are no built-in web tools any more: web access is whatever the user installed
 * in Settings → Tools, which is why this list can legitimately be empty.
 */
function toHttpSpec(
  store: ReturnType<typeof useToolsStore>,
  spec: HttpToolSpec,
): ExternalToolSpec {
  return {
    name: spec.name,
    description: spec.description,
    jsonSchema: httpToolJsonSchema(spec),
    describeCall: (args) => describeHttpCall(spec, args),
    run: async (args, signal) => {
      const out = await store.run(spec, args, signal)
      // Same recall contract as MCP tools: a deferred tool that actually ran
      // earns a slot, so the next session in this KB starts with it active.
      // Only successful calls count.
      if (!out.startsWith('Error')) store.rememberUse(spec.name)
      return out
    },
  }
}

/** The session's currently-ACTIVE installed tools — big bundles stay out
 *  until enable_tools activates them, exactly like big MCP servers. */
export function httpToolSpecs(sessionId: string): ExternalToolSpec[] {
  const store = useToolsStore()
  return store.activeSpecsFor(sessionId).map((spec) => toHttpSpec(store, spec))
}

/** ALL installed tools, active AND deferred — registered up front for the
 *  same reason as allExternalToolSpecs: activation must work mid-turn. */
export function allHttpToolSpecs(sessionId: string): ExternalToolSpec[] {
  const store = useToolsStore()
  return [...store.activeSpecsFor(sessionId), ...store.deferredSpecsFor(sessionId)].map((spec) =>
    toHttpSpec(store, spec),
  )
}

export const TOOLS: ToolSpec[] = [
  listFiles,
  readFile,
  writeFile,
  editFile,
  deletePath,
  movePath,
  createDirectory,
  openFile,
  createArtifact,
  searchFiles,
  kbHealth,
  indexDocument,
  saveTranscript,
  updatePlan,
  useSkill,
  appHelp,
  appSettings,
  enableTools,
  manageTools,
  requestSetup,
  gitInit,
  gitStatus,
  gitDiff,
  gitRestore,
  gitLog,
  gitCommit,
  gitPush,
  gitPull,
  gitRemoteAdd,
  githubCreateRepo,
]

/* run.ts registers these beyond TOOLS; they are as built-in as the rest. */
export const RUNNER_TOOL_NAMES = ['view_image', 'generate_image', 'run_subagent']
const BUILTIN_TOOL_NAMES = new Set([...TOOLS.map((t) => t.name), ...RUNNER_TOOL_NAMES])

/** The git tools that cannot act without a repository — everything but
 *  git_init, the one that creates it. A lockstep test keeps this in sync with
 *  TOOLS, so renaming a git tool cannot silently escape the gate. */
export const GIT_TOOLS_NEEDING_REPO: ReadonlySet<string> = new Set([
  'git_status',
  'git_diff',
  'git_restore',
  'git_log',
  'git_commit',
  'git_push',
  'git_pull',
  'git_remote_add',
  'github_create_repo',
])

/** Built-in tools withheld from the model THIS step. The git family rides
 *  only when the KB actually is a git repository — in any other folder those
 *  schemas are ~1k tokens per step describing tools that can only error.
 *  Registration is untouched; the per-step active list consults this, so
 *  git_init succeeding (its run refreshes the git store) makes the family
 *  appear on the very next step of the same turn. */
export function inactiveBuiltinNames(): Set<string> {
  try {
    if (useGitStore().isRepo) return new Set()
  } catch {
    return new Set() // no Pinia (tests, non-app callers) — nothing withheld
  }
  return new Set(GIT_TOOLS_NEEDING_REPO)
}

/** Whether a history tool result came from a built-in tool — deterministic and
 *  free to re-run, with any file content already in the KB — rather than an
 *  external MCP/HTTP tool, whose re-call may re-rank, refuse, or bill. The
 *  history trim stores external results before stubbing them; built-ins it
 *  just stubs. */
export function isBuiltinToolName(name: string): boolean {
  return BUILTIN_TOOL_NAMES.has(name)
}
