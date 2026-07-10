<script setup lang="ts">
import { ref, computed } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useThemeStore } from '@/stores/theme'
import { useReviewStore } from '@/stores/review'
import { useUiStore } from '@/stores/ui'
import { useKbIndexStore } from '@/stores/kbIndex'
import FileTree from '@/components/FileTree.vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import MarkdownPreview from '@/components/MarkdownPreview.vue'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import ReviewPanel from '@/components/review/ReviewPanel.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import SearchPalette from '@/components/SearchPalette.vue'
import GraphView from '@/components/GraphView.vue'
import HealthPanel from '@/components/HealthPanel.vue'
import BacklinksPanel from '@/components/BacklinksPanel.vue'
import ImageViewer from '@/components/viewers/ImageViewer.vue'
import PdfViewer from '@/components/viewers/PdfViewer.vue'
import EpubViewer from '@/components/viewers/EpubViewer.vue'
import { captureFiles } from '@/lib/capture'
import { baseName } from '@/lib/wiki'
import { fileKind } from '@/lib/filetypes'

const kb = useKbStore()
const files = useFilesStore()
const theme = useThemeStore()
const review = useReviewStore()
const ui = useUiStore()
const kbIndex = useKbIndexStore()

const chatOpen = ref(true)
const settingsOpen = ref(false)
const dragging = ref(false)

async function onDrop(e: DragEvent): Promise<void> {
  dragging.value = false
  const dropped = [...(e.dataTransfer?.files ?? [])]
  if (!dropped.length) return
  await captureFiles(dropped)
  await files.refreshTree()
}

const fileName = computed(() => (files.currentPath ? baseName(files.currentPath) : null))
const kind = computed(() => (files.currentPath ? fileKind(files.currentPath) : null))
const isMarkdown = computed(() => kind.value === 'markdown')

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
    kbIndex.reset()
    kb.close()
  })
}
</script>

<template>
  <div
    class="h-full flex flex-col relative"
    @dragover.prevent="dragging = true"
    @dragleave.self="dragging = false"
    @drop.prevent="onDrop"
  >
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
        v-if="review.count"
        class="btn text-xs !border-accent !text-accent"
        title="Review agent changes"
        @click="review.panelOpen = true"
      >
        <span class="codicon codicon-sm codicon-diff mr-1" />{{ review.count }}
      </button>
      <button
        v-if="isMarkdown && ui.view === 'file'"
        class="btn text-xs"
        @click="files.mode = files.mode === 'edit' ? 'preview' : 'edit'"
      >
        <span
          class="codicon codicon-sm mr-1"
          :class="files.mode === 'edit' ? 'codicon-open-preview' : 'codicon-edit'"
        />
        {{ files.mode === 'edit' ? 'Preview' : 'Edit' }}
      </button>
      <button class="btn text-xs" title="Search (⌘K)" @click="ui.searchOpen = true">
        <span class="codicon codicon-sm codicon-search" />
      </button>
      <button
        class="btn text-xs"
        :class="{ '!text-accent': ui.view === 'graph' }"
        title="Graph view"
        @click="ui.view = ui.view === 'graph' ? 'file' : 'graph'"
      >
        <span class="codicon codicon-sm codicon-type-hierarchy-sub" />
      </button>
      <button class="btn text-xs" title="KB health" @click="ui.healthOpen = true">
        <span class="codicon codicon-sm codicon-pulse" />
      </button>
      <button
        class="btn text-xs"
        :class="{ '!text-accent': chatOpen }"
        title="Toggle agent panel"
        @click="chatOpen = !chatOpen"
      >
        <span class="codicon codicon-sm codicon-sparkle" />
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
      <aside class="w-64 shrink-0 border-r border-border bg-bg-1 flex flex-col">
        <div class="flex-1 panel-scroll">
          <FileTree />
        </div>
        <BacklinksPanel />
      </aside>

      <!-- Main content -->
      <main class="flex-1 min-w-0 bg-bg-0">
        <GraphView v-if="ui.view === 'graph'" />
        <template v-else-if="files.currentPath">
          <MarkdownEditor v-if="isMarkdown && files.mode === 'edit'" />
          <MarkdownPreview v-else-if="isMarkdown" />
          <MarkdownEditor v-else-if="kind === 'text'" />
          <ImageViewer v-else-if="kind === 'image'" />
          <PdfViewer v-else-if="kind === 'pdf'" />
          <EpubViewer v-else-if="kind === 'epub'" />
          <div v-else class="h-full flex items-center justify-center text-fg-3">
            <div class="text-center">
              <span class="codicon codicon-lg codicon-file-binary block mb-2" />
              Binary file — no preview
            </div>
          </div>
        </template>
        <div v-else class="h-full flex items-center justify-center text-fg-3">
          <div class="text-center">
            <span class="codicon codicon-lg codicon-markdown block mb-2" />
            Select a file to start
          </div>
        </div>
      </main>

      <!-- Agent panel -->
      <aside v-if="chatOpen" class="w-96 shrink-0 border-l border-border">
        <ChatPanel @open-settings="settingsOpen = true" />
      </aside>
    </div>

    <ReviewPanel />
    <SettingsModal :open="settingsOpen" @close="settingsOpen = false" />
    <SearchPalette />
    <HealthPanel />

    <!-- Drop overlay -->
    <div
      v-if="dragging"
      class="absolute inset-0 z-40 bg-accent/10 border-4 border-dashed border-accent flex items-center justify-center pointer-events-none"
    >
      <div class="text-accent text-lg font-semibold">Drop files to capture into raw/</div>
    </div>
  </div>
</template>
