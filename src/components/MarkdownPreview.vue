<script setup lang="ts">
import { computed } from 'vue'
import { useFilesStore } from '@/stores/files'
import { renderMarkdown } from '@/lib/markdown'

const files = useFilesStore()

const html = computed(() =>
  renderMarkdown(files.content, { resolve: (t) => files.resolveWikilink(t) }),
)

async function onClick(e: MouseEvent): Promise<void> {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
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
  // External links open in a new tab; relative links are ignored for now.
  const href = a.getAttribute('href') ?? ''
  if (/^https?:\/\//.test(href)) {
    e.preventDefault()
    window.open(href, '_blank', 'noopener')
  } else {
    e.preventDefault()
  }
}
</script>

<template>
  <div class="h-full panel-scroll">
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="md-preview max-w-3xl mx-auto px-8 py-6" v-html="html" @click="onClick" />
  </div>
</template>
