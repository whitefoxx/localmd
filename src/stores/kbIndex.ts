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
import { useFilesStore } from '@/stores/files'

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

export interface HealthReport {
  brokenLinks: { path: string; targets: string[] }[]
  orphans: string[]
}

const MAX_HITS = 100

export const useKbIndexStore = defineStore('kbIndex', () => {
  const pages = ref<Map<string, CachedPage>>(new Map())
  const docSections = ref<Map<string, DocSection>>(new Map())
  const refreshing = ref(false)

  /** Bring the cache in sync with the tree: re-read changed files, drop deleted.
   *  Keeps the SAME Map reference when nothing changed, so downstream computeds
   *  (graph, health) don't re-emit and the graph view doesn't re-layout. */
  async function refresh(): Promise<void> {
    if (refreshing.value || !fs.hasRoot()) return
    refreshing.value = true
    try {
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
      await refreshDocSections()
    } finally {
      refreshing.value = false
    }
  }

  /** Cache the section files of every PDF/EPUB index, so book content is
   *  searchable and hits can jump to the passage via their block ids. */
  async function refreshDocSections(): Promise<void> {
    const next = new Map(docSections.value)
    const seen = new Set<string>()
    let changed = false
    for (const kind of ['pdf-index', 'epub-index']) {
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
    const brokenLinks: HealthReport['brokenLinks'] = []
    for (const [path, page] of pages.value) {
      if (page.broken.length) brokenLinks.push({ path, targets: [...new Set(page.broken)] })
    }
    const orphans: string[] = []
    for (const path of pages.value.keys()) {
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
   *  over indexed PDF/EPUB sections (hits carry the block id to jump to). */
  function search(query: string): { files: string[]; hits: SearchHit[] } {
    const q = query.trim().toLowerCase()
    if (!q) return { files: [], hits: [] }
    const filesStore = useFilesStore()

    const files = filesStore.allFiles.filter((p) => p.toLowerCase().includes(q)).sort()

    const hits: SearchHit[] = []
    for (const [path, page] of pages.value) {
      if (hits.length >= MAX_HITS) break
      const lines = page.content.split('\n')
      for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          hits.push({ path, line: i + 1, text: lines[i].trim().slice(0, 160) })
        }
      }
    }

    const docHits: SearchHit[] = []
    for (const section of docSections.value.values()) {
      if (docHits.length >= MAX_HITS) break
      const lines = section.content.split('\n')
      for (let i = 0; i < lines.length && docHits.length < MAX_HITS; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          const blockId = lines[i].match(/\[\[(b\d+-\d+)\]\]/)?.[1] ?? null
          const text = lines[i].replace(/\[\[b\d+-\d+\]\]\s*/g, '').replace(/^#+\s*/, '')
          docHits.push({
            path: section.source,
            line: i + 1,
            text: text.trim().slice(0, 160),
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
  }

  return { pages, refreshing, refresh, backlinks, types, graph, health, search, findBlockSources, reset }
})
