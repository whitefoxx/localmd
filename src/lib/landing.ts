/**
 * What is on screen when a knowledge base opens and there are no tabs to
 * restore — the first open of a KB in this browser, or one whose tabs were all
 * closed.
 *
 * Tab memory comes first and is untouched: someone returning to work is put
 * back where they were, and this only answers the question tab memory cannot.
 * Today's capture page outranks the index, because a KB with something already
 * jotted into it today is one being written in right now, and that page is
 * where the writing goes.
 *
 * Two things this deliberately does NOT do:
 *
 * - **Create anything.** Today's page is landed on only if it already exists;
 *   a page is brought into being by a jot or by asking for it, never by
 *   opening the app. A folder that fills with empty dated files on the days
 *   you merely looked at it is the litter this whole design is avoiding.
 * - **Read page content.** Roles resolve by name here (`kb-role:` frontmatter
 *   is the override `computeLint` honours, and needs every page's text).
 *   Deciding what to show first may not cost a read of the whole KB, and being
 *   wrong costs one glance at a file that opened — never a write.
 *
 * A KB that answers to none of this keeps the empty state, which is the honest
 * result for a folder of PDFs: it has no home page, and inventing one for it
 * would be the app grafting its layout onto someone's folder.
 */
import { todayIso, findDailyPath } from '@/lib/daily'

/** The name defaults for a KB's entry page, in the order `computeLint` reads
 *  them — one fact, even though the two callers reach it differently. */
const INDEX_NAMES = ['wiki/index.md', 'index.md']

export function landingPath(files: readonly string[], now?: Date): string | null {
  return (
    findDailyPath(todayIso(now), files) ?? INDEX_NAMES.find((p) => files.includes(p)) ?? null
  )
}
