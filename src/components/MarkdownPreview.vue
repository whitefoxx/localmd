<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { useKbIndexStore } from '@/stores/kbIndex'
import { inheritedCiteSources } from '@/lib/citations'
import { useCiteQuote } from '@/composables/useCiteQuote'
import { renderMarkdown } from '@/lib/markdown'
import { handleCodeCopy } from '@/lib/copyCode'
import { splitFrontmatter } from '@/lib/wiki'
import { enumerateMarkdownBlocks } from '@/lib/docindex/md/parse'
import { previewScroll } from '@/lib/viewMemory'
import { useTtsHighlight } from '@/composables/useTtsHighlight'
import { useKbImages } from '@/composables/useKbImages'
import { t } from '@/i18n'

const files = useFilesStore()
const citations = useCitationsStore()
const kbIndex = useKbIndexStore()
/** A wiki page's citation chips carry their quote in the tooltip too — the
 *  chips are the same markup, distilled out of the reply that made them. */
const quoteOnHover = useCiteQuote()

const root = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)

useTtsHighlight(root) // highlight-follow the sentence being read aloud

let shownPath: string | null = null

function saveScroll(): void {
  if (shownPath && scroller.value) previewScroll.set(shownPath, scroller.value.scrollTop)
}

async function restoreScroll(): Promise<void> {
  await nextTick()
  if (scroller.value) {
    scroller.value.scrollTop = files.currentPath ? (previewScroll.get(files.currentPath) ?? 0) : 0
  }
  shownPath = files.currentPath
}

watch(
  () => files.currentPath,
  () => {
    saveScroll()
    void restoreScroll()
  },
)
onMounted(() => void restoreScroll())
onBeforeUnmount(saveScroll)

/**
 * Declarations this page did not make itself, taken off the source pages it
 * links to (lib/citations). A page that links `[[wiki/sources/一本书]]` and
 * then cites `[[1:b10-62]]` is the convention knowledge bases grow into; read
 * strictly, that number names nothing and the chip is left to guess which
 * document it meant at click time. Merged UNDER the page's own declarations,
 * which always win.
 */
const inherited = computed(() =>
  inheritedCiteSources(
    files.content,
    (t) => files.resolveWikilink(t),
    (p) => kbIndex.pages.get(p)?.content ?? null,
  ),
)

const html = computed(() =>
  renderMarkdown(
    files.content,
    { resolve: (t) => files.resolveWikilink(t) },
    { citeSources: inherited.value },
  ),
)

// Pictures stored in the KB — the markdown renderer leaves them as
// data-kb-src because it cannot read files synchronously. Declared after
// `html` because the watcher reads it immediately.
useKbImages(
  root,
  () => html.value,
  (href) => files.resolveMarkdownLink(files.currentPath ?? '', href),
)

async function onClick(e: MouseEvent): Promise<void> {
  if (handleCodeCopy(e)) return
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  // Citation tokens: [[N:blockid]] chips and [[pdfN:path]] source links.
  if (a.classList.contains('citation') || a.classList.contains('cite-source')) {
    e.preventDefault()
    const path = a.dataset.citePath
    if (path) await citations.openCitation(path, a.dataset.block ?? null)
    else if (a.dataset.block) await citations.openByBlock(a.dataset.block)
    return
  }
  const wikilink = a.classList.contains('wikilink')
  if (wikilink) {
    e.preventDefault()
    if (a.dataset.resolved === '1' && a.dataset.target) {
      await files.openFile(a.dataset.target)
    } else if (a.dataset.target) {
      // Broken link: create the page and open it in edit mode. Path-style
      // targets ([[notes/foo]]) are explicit; bare names go under wiki/ when
      // the KB has one (the default layout), otherwise next to this file.
      const target = a.dataset.target
      const cur = files.currentPath ?? ''
      const dir = files.allFiles.some((p) => p.startsWith('wiki/'))
        ? 'wiki'
        : cur.includes('/')
          ? cur.slice(0, cur.lastIndexOf('/'))
          : ''
      const dest = target.includes('/') || !dir ? `${target}.md` : `${dir}/${target}.md`
      const title = target.split('/').pop() ?? target
      if (confirm(t('viewers.markdown.createPagePrompt', { target: dest }))) {
        await files.createFile(dest, `# ${title}\n\n`)
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
  // Standard markdown links open the KB file — resolved relative to THIS file's
  // directory (so ./ and ../ work), absolute /… against the KB (bundle) root.
  const rel = files.resolveMarkdownLink(files.currentPath ?? '', href)
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
  <div ref="scroller" class="h-full panel-scroll">
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div
      ref="root"
      class="md-preview max-w-3xl mx-auto px-8 py-6"
      v-html="html"
      @click="onClick"
      @mouseover="quoteOnHover"
    />
  </div>
</template>
