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
import { useReviewStore } from '@/stores/review'
import { useFilesStore } from '@/stores/files'

const MAX_READ_CHARS = 100_000
const MAX_SEARCH_RESULTS = 50

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolSpec<S extends z.ZodType = any> {
  name: string
  description: string
  schema: S
  /** One-line human summary of a call, shown in the chat transcript. */
  describeCall: (args: z.infer<S>) => string
  run: (args: z.infer<S>) => Promise<string>
}

function defineTool<S extends z.ZodType>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec
}

const listFiles = defineTool({
  name: 'list_files',
  description:
    'List every file in the knowledge base as newline-separated paths relative to the KB root. Call this first to understand the KB structure.',
  schema: z.object({}),
  describeCall: () => 'list files',
  run: async () => {
    const tree = await fs.readTree()
    const paths = fs.collectFiles(tree)
    return paths.length ? paths.join('\n') : '(empty folder)'
  },
})

const readFile = defineTool({
  name: 'read_file',
  description: 'Read a text file from the knowledge base. Path is relative to the KB root.',
  schema: z.object({
    path: z.string().describe('KB-relative path, e.g. "wiki/index.md"'),
  }),
  describeCall: (a) => `read ${a.path}`,
  run: async ({ path }) => {
    const content = await fs.tryReadFile(path)
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
    'Create or overwrite a text file in the knowledge base. Always read_file first when modifying an existing file, and write the complete new content. Parent directories are created automatically.',
  schema: z.object({
    path: z.string().describe('KB-relative path, e.g. "wiki/concepts/foo.md"'),
    content: z.string().describe('Full file content'),
  }),
  describeCall: (a) => `write ${a.path}`,
  run: async ({ path, content }) => {
    const before = await fs.tryReadFile(path)
    await fs.writeFile(path, content)
    useReviewStore().recordWrite(path, before, content)
    const files = useFilesStore()
    await files.refreshTree()
    await files.reloadIfClean(path)
    return `Wrote ${path} (${content.length} chars)`
  },
})

const searchFiles = defineTool({
  name: 'search_files',
  description:
    'Case-insensitive substring search across all markdown/text files. Returns "path:line: text" matches.',
  schema: z.object({
    query: z.string().describe('Substring to search for'),
  }),
  describeCall: (a) => `search "${a.query}"`,
  run: async ({ query }) => {
    const tree = await fs.readTree()
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

export const TOOLS: ToolSpec[] = [listFiles, readFile, writeFile, searchFiles]
