/**
 * What else in the knowledge base is about this file.
 *
 * Three deterministic signals, computed from the index that is already in
 * memory — no model call, no stored state, nothing written. Recall is a view
 * (see CLAUDE.md), and this is the ambient half of it: it sits in the sidebar
 * and costs nothing, so it can be wrong without wasting anything.
 *
 * Each result carries WHY it is here — the tags or the sources the two files
 * share. "Related" with no reason is a guess the reader cannot check.
 *
 * Deliberately structural. Two pages about the same thing that share no tag,
 * no source and no link will not appear: that needs embeddings or a model,
 * which is a different cost bracket and a different feature.
 */
export interface RelatedGroup {
  path: string
  /** The tags, or the sources, the two files have in common. */
  shared: string[]
}

export interface RelatedResult {
  byTag: RelatedGroup[]
  bySource: RelatedGroup[]
}

export interface RelatedInput {
  path: string
  /** Pages that link here — shown separately, so they are excluded below. */
  backlinks: readonly string[]
  candidates: readonly string[]
  tagsOf: (p: string) => readonly string[]
  sourcesOf: (p: string) => readonly string[]
}

const MAX_PER_GROUP = 8

function overlap(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(b)
  return a.filter((x) => set.has(x))
}

function rank(groups: RelatedGroup[]): RelatedGroup[] {
  return groups
    .sort((x, y) => y.shared.length - x.shared.length || x.path.localeCompare(y.path))
    .slice(0, MAX_PER_GROUP)
}

export function relatedTo(input: RelatedInput): RelatedResult {
  const { path, backlinks, candidates, tagsOf, sourcesOf } = input
  // Already shown as backlinks: repeating them under another heading makes a
  // short list look like a long one.
  const skip = new Set([path, ...backlinks])
  const myTags = tagsOf(path)
  const mySources = sourcesOf(path)

  const byTag: RelatedGroup[] = []
  const bySource: RelatedGroup[] = []
  for (const other of candidates) {
    if (skip.has(other)) continue
    if (myTags.length) {
      const shared = overlap(myTags, tagsOf(other))
      if (shared.length) byTag.push({ path: other, shared })
    }
    if (mySources.length) {
      const shared = overlap(mySources, sourcesOf(other))
      if (shared.length) bySource.push({ path: other, shared })
    }
  }
  // A page in both groups belongs to the stronger one only — the same file
  // under two headings reads as two findings.
  const tagged = new Set(rank(byTag).map((g) => g.path))
  return {
    byTag: rank(byTag),
    bySource: rank(bySource.filter((g) => !tagged.has(g.path))),
  }
}
