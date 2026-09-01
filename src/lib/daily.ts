/**
 * Daily capture pages — the knowledge base's zero-friction input surface.
 *
 * One markdown file per day, named `YYYY-MM-DD.md`, holding whatever was
 * jotted that day as plain bullets. What makes it frictionless is that the
 * calendar decides where a thought goes: writing one down costs no filing
 * decision, which is the whole reason a passing thought reaches the KB at all.
 * A day nothing was jotted has no file — nothing is created on a schedule.
 *
 * A capture page is a *source*, not a note. It is unprocessed material the
 * agent later distills into wiki pages, which is why it lands beside the other
 * intake (`raw/` in a raw-layout KB, the neutral `inbox/` elsewhere) and not
 * in `wiki/`. Distinct from the synthesis log (`log.md`), which runs the other
 * direction: the log is what was found out *about the KB*, written by the
 * agent, and `parseLogEntries` reads its dated headings for meaning. Nothing
 * reads meaning into a capture page. Keeping the two apart is what lets one
 * stay pressure-free.
 *
 * The path below is a default, never a contract. Resolution looks for a file
 * of that NAME anywhere in the KB first, then for wherever this KB already
 * keeps dated pages — so moving them (the user's right) keeps working, and a
 * folder that already holds Obsidian daily notes or Logseq journals is picked
 * up with no configuration at all.
 */
import { INBOX_DIR } from '@/lib/capture'

/** Subdirectory used only when a KB has no dated pages to learn from yet. */
export const DAILY_DIR = 'daily'

const DAILY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/

/**
 * Today as `YYYY-MM-DD` in the user's own timezone. Deliberately not
 * `toISOString()`, which is UTC: it files a 9pm thought in Shanghai under
 * tomorrow, and one at 5pm in California under today — the same off-by-one
 * seen from either side, and the kind that makes someone stop trusting where
 * their notes went.
 */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** The date a capture page is for, or null when its name is not a date. */
export function dailyDateOf(path: string): string | null {
  const m = DAILY_FILE_RE.exec(path.slice(path.lastIndexOf('/') + 1))
  return m ? m[1] : null
}

export function isDailyPath(path: string): boolean {
  return dailyDateOf(path) !== null
}

const depth = (path: string): number => path.split('/').length

const dirOf = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

/**
 * The capture page a day already has, or null when nothing was written that
 * day. Shallowest wins when the same name exists twice — deterministic, and
 * never an error: a KB is allowed to be untidy.
 *
 * Separate from `resolveDailyPath` because the difference matters to callers
 * that must not bring a file into being by asking about it: what the app opens
 * on startup is one of those, and what makes a folder of these worth keeping
 * is that a day nobody wrote anything has no page in it.
 */
export function findDailyPath(date: string, files: readonly string[]): string | null {
  const name = `${date}.md`
  const existing = files.filter((p) => p === name || p.endsWith(`/${name}`))
  if (!existing.length) return null
  return [...existing].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0]
}

/**
 * Where a given day's captures live — the answer a write needs, which always
 * has one.
 *
 * In order: the file itself if it already exists (wherever it is), then the
 * directory this KB already keeps dated pages in — most populated first, so
 * one stray `2019-03-04.md` in an archive cannot outvote a year of journals —
 * and only then the default beside the other intake.
 */
export function resolveDailyPath(
  date: string,
  files: readonly string[],
  rawLayout: boolean,
): string {
  const name = `${date}.md`
  const existing = findDailyPath(date, files)
  if (existing) return existing

  const byDir = new Map<string, number>()
  for (const p of files) {
    if (!isDailyPath(p)) continue
    const dir = dirOf(p)
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1)
  }
  const home = [...byDir].sort(
    (a, b) => b[1] - a[1] || depth(a[0]) - depth(b[0]) || a[0].localeCompare(b[0]),
  )[0]
  if (home) return home[0] ? `${home[0]}/${name}` : name

  return `${rawLayout ? `raw/${DAILY_DIR}` : `${INBOX_DIR}/${DAILY_DIR}`}/${name}`
}

/**
 * The page's text with `text` appended as bullets — one per non-empty line, so
 * a pasted paragraph arrives as separate jots instead of one unreadable line,
 * and a line already written as a list item is left as it is.
 *
 * Appended at the END: within a day the stream reads oldest-first, which is
 * also where the cursor already sits when the page is open. (The synthesis
 * log's day headings go the other way — newest first — because that page is
 * read from the top; this one is written to from the bottom.)
 *
 * A page that does not exist yet is opened with its date as the title, and
 * nothing else: no frontmatter, no tags, nothing to fill in. Everything this
 * function does NOT add is the feature.
 */
/** A capture page with nothing in it yet — the same opening a jot would make,
 *  so a page created by sitting down in it and one created by a jot are the
 *  same page. */
export function emptyDailyPage(date: string): string {
  return `# ${date}\n\n`
}

export function appendJot(content: string, text: string, date: string): string {
  const bullets = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^([-*+]|\d+\.)\s/.test(l) ? l : `- ${l}`))
  if (!bullets.length) return content
  const head = content.trim() ? `${content.replace(/\s+$/, '')}\n` : emptyDailyPage(date)
  return `${head}${bullets.join('\n')}\n`
}
