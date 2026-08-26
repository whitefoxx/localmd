/**
 * Keeping app-generated directories out of the user's repo.
 *
 * The app writes two trees the user never asked for: `.tmp/` (composer
 * attachments) and `.localmd/` (document indexes, oversized tool results). The
 * in-app git panel already skips them, but that only governs the panel — a
 * `git add -A` from the terminal would sweep them in, and a doc index is
 * megabytes of regenerable derivative data nobody wants in their history.
 *
 * Deliberately a `.gitignore` line rather than app-side filtering: the user's
 * own git is the thing that must be told, and a line in a file they can read,
 * edit or delete is honest about what we are doing. Removing it is their call
 * and nothing here will put it back if the directory is already covered.
 */
import * as fs from '@/lib/fs'

/**
 * Ensure `.gitignore` covers `entry`. Idempotent and cheap enough to call on
 * every write into an ignored tree.
 *
 * Matching is deliberately loose — `.localmd/` and `.localmd` mean the same thing
 * to git, and a user who wrote either has already made the decision. Never
 * rewrites or reorders what is there; only appends when nothing matches.
 */
export async function ensureIgnored(entry: string): Promise<void> {
  const bare = entry.replace(/\/+$/, '')
  const line = `${bare}/`
  const current = (await fs.tryReadFile('.gitignore')) ?? ''
  const covered = current.split('\n').some((l) => {
    const t = l.trim()
    return t === line || t === bare
  })
  if (covered) return
  const next = current && !current.endsWith('\n') ? `${current}\n${line}\n` : `${current}${line}\n`
  await fs.writeFile('.gitignore', next)
}
