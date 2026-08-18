/**
 * What the knowledge-base health scan looks at, expressed the way everyone
 * already knows how to express it: a list of things to ignore.
 *
 * It replaced an allowlist of top-level directories, which could only ever say
 * "these folders" — no way to skip one file, and a new folder was silently
 * out of scope until someone went back to the settings. A denylist is the same
 * decision from the other end, and it is the end people have already learned
 * from `.gitignore`.
 *
 * The grammar is deliberately a subset of git's, because this list is a handful
 * of paths a person types, not a language:
 *
 * - `raw/` (or `raw`) — that directory and everything under it
 * - `wiki/drafts/note.md` — one path; anything with a slash is anchored at the
 *   KB root, like git
 * - `AGENTS.md` — that name at any depth, file or directory, like git
 * - `*` matches inside one segment: `*.tmp.md`, `raw/*.pdf`
 *
 * No `**`, no negation, no character classes. Anything not understood is a
 * literal, which fails closed: the path stays IN scope, and an ignore rule that
 * does not work shows up as findings you did not expect rather than as findings
 * that quietly went missing.
 */

/** What a knowledge base ignores before anyone touches the setting: the source
 *  collection (not wiki pages, and not linked like them), the tool-facing
 *  `.agents/` tree, and the two convention files that live at the root. */
export const DEFAULT_HEALTH_IGNORE = ['raw/', '.agents/', 'AGENTS.md', 'CLAUDE.md'] as const

/** One path segment as a test. `*` and `?` are the only metacharacters. */
function segmentTest(seg: string): (s: string) => boolean {
  if (!/[*?]/.test(seg)) return (s) => s === seg
  const re = new RegExp(
    '^' +
      seg
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]') +
      '$',
  )
  return (s) => re.test(s)
}

/** Normalize a written pattern: `./raw/` and `raw` are the same rule. */
function clean(pattern: string): string {
  return pattern.trim().replace(/^\.?\//, '').replace(/\/+$/, '')
}

/** Whether `path` (KB-relative, no leading slash) is covered by any pattern. */
export function isIgnored(path: string, patterns: readonly string[]): boolean {
  const parts = path.split('/')
  for (const raw of patterns) {
    const pattern = clean(raw)
    if (!pattern) continue
    const segs = pattern.split('/')
    if (segs.length > 1) {
      // Anchored at the root: the pattern must match the leading segments, so
      // `wiki/drafts` covers `wiki/drafts/a.md` but not `other/wiki/drafts`.
      if (segs.length <= parts.length && segs.every((s, i) => segmentTest(s)(parts[i]))) return true
    } else {
      // A bare name matches at any depth — for the file itself and for every
      // path under a directory of that name.
      const test = segmentTest(segs[0])
      if (parts.some(test)) return true
    }
  }
  return false
}
