/**
 * KB-wide content index: an mtime-keyed cache of every markdown file's text
 * plus the wikilink graph derived from it. One index feeds search, backlinks,
 * the graph view, and health checks (the browser counterpart of trace-app's
 * main-process page-cache.ts).
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as fs from '@/lib/fs'
import { parseWikilinks } from '@/lib/wiki'
import { useFilesStore } from '@/stores/files'

interface CachedPage {
  mtime: number
  content: string
  /** Resolved KB paths of outgoing wikilinks. */
  outgoing: string[]
  /** Wikilink targets that resolve to no file. */
  broken: string[]
}

export interface SearchHit {
  path: string
  line: number
  text: string
}

export interface HealthReport {
  brokenLinks: { path: string; targets: string[] }[]
  orphans: string[]
}

const MAX_HITS = 100

export const useKbIndexStore = defineStore('kbIndex', () => {
  const pages = ref<Map<string, CachedPage>>(new Map())
  const refreshing = ref(false)

  /** Bring the cache in sync with the tree: re-read changed files, drop deleted. */
  async function refresh(): Promise<void> {
    if (refreshing.value || !fs.hasRoot()) return
    refreshing.value = true
    try {
      const files = useFilesStore()
      const mdPaths = new Set(files.mdFiles)
      const next = new Map(pages.value)

      for (const cached of next.keys()) {
        if (!mdPaths.has(cached)) next.delete(cached)
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
        next.set(path, { mtime, content, outgoing, broken })
      }
      pages.value = next
    } finally {
      refreshing.value = false
    }
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

  /** Filename + full-text search over the cached contents. */
  function search(query: string): { files: string[]; hits: SearchHit[] } {
    const q = query.trim().toLowerCase()
    if (!q) return { files: [], hits: [] }
    const files: string[] = []
    const hits: SearchHit[] = []
    for (const [path, page] of pages.value) {
      if (path.toLowerCase().includes(q)) files.push(path)
      if (hits.length >= MAX_HITS) continue
      const lines = page.content.split('\n')
      for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          hits.push({ path, line: i + 1, text: lines[i].trim().slice(0, 160) })
        }
      }
    }
    files.sort()
    return { files, hits }
  }

  function reset(): void {
    pages.value = new Map()
  }

  return { pages, refreshing, refresh, backlinks, graph, health, search, reset }
})
