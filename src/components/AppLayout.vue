<script setup lang="ts">
import { computed } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useThemeStore } from '@/stores/theme'
import FileTree from '@/components/FileTree.vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import MarkdownPreview from '@/components/MarkdownPreview.vue'
import { baseName } from '@/lib/wiki'

const kb = useKbStore()
const files = useFilesStore()
const theme = useThemeStore()

const fileName = computed(() => (files.currentPath ? baseName(files.currentPath) : null))
const isMarkdown = computed(() => files.currentPath?.endsWith('.md') ?? false)

const saveLabel = computed(
  () => ({ saved: 'Saved', dirty: 'Unsaved', saving: 'Saving…' })[files.saveState],
)

const themeIcon = computed(
  () =>
    ({ system: 'codicon-color-mode', light: 'codicon-sun', dark: 'codicon-moon' })[theme.pref],
)

function closeKb(): void {
  void files.flush().finally(() => {
    files.reset()
    kb.close()
  })
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Title bar -->
    <header class="flex items-center gap-2 px-3 h-10 border-b border-border bg-bg-1 shrink-0">
      <span class="codicon codicon-book text-accent" />
      <span class="font-semibold text-fg-0">{{ kb.name }}</span>
      <span class="text-fg-3 text-xs" v-if="fileName">/ {{ fileName }}</span>
      <span class="flex-1" />
      <span class="text-xs" :class="files.saveState === 'saved' ? 'text-fg-3' : 'text-accent'">
        {{ saveLabel }}
      </span>
      <button
        v-if="isMarkdown"
        class="btn text-xs"
        @click="files.mode = files.mode === 'edit' ? 'preview' : 'edit'"
      >
        <span
          class="codicon codicon-sm mr-1"
          :class="files.mode === 'edit' ? 'codicon-open-preview' : 'codicon-edit'"
        />
        {{ files.mode === 'edit' ? 'Preview' : 'Edit' }}
      </button>
      <button class="btn text-xs" :title="`Theme: ${theme.pref}`" @click="theme.cycle()">
        <span class="codicon codicon-sm" :class="themeIcon" />
      </button>
      <button class="btn text-xs" title="Close folder" @click="closeKb">
        <span class="codicon codicon-sm codicon-close" />
      </button>
    </header>

    <div class="flex-1 flex min-h-0">
      <!-- Sidebar -->
      <aside class="w-64 shrink-0 border-r border-border bg-bg-1 panel-scroll">
        <FileTree />
      </aside>

      <!-- Main content -->
      <main class="flex-1 min-w-0 bg-bg-0">
        <template v-if="files.currentPath">
          <MarkdownEditor v-if="files.mode === 'edit' && isMarkdown" />
          <MarkdownPreview v-else-if="isMarkdown" />
          <MarkdownEditor v-else />
        </template>
        <div v-else class="h-full flex items-center justify-center text-fg-3">
          <div class="text-center">
            <span class="codicon codicon-lg codicon-markdown block mb-2" />
            Select a file to start
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
