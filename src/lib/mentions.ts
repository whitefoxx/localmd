/**
 * Claude Code-style @-mentions in the chat input. Pure string logic — the
 * dropdown UI lives in ChatPanel. A mention is `@` followed by a KB file path;
 * extraction matches against the KNOWN file list (longest match wins), so
 * paths containing spaces or CJK work without any escaping.
 */

export interface MentionQuery {
  /** Index of the '@' character. */
  start: number
  /** Text typed after the '@' up to the caret. */
  query: string
}

/** The active @-token containing the caret, or null. An '@' opens a mention
 *  when it sits at the start of the text or after whitespace; the token ends
 *  at the caret and must not contain a newline. */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const upto = text.slice(0, caret)
  const at = upto.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(upto[at - 1])) return null
  const query = upto.slice(at + 1)
  if (query.includes('\n')) return null
  return { start: at, query }
}

/**
 * Rank KB files against a mention query. Matching is case-insensitive;
 * basename-prefix beats basename-substring beats path-substring; ties break on
 * path length.
 *
 * `open` is what the user has open in the editor, most-wanted first (the file
 * on screen, then the other tabs). It lifts those files above equally good
 * matches, which decides the case the menu is in most often: a bare `@` with
 * nothing typed yet, where "the files I am working on" is a far better guess at
 * what someone means than "the files with the shortest paths".
 */
export function filterFiles(
  files: string[],
  query: string,
  limit = 8,
  open: readonly string[] = [],
): string[] {
  const q = query.toLowerCase()
  // Enough to break a tie, never enough to outrank a better match: an open file
  // that matches worse still loses.
  const openBoost = (path: string): number => {
    const i = open.indexOf(path)
    return i < 0 ? 0 : 0.9 - Math.min(i, 8) * 0.1
  }
  const scored: { path: string; score: number }[] = []
  for (const path of files) {
    const lower = path.toLowerCase()
    const base = lower.slice(lower.lastIndexOf('/') + 1)
    let score: number
    if (!q) score = 0
    else if (base.startsWith(q)) score = 3
    else if (base.includes(q)) score = 2
    else if (lower.includes(q)) score = 1
    else continue
    scored.push({ path, score: score + openBoost(path) })
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
  return scored.slice(0, limit).map((s) => s.path)
}

/** KB paths mentioned as @path tokens, in order, deduped. Each '@' (at start
 *  or after whitespace) is matched against the known file list; the longest
 *  matching path wins so "wiki/a.md" doesn't shadow "wiki/a.md.bak". */
export function extractMentions(text: string, files: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue
    if (i > 0 && !/\s/.test(text[i - 1])) continue
    const rest = text.slice(i + 1)
    let best = ''
    for (const f of files) {
      if (rest.startsWith(f) && f.length > best.length) best = f
    }
    if (best) {
      if (!out.includes(best)) out.push(best)
      i += best.length
    }
  }
  return out
}
