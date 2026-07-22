/**
 * The agent's tool surface over the opened KB folder — the browser replacement
 * for trace-app's "Claude Code in a terminal". Tools are defined once with Zod
 * schemas; the Anthropic runner consumes them via betaZodTool and the
 * OpenAI-compatible loop derives JSON Schema with z.toJSONSchema().
 *
 * write_file records a before/after snapshot in the review store so the user
 * can approve or discard agent edits afterwards (the browser equivalent of
 * trace-app's git-based review flow).
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
import { isAnnotationsPath, renderAnnotationsDigest } from '@/lib/annotations'
import { jinaRead, jinaSearch } from '@/lib/webread'
import { diffLines, collapseContext } from '@/lib/diff'
import { loadSkill, listSkills } from '@/lib/skills'
import { formatLintReport } from '@/lib/lint'
import { slugify } from '@/lib/docindex/util'
import type { AgentEvent } from '@/agent/types'
import { useReviewStore } from '@/stores/review'
import { useFilesStore } from '@/stores/files'
import { usePlanStore, type PlanItem } from '@/stores/plan'
import { useSettingsStore } from '@/stores/settings'
import { useGitStore } from '@/stores/git'
import { useMcpStore } from '@/stores/mcp'
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
}

/** In ask mode, pause until the user approves the proposed content; returns
 *  whether the write may proceed (auto mode always may). */
async function approved(
  ctx: ToolCtx,
  path: string,
  before: string | null,
  after: string,
): Promise<boolean> {
  if (useSettingsStore().state.writeMode !== 'ask') return true
  return await useReviewStore().askApproval(ctx.sessionId, path, before, after)
}

async function performWrite(
  path: string,
  before: string | null,
  content: string,
): Promise<void> {
  await fs.writeFile(path, content)
  useReviewStore().recordWrite(path, before, content)
  const files = useFilesStore()
  await files.refreshTree()
  await files.reloadIfClean(path)
}

const MAX_READ_CHARS = 100_000
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
      return paths.length ? paths.join('\n') : '(empty directory)'
    } catch (err) {
      if ((err as DOMException).name === 'NotFoundError') return `Error: no such directory: ${dir}`
      throw err
    }
  },
})

const readFile = defineTool({
  name: 'read_file',
  description:
    'Read a file from the knowledge base. Path is relative to the KB root. PDF files are returned as extracted text with [page N] markers.',
  schema: z.object({
    path: z.string().describe('KB-relative path, e.g. "wiki/index.md"'),
  }),
  describeCall: (a) => `read ${a.path}`,
  run: async ({ path }) => {
    let content: string | null
    if (isAnnotationsPath(path)) {
      // Highlight sidecars are rect/CFI-heavy JSON — serve the rendered digest,
      // which is what annotation Q&A actually needs. Unparseable → raw JSON.
      const raw = await fs.tryReadFile(path)
      if (raw === null) return `Error: file not found: ${path}`
      const digest = renderAnnotationsDigest(path, raw)
      if (digest) return digest
      content = raw
    } else if (/\.(pdf|epub)$/i.test(path)) {
      // Binary documents go through the structured index (block ids, citeable).
      const { hasIndex, indexDirFor, indexableKind } = await import('@/lib/docindex')
      const kind = indexableKind(path)!
      if (await hasIndex(path)) {
        const dir = indexDirFor(kind, path)
        return `This document has a structured index at ${dir}/ — read ${dir}/_README.md and ${dir}/toc.md, then the relevant sections/*.md files (they carry citeable [[block-id]] tags). Use list_files/search_files with dir="${dir}".`
      }
      return `Error: ${path} is a ${kind.toUpperCase()} without an AI index yet. Call index_document with this path first, then read the generated index.`
    } else {
      content = await fs.tryReadFile(path)
    }
    if (content === null) return `Error: file not found: ${path}`
    if (content.length > MAX_READ_CHARS) {
      return content.slice(0, MAX_READ_CHARS) + `\n\n[truncated: file is ${content.length} chars]`
    }
    return content
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
    if (!(await approved(ctx, path, before, content))) {
      return `User declined the write to ${path}. Ask them how to proceed instead of retrying.`
    }
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
    if (!(await approved(ctx, path, before, result.content))) {
      return `User declined the edit to ${path}. Ask them how to proceed instead of retrying.`
    }
    await performWrite(path, before, result.content)
    return `Edited ${path} (${result.count} replacement${result.count > 1 ? 's' : ''})`
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
    if (!(await approved(ctx, path, null, html))) {
      return `User declined the artifact ${path}. Ask them how to proceed instead of retrying.`
    }
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
    return `Plan updated (${items.length} items). Continue with the next in_progress step.`
  },
})

const searchFiles = defineTool({
  name: 'search_files',
  description:
    'Case-insensitive substring search across markdown/text files. Returns "path:line: text" matches. Pass "dir" to search inside a specific directory — including index directories under .trace/.',
  schema: z.object({
    query: z.string().describe('Substring to search for'),
    dir: z.string().optional().describe('Directory to search in, e.g. ".trace/pdf-index/foo-123"'),
  }),
  describeCall: (a) => (a.dir ? `search "${a.query}" in ${a.dir}` : `search "${a.query}"`),
  run: async ({ query, dir }) => {
    const tree = dir ? await fs.readTreeFrom(dir) : await fs.readTree()
    const paths = fs.collectFiles(tree).filter((p) => /\.(md|txt|json|ya?ml|csv)$/i.test(p))
    const needle = query.toLowerCase()
    const out: string[] = []
    for (const p of paths) {
      if (out.length >= MAX_SEARCH_RESULTS) break
      const content = await fs.tryReadFile(p)
      if (!content) continue
      const lines = content.split('\n')
      for (let i = 0; i < lines.length && out.length < MAX_SEARCH_RESULTS; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          out.push(`${p}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
        }
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
    'Deterministic structural lint of the WHOLE knowledge base — broken wikilinks, orphan and weakly-linked pages, pages unreachable from the index, pages missing frontmatter, and thin / self-linking / placeholder pages. Computed from the content index with NO page reads, so it is cheap and complete: for structural/health checks call this ONCE instead of listing and reading pages. It does NOT check semantics (contradictions, stale claims) — those need reading content and are token-heavy, so report these findings first and confirm scope with the user before scanning content.',
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
    'Generate (or refresh) the structured AI index for a PDF, EPUB, or markdown source under .trace/. Returns the index directory. Read its _README.md and toc.md next, then the relevant sections/*.md — every block carries a citeable [[block-id]] tag. Skips work when a fresh index already exists.',
  schema: z.object({
    path: z.string().describe('KB-relative source path, e.g. "raw/papers/x.pdf"'),
  }),
  describeCall: (a) => `index ${a.path}`,
  run: async ({ path }) => {
    const { indexDocument: run } = await import('@/lib/docindex')
    const s = await run(path)
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
    await useFilesStore().refreshTree()
    return `Session saved to ${target}`
  },
})

const enableTools = defineTool({
  name: 'enable_tools',
  description:
    'Activate deferred external tools before calling them. The system prompt lists deferred tools (name + summary) — their full schemas are loaded only on demand to save context. Pass the EXACT qualified names (e.g. ["mcp__webagent__generic__open_url"]); they become callable immediately.',
  schema: z.object({
    names: z.array(z.string()).min(1).describe('Qualified tool names from the deferred catalog'),
  }),
  describeCall: (a) => `enable ${a.names.length} tool(s)`,
  run: async ({ names }, ctx) => {
    const mcp = useMcpStore()
    const accepted = mcp.activate(ctx.sessionId, names)
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
      const available = (await listSkills()).map((s) => s.name)
      return `Error: no skill named "${name}". Available: ${available.join(', ') || '(none)'}`
    }
    const resources = skill.resources.length
      ? `\n\nBundled resources (read with read_file when the instructions reference them):\n${skill.resources.map((r) => `- ${r}`).join('\n')}`
      : ''
    return `# Skill: ${skill.name}\n\n${skill.body}${resources}`
  },
})

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
    'Initialize a new git repository in the opened KB folder (default branch `main`) so it can be versioned and committed. Use this when git_status reports the folder is not a git repository and the user wants version control. No-op if a repo already exists.',
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
  run: (args: Record<string, unknown>) => Promise<string>
}

type McpTool = ReturnType<ReturnType<typeof useMcpStore>['activeToolsFor']>[number]

function toExternalSpec(mcp: ReturnType<typeof useMcpStore>, t: McpTool): ExternalToolSpec {
  return {
    name: t.qualifiedName,
    description: `[External MCP: ${t.serverName}] ${t.def.description}`.slice(0, 1024),
    jsonSchema: t.def.inputSchema,
    describeCall: (a) => `${t.serverName}: ${t.def.name}(${JSON.stringify(a).slice(0, 60)})`,
    run: async (args) => {
      try {
        return await mcp.callTool(t.serverId, t.def.name, args)
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
  return mcp.activeToolsFor(sessionId).map((t) => toExternalSpec(mcp, t))
}

/** ALL of the session's external tools, active AND deferred — registered up
 *  front with the AI SDK so a deferred tool can be enabled into the active set
 *  mid-turn (the SDK can only gate a fixed tool set, not grow it per step). */
export function allExternalToolSpecs(sessionId: string): ExternalToolSpec[] {
  const mcp = useMcpStore()
  return [...mcp.activeToolsFor(sessionId), ...mcp.deferredToolsFor(sessionId)].map((t) =>
    toExternalSpec(mcp, t),
  )
}

const MAX_WEB_CHARS = 60_000

/* Built-in web access via Jina AI Reader — NOT in TOOLS; run.ts adds them only
 * when the setting is on (a fallback for when the browser extension is absent).
 * They carry no login/cookies, so the prompt tells the model to prefer the
 * mcp__* browser tools when connected. */
export const webFetch = defineTool({
  name: 'web_fetch',
  description:
    "Fetch a single web page by URL and return its main content as markdown (via Jina AI Reader — no login or cookies). Use to read a page you have the URL for. Login-walled or heavily bot-protected pages may fail. If mcp__* browser tools are connected, prefer those — they carry the user's real session.",
  schema: z.object({
    url: z.string().describe('Full URL to read, e.g. "https://example.com/article"'),
  }),
  describeCall: (a) => `fetch ${a.url}`,
  run: async ({ url }) => {
    try {
      const text = await jinaRead(url)
      if (!text) return `Error: empty response reading ${url}`
      return text.length > MAX_WEB_CHARS
        ? text.slice(0, MAX_WEB_CHARS) + `\n\n[truncated: page is ${text.length} chars]`
        : text
    } catch (err) {
      return `Error: could not fetch ${url} — ${(err as Error).message}`
    }
  },
})

export const webSearch = defineTool({
  name: 'web_search',
  description:
    'Search the web and return result titles, URLs and snippets as markdown (DuckDuckGo, read via Jina AI Reader). Use when you need to FIND pages and have no URL; then read a promising result with web_fetch (or a browser tool). Prefer connected mcp__* browser tools when available.',
  schema: z.object({ query: z.string().describe('Search query') }),
  describeCall: (a) => `search "${a.query}"`,
  run: async ({ query }) => {
    try {
      const text = await jinaSearch(query)
      if (!text) return `Error: no results for "${query}"`
      return text.length > MAX_WEB_CHARS ? text.slice(0, MAX_WEB_CHARS) + '\n\n[truncated]' : text
    } catch (err) {
      return `Error: search failed for "${query}" — ${(err as Error).message}`
    }
  },
})

export const TOOLS: ToolSpec[] = [
  listFiles,
  readFile,
  writeFile,
  editFile,
  createArtifact,
  searchFiles,
  kbHealth,
  indexDocument,
  saveTranscript,
  updatePlan,
  useSkill,
  enableTools,
  gitInit,
  gitStatus,
  gitDiff,
  gitLog,
  gitCommit,
  gitPush,
  gitPull,
  gitRemoteAdd,
  githubCreateRepo,
]
