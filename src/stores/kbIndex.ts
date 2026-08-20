/**
 * KB-wide content index: an mtime-keyed cache of every markdown file's text
 * plus the wikilink graph derived from it. One index feeds search, backlinks,
 * the graph view, and health checks (the browser counterpart of trace-app's
 * main-process page-cache.ts).
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as fs from '@/lib/fs'
import { parseWikilinks, parseMarkdownLinks, extractType } from '@/lib/wiki'
import { isCitationToken } from '@/lib/citations'
import { computeLint, declaredSourcePaths, type LintReport } from '@/lib/lint'
import { fuzzyRank, excerptAround, queryTerms, hasAllTerms } from '@/lib/fuzzy'
import { coalesce } from '@/lib/async'
import { useFilesStore } from '@/stores/files'
import { useSettingsStore } from '@/stores/settings'
import { isIgnored } from '@/lib/scanScope'

interface CachedPage {
  mtime: number
  content: string
  /** Resolved KB paths of outgoing links (wikilinks + standard markdown links). */
  outgoing: string[]
  /** Link targets that resolve to no file (wikilink targets or markdown hrefs). */
  broken: string[]
  /** OKF frontmatter `type`, or null when the page declares none. */
  type: string | null
}

/** A cached section file from a PDF/EPUB index under .trace/. */
interface DocSection {
  mtime: number
  content: string
  /** Source document path (from the index dir's manifest.json). */
  source: string
}

export interface SearchHit {
  path: string
  line: number
  text: string
  /** Set when the hit is inside an indexed PDF/EPUB (path = source doc). */
  doc?: boolean
  /** Block id of the hit line, for jumping straight to the passage. */
  blockId?: string | null
}

/** A filename match, ranked, with the characters the query matched. */
export interface FileMatch {
  path: string
  /** Indices into `path` that the query matched — the palette underlines them. */
  positions: number[]
}

export interface HealthReport {
  brokenLinks: { path: string; targets: string[] }[]
  orphans: string[]
}

const MAX_HITS = 100

export const useKbIndexStore = defineStore('kbIndex', () => {
  const pages = ref<Map<string, CachedPage>>(new Map())
  const docSections = ref<Map<string, DocSection>>(new Map())
  /** Source file → mtime, for the sources pages actually cite. Kept next to
   *  the page cache because the staleness check compares the two, and the page
   *  half is already here — the index is mtime-keyed to begin with. */
  const sourceMtimes = ref<Map<string, number>>(new Map())
  const refreshing = ref(false)

  /** Coalesced passes: a request arriving mid-run schedules exactly one more
   *  instead of being discarded (lib/async owns the mechanics). */
  const pass = coalesce(runRefresh)

  /**
   * Bring the cache in sync with the tree.
   *
   * Dropping an overlapping request was a real bug. `mdFiles` comes from the
   * file tree, not from disk, so a refresh that starts before the tree is
   * populated indexes nothing — and the call that arrives right after the tree
   * lands (the backlinks panel reacting to the first opened file) was the one
   * being thrown away. The panel then showed "no backlinks" for a KB full of
   * them, with nothing left to trigger another attempt.
   *
   * `refreshing` is held across the WHOLE cycle rather than per pass: every
   * caller awaits a run that covers it, so the flag must not blink off between
   * a pass and the follow-up it scheduled.
   */
  async function refresh(): Promise<void> {
    if (!fs.hasRoot()) return
    refreshing.value = true
    try {
      await pass()
    } finally {
      refreshing.value = false
    }
  }

  /** One pass. Keeps the SAME Map reference when nothing changed, so downstream
   *  computeds (graph, health) don't re-emit and the graph view doesn't
   *  re-layout. Callers go through refresh(), which owns the running flag. */
  async function runRefresh(): Promise<void> {
    const files = useFilesStore()
    const mdPaths = new Set(files.mdFiles)
    const next = new Map(pages.value)
    let changed = false

    for (const cached of next.keys()) {
      if (!mdPaths.has(cached)) {
        next.delete(cached)
        changed = true
      }
    }

    for (const path of mdPaths) {
      const mtime = await fs.statMtime(path)
      if (mtime === null) continue
      const cached = next.get(path)
      if (cached && cached.mtime === mtime) continue
      const content = await fs.tryReadFile(path)
      if (content === null) continue
      const outgoing: string[] = []
      const broken: string[] = []
      for (const link of parseWikilinks(content)) {
        // Citation tokens (`[[1:b14-3]]`, `[[pdf1:…]]`) aren't page links — they
        // resolve at click-time via the doc indexes, exactly as the renderer
        // consumes them before wikilinks. Don't count them as broken links.
        if (isCitationToken(link.target)) continue
        const resolved = files.resolveWikilink(link.target)
        if (resolved) outgoing.push(resolved)
        else broken.push(link.target)
      }
      // Standard markdown links (OKF bundles use these instead of wikilinks).
      for (const href of parseMarkdownLinks(content)) {
        const resolved = files.resolveMarkdownLink(path, href)
        if (resolved) outgoing.push(resolved)
        else broken.push(href)
      }
      next.set(path, { mtime, content, outgoing, broken, type: extractType(content) })
      changed = true
    }
    if (changed) pages.value = next
    await refreshSourceMtimes(next)
    await refreshDocSections()
  }

  /** Stat the sources pages declare with `[[pdfN:path]]`. Only those: a page
   *  citing a document is claiming to have read it, which is what makes "the
   *  document changed after the page did" worth saying, and it keeps this to a
   *  handful of stats rather than one per file in the KB. */
  async function refreshSourceMtimes(current: Map<string, CachedPage>): Promise<void> {
    const files = useFilesStore()
    const next = new Map<string, number>()
    for (const path of declaredSourcePaths(current, files.allFiles)) {
      const mtime = await fs.statMtime(path)
      if (mtime !== null) next.set(path, mtime)
    }
    sourceMtimes.value = next
  }

  /** Cache the section files of every PDF/EPUB/DOCX index, so document content
   *  is searchable and hits can jump to the passage via their block ids. */
  async function refreshDocSections(): Promise<void> {
    const next = new Map(docSections.value)
    const seen = new Set<string>()
    let changed = false
    for (const kind of ['pdf-index', 'epub-index', 'docx-index']) {
      let tree
      try {
        tree = await fs.readTreeFrom(`.trace/${kind}`)
      } catch {
        continue // no such index kind yet
      }
      // One manifest per index dir gives the source document path.
      for (const dir of tree) {
        if (dir.kind !== 'dir') continue
        const manifestRaw = await fs.tryReadFile(`${dir.path}/manifest.json`)
        if (!manifestRaw) continue
        let source: string
        try {
          source = (JSON.parse(manifestRaw) as { source: string }).source
        } catch {
          continue
        }
        const sectionPaths = fs
          .collectFiles(dir.children ?? [])
          .filter((p) => /\/sections\/[^/]+\.md$/.test(p))
        for (const p of sectionPaths) {
          seen.add(p)
          const mtime = await fs.statMtime(p)
          if (mtime === null) continue
          const cached = next.get(p)
          if (cached && cached.mtime === mtime) continue
          const content = await fs.tryReadFile(p)
          if (content === null) continue
          next.set(p, { mtime, content, source })
          changed = true
        }
      }
    }
    for (const p of next.keys()) {
      if (!seen.has(p)) {
        next.delete(p)
        changed = true
      }
    }
    if (changed) docSections.value = next
  }

  /** path → set of pages linking to it. */
  const inbound = computed(() => {
    const map = new Map<string, Set<string>>()
    for (const [path, page] of pages.value) {
      for (const target of page.outgoing) {
        if (target === path) continue
        let set = map.get(target)
        if (!set) map.set(target, (set = new Set()))
        set.add(path)
      }
    }
    return map
  })

  function backlinks(path: string): string[] {
    return [...(inbound.value.get(path) ?? [])].sort()
  }

  /** Deterministic structural lint over the cached page graph (no file reads).
   *  The file list comes from the live tree, not the page cache, so a source
   *  added or moved since the last content read is judged against what is on
   *  disk now. */
  function lintReport(): LintReport {
    return computeLint(pages.value, useFilesStore().allFiles, sourceMtimes.value)
  }

  /** KB path → OKF `type`, for pages that declare one. Feeds the file-tree
   *  chips, graph node coloring, and the search palette's `type:` filter. */
  const types = computed(() => {
    const map = new Map<string, string>()
    for (const [path, page] of pages.value) if (page.type) map.set(path, page.type)
    return map
  })

  const graph = computed(() => {
    const nodes = [...pages.value.keys()]
    const links: { source: string; target: string }[] = []
    for (const [path, page] of pages.value) {
      for (const target of new Set(page.outgoing)) {
        if (target !== path && pages.value.has(target)) {
          links.push({ source: path, target })
        }
      }
    }
    return { nodes, links }
  })

  const health = computed<HealthReport>(() => {
    // Scope reporting to what is not ignored; the link graph itself stays global
    // so an in-scope page linked only from an ignored one isn't a false orphan.
    const ignore = useSettingsStore().state.healthIgnore
    const brokenLinks: HealthReport['brokenLinks'] = []
    for (const [path, page] of pages.value) {
      if (isIgnored(path, ignore)) continue
      if (page.broken.length) brokenLinks.push({ path, targets: [...new Set(page.broken)] })
    }
    const orphans: string[] = []
    for (const path of pages.value.keys()) {
      if (isIgnored(path, ignore)) continue
      // Index/log pages are entry points, not orphans.
      const stem = path.toLowerCase()
      if (stem.endsWith('/index.md') || stem === 'index.md' || stem.endsWith('/log.md')) continue
      const page = pages.value.get(path)!
      if (!inbound.value.has(path) && !page.outgoing.length) orphans.push(path)
    }
    brokenLinks.sort((a, b) => a.path.localeCompare(b.path))
    orphans.sort()
    return { brokenLinks, orphans }
  })

  /** Filename search over every file, full-text over markdown, and full-text
   *  over indexed PDF/EPUB sections (hits carry the block id to jump to).
   *
   *  Filenames match fuzzily and come back ranked — a path is a name someone is
   *  recalling, so `wkchn` should find `wiki/chain-of-thought.md`. Content is
   *  matched as a plain substring: the query is a phrase the text either
   *  contains or does not, and fuzzy-matching whole lines only invents noise. */
  function search(query: string): { files: FileMatch[]; hits: SearchHit[] } {
    const q = query.trim()
    if (!q) return { files: [], hits: [] }
    // Each word must appear, in any order — a line matches "emergent model"
    // when it contains both, which is what someone typing two words means.
    const terms = queryTerms(q)
    const filesStore = useFilesStore()

    const files = fuzzyRank(q, filesStore.allFiles, (p) => p).map(
      (r): FileMatch => ({ path: r.item, positions: r.positions }),
    )

    const hits: SearchHit[] = []
    for (const [path, page] of pages.value) {
      if (hits.length >= MAX_HITS) break
      const lines = page.content.split('\n')
      for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) {
        if (hasAllTerms(lines[i], terms)) {
          hits.push({ path, line: i + 1, text: excerptAround(lines[i], terms) })
        }
      }
    }

    const docHits: SearchHit[] = []
    for (const section of docSections.value.values()) {
      if (docHits.length >= MAX_HITS) break
      const lines = section.content.split('\n')
      for (let i = 0; i < lines.length && docHits.length < MAX_HITS; i++) {
        if (hasAllTerms(lines[i], terms)) {
          const blockId = lines[i].match(/\[\[(b\d+-\d+)\]\]/)?.[1] ?? null
          const text = lines[i].replace(/\[\[b\d+-\d+\]\]\s*/g, '').replace(/^#+\s*/, '')
          docHits.push({
            path: section.source,
            line: i + 1,
            text: excerptAround(text, terms),
            doc: true,
            blockId,
          })
        }
      }
    }

    return { files, hits: [...hits, ...docHits] }
  }

  /** Source documents whose index contains the given block tag — the click-
   *  time fallback for citation chips that carry no resolved source path.
   *  Block ids are per-document, so several docs can legitimately match. */
  function findBlockSources(blockId: string): string[] {
    const tag = `[[${blockId}]]`
    const out = new Set<string>()
    for (const section of docSections.value.values()) {
      if (section.content.includes(tag)) out.add(section.source)
    }
    return [...out]
  }

  function reset(): void {
    pages.value = new Map()
    docSections.value = new Map()
    sourceMtimes.value = new Map()
  }

  return { pages, refreshing, refresh, backlinks, lintReport, types, graph, health, search, findBlockSources, reset }
})
