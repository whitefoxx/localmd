<script setup lang="ts">
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { renderMarkdown } from '@/lib/markdown'
import { splitFrontmatter } from '@/lib/wiki'
import { enumerateMarkdownBlocks } from '@/lib/docindex/md/parse'

const files = useFilesStore()
const citations = useCitationsStore()

const root = ref<HTMLElement | null>(null)

const html = computed(() =>
  renderMarkdown(files.content, { resolve: (t) => files.resolveWikilink(t) }),
)

async function onClick(e: MouseEvent): Promise<void> {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  // Citation tokens: [[N:blockid]] chips and [[pdfN:path]] source links.
  if (a.classList.contains('citation') || a.classList.contains('cite-source')) {
    e.preventDefault()
    const path = a.dataset.citePath
    if (path) await citations.openCitation(path, a.dataset.block ?? null)
    return
  }
  const wikilink = a.classList.contains('wikilink')
  if (wikilink) {
    e.preventDefault()
    if (a.dataset.resolved === '1' && a.dataset.target) {
      await files.openFile(a.dataset.target)
    } else if (a.dataset.target) {
      // Broken link: create the page under wiki/ and open it in edit mode.
      const target = a.dataset.target
      if (confirm(`Page “${target}” does not exist. Create it under wiki/?`)) {
        await files.createFile(`wiki/${target}.md`, `# ${target}\n\n`)
      }
    }
    return
  }
  e.preventDefault()
  const href = a.getAttribute('href') ?? ''
  if (/^https?:\/\//.test(href)) {
    window.open(href, '_blank', 'noopener')
    return
  }
  // Relative markdown links ([label](wiki/entities/foo.md)) open the KB file.
  const rel = files.resolveRelativeLink(href)
  if (rel) await files.openFile(rel)
}

/**
 * Citation jump into a markdown source: block ids map to the nth top-level
 * rendered element (the indexer and this preview enumerate the same marked
 * lexer tokens, so the counts agree).
 */
async function maybeJump(): Promise<void> {
  const pend = citations.pending
  if (!pend || pend.path !== files.currentPath) return
  if (pend.blockId && root.value) {
    await nextTick()
    const { body } = splitFrontmatter(files.content)
    const blocks = enumerateMarkdownBlocks(body)
    const idx = blocks.findIndex((b) => b.id === pend.blockId)
    const el = idx >= 0 ? (root.value.children[idx] as HTMLElement | undefined) : undefined
    if (el) {
      el.scrollIntoView({ block: 'center' })
      el.classList.add('cite-target')
      setTimeout(() => el.classList.remove('cite-target'), 2500)
    }
  }
  citations.clear()
}

onMounted(() => void maybeJump())
watch(
  () => citations.pending,
  () => void maybeJump(),
)
</script>

<template>
  <div class="h-full panel-scroll">
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div ref="root" class="md-preview max-w-3xl mx-auto px-8 py-6" v-html="html" @click="onClick" />
  </div>
</template>
