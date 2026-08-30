/**
 * The gate in front of an index build that would renumber block ids someone's
 * notes already cite.
 *
 * Two halves have to meet before anyone is worth interrupting, and they live
 * apart on purpose: whether a build CAN carry the old ids over is a fact about
 * the files (docindex's `renumberRisk`), and whether anything is AT stake is a
 * fact about the pages (`publishedCitations`, read from the in-memory page
 * cache). Either alone would cry wolf — a first build in a fresh KB is
 * dangerous to nothing, and a KB full of citations is fine as long as the ids
 * survive.
 *
 * Deliberately a question, not a refusal. The situation it catches — a KB
 * opened on a second machine without `.localmd/` — is one the user may well
 * want to proceed through (an index they can search beats citations they no
 * longer remember writing). What was wrong was doing it silently.
 */
import { t } from '@/i18n'
import { publishedCitations } from '@/lib/citations'
import { renumberRisk, type RenumberRisk } from '@/lib/docindex'
import { useFilesStore } from '@/stores/files'
import { useKbIndexStore } from '@/stores/kbIndex'

export interface RenumberWarning {
  reason: Exclude<RenumberRisk, null>
  /** Distinct block ids at stake. */
  ids: number
  /** Pages carrying them. */
  pages: number
}

/**
 * What indexing `path` right now would put at risk, or null when the answer is
 * "nothing" — no citations into this document, or ids that survive the build.
 *
 * Cheap half first: the citation count comes from the page cache, and only a
 * non-zero one is worth hashing the source for.
 */
export async function checkRenumber(path: string): Promise<RenumberWarning | null> {
  const kb = useKbIndexStore()
  // The page cache is what "already cited" is read from, and a viewer can open
  // a document before the first pass has finished. Coalesced and mtime-keyed,
  // so this is a no-op whenever the cache is already warm.
  await kb.refresh()
  const cited = publishedCitations(
    [...kb.pages].map(([p, page]) => [p, page.content] as const),
    useFilesStore().allFiles,
    path,
  )
  if (cited.ids.length === 0) return null
  const reason = await renumberRisk(path)
  if (!reason) return null
  return { reason, ids: cited.ids.length, pages: cited.pages.length }
}

const REASON_KEY: Record<Exclude<RenumberRisk, null>, string> = {
  'no-record': 'renumber.noRecord',
  'source-changed': 'renumber.sourceChanged',
  'no-inheritance': 'renumber.noInheritance',
}

/** Stake, reason and remedy as one paragraph — the same three sentences
 *  wherever the warning surfaces. */
export function renumberMessage(w: RenumberWarning): string {
  return [
    t('renumber.stake', { ids: w.ids, pages: w.pages }),
    t(REASON_KEY[w.reason]),
    t('renumber.remedy'),
  ].join(' ')
}

/**
 * Put the question. Every path that can proceed comes through here — the index
 * button someone pressed, and the badge a viewer raises when it declined to
 * index on open. Nobody asked for that automatic build, so it never prompts;
 * it stops, and the badge's click lands back here. One wording of the warning,
 * one place the decision is made.
 */
export function confirmRenumber(w: RenumberWarning): boolean {
  return confirm(`${renumberMessage(w)}\n\n${t('renumber.proceed')}`)
}
