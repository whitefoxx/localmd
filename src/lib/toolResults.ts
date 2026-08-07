/**
 * Overflow store for external tool results too large to fit in a turn.
 *
 * `MAX_EXTERNAL_TOOL_CHARS` caps what one external tool may put into the
 * context. Before the clip drops the tail, the whole result is written here and
 * the clip note names the file — so "too long" stops being a dead end. The
 * agent continues with `read_file`, which is deterministic, offline and free;
 * calling the tool again is none of those (a transcript has no page parameter,
 * a search re-ranks between calls, a rate limit simply refuses).
 *
 * `.trace/` is the app's own scratch area inside the KB, and everything needed
 * already treats it as such: the file tree and search hide it (`IGNORED` in
 * lib/fs.ts), git status skips it (lib/git.ts), and `read_file` reaches it
 * unchanged because path resolution never filtered dot-directories. So recall
 * costs no new tool, no new agent instruction, and not one byte of system
 * prompt — the agent already knows how to continue a truncated read, because
 * that is exactly how read_file's own offset works.
 *
 * ONLY clipped results are stored. A result that fits is not destroyed by
 * anything, and re-calling the tool is cheaper than leaving a file behind; a
 * threshold below the clip would be a number invented to justify writes.
 */
import { removeDir, writeFile } from '@/lib/fs'
import { ensureIgnored } from '@/lib/gitignore'
import { fnv1a, slugify } from '@/lib/docindex/util'

/** Under `.trace/`, so it is invisible to the tree, to search, and to git. */
export const TOOL_RESULTS_DIR = '.trace/tool-results'

/**
 * Where one result lands. Content-addressed: the same result fetched twice
 * rewrites one file instead of accumulating two, and the name says which tool
 * produced it so the directory is legible to a human who goes looking.
 */
export function toolResultPath(sessionId: string, toolName: string, text: string): string {
  return `${TOOL_RESULTS_DIR}/${slugify(sessionId)}/${slugify(toolName)}-${fnv1a(text)}.txt`
}

/**
 * Save a result and return its KB path, or null if it could not be saved.
 *
 * Never throws: storage is a convenience on top of the tool call, and a full
 * disk or a revoked handle must degrade to the old truncate-and-lose behaviour
 * rather than turn a working tool call into an error.
 */
export async function storeToolResult(
  sessionId: string,
  toolName: string,
  text: string,
): Promise<string | null> {
  const path = toolResultPath(sessionId, toolName, text)
  try {
    // A transcript is not history the user wants in their repo, and this is
    // the first thing that puts sizeable files under `.trace/` — doc indexes
    // got there without ever asking git to look away.
    await ensureIgnored('.trace')
    await writeFile(path, text)
    return path
  } catch {
    return null
  }
}

/** Drop a session's stored results — called when the session itself is deleted. */
export async function dropToolResults(sessionId: string): Promise<void> {
  try {
    await removeDir(`${TOOL_RESULTS_DIR}/${slugify(sessionId)}`)
  } catch {
    /* nothing was ever stored for it, or the KB is gone — either way, done */
  }
}

/**
 * Clip to the budget, telling the model where the rest is when we managed to
 * save it. Without a path this is byte-identical to the plain budget clip, so
 * a failed write changes nothing but the absence of the offer.
 */
export function clipWithRecall(text: string, maxChars: number, path: string | null): string {
  if (text.length <= maxChars) return text
  const head = text.slice(0, maxChars)
  if (!path) return `${head}\n\n[truncated: ${text.length} chars total]`
  return (
    `${head}\n\n[truncated: ${maxChars} of ${text.length} chars. The full result is saved in the ` +
    `knowledge base at ${path} — read the rest with read_file path="${path}" offset=${maxChars}, ` +
    `rather than calling this tool again.]`
  )
}
