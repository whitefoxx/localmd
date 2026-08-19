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
 * Results are stored at the moment something is about to destroy them, and
 * only then: the call-time clip (here), and the history trim before it stubs
 * an external result it never clipped (lib/history.ts `trimCandidates` +
 * chat.ts). A result nothing threatens is not stored — re-calling the tool is
 * cheaper than leaving a file behind, and a threshold below the destruction
 * point would be a number invented to justify writes.
 */
import { removeDir, writeFile } from '@/lib/fs'
import { ensureIgnored } from '@/lib/gitignore'
import { fnv1a, slugify } from '@/lib/docindex/util'
import { clipText } from '@/lib/wellFormed'

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

/** A `.trace/tool-results/…` path mentioned in `text` (a clip note), so a trim
 *  that destroys the visible part can point its stub at the file that already
 *  holds the WHOLE result instead of storing a second, truncated copy. */
export function recallPathIn(text: string): string | null {
  const m = text.match(/\.trace\/tool-results\/\S+?\.txt/)
  return m ? m[0] : null
}

/** Remainder size past which the clip note recommends digesting the file via
 *  run_subagent instead of paging it into the main history. Below it, one
 *  continuation read settles the matter; above it, the raw text would sit in
 *  every later request of the session — a subagent burns it in a context that
 *  is thrown away and only the digest comes back. */
const DELEGATE_REMAINDER_CHARS = 20_000

/**
 * Clip to the budget, telling the model where the rest is when we managed to
 * save it. Without a path this is byte-identical to the plain budget clip, so
 * a failed write changes nothing but the absence of the offer.
 */
export function clipWithRecall(text: string, maxChars: number, path: string | null): string {
  if (text.length <= maxChars) return text
  // A tool result is arbitrary text — emoji included — so the cut may have to
  // fall one unit short of the budget to keep a surrogate pair whole (see
  // lib/wellFormed). `kept` rather than `maxChars` is therefore what the recall
  // offset must name: the two differ by one exactly when it matters, and an
  // offset that disagrees with the head re-reads or skips half a character.
  const head = clipText(text, maxChars, '')
  const kept = head.length
  if (!path) return `${head}\n\n[truncated: ${text.length} chars total]`
  const rest = text.length - kept
  if (rest > DELEGATE_REMAINDER_CHARS) {
    return (
      `${head}\n\n[truncated: ${kept} of ${text.length} chars. The full result is saved in the ` +
      `knowledge base at ${path} — do not call this tool again. Reading the remaining ${rest} chars ` +
      `directly would crowd your context: prefer run_subagent with a task like "Read ${path} with ` +
      `read_file, following the offset continuations to the end, and report <what you need from it>" ` +
      `and work from the digest. Only read_file path="${path}" offset=${kept} yourself when you ` +
      `truly need the raw text.]`
    )
  }
  return (
    `${head}\n\n[truncated: ${kept} of ${text.length} chars. The full result is saved in the ` +
    `knowledge base at ${path} — read the rest with read_file path="${path}" offset=${kept}, ` +
    `rather than calling this tool again.]`
  )
}
