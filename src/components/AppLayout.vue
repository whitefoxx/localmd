<script setup lang="ts">
import { ref, computed } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useThemeStore } from '@/stores/theme'
import { useReviewStore } from '@/stores/review'
import { useGitStore } from '@/stores/git'
import { useUiStore } from '@/stores/ui'
import { useKbIndexStore } from '@/stores/kbIndex'
import FileTree from '@/components/FileTree.vue'
import EditorTabs from '@/components/EditorTabs.vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import MarkdownPreview from '@/components/MarkdownPreview.vue'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import ReviewPanel from '@/components/review/ReviewPanel.vue'
import GitPanel from '@/components/GitPanel.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import SearchPalette from '@/components/SearchPalette.vue'
import GraphView from '@/components/GraphView.vue'
import HealthPanel from '@/components/HealthPanel.vue'
import BacklinksPanel from '@/components/BacklinksPanel.vue'
import ImageViewer from '@/components/viewers/ImageViewer.vue'
import PdfViewer from '@/components/viewers/PdfViewer.vue'
import EpubViewer from '@/components/viewers/EpubViewer.vue'
import { captureFiles } from '@/lib/capture'
import { scaffoldKb } from '@/lib/scaffold'
import { useSkillsStore } from '@/stores/skillsStore'
import { baseName } from '@/lib/wiki'
import { fileKind } from '@/lib/filetypes'

const kb = useKbStore()
const files = useFilesStore()
const theme = useThemeStore()
const review = useReviewStore()
const git = useGitStore()
const ui = useUiStore()

function openGit(): void {
  git.panelOpen = true
  void git.refresh()
}
const kbIndex = useKbIndexStore()

const settingsOpen = ref(false)
const dragging = ref(false)

/* First-run scaffold offer for truly-empty folders. */
const scaffoldDismissed = ref(false)
const scaffolding = ref(false)
const showScaffold = computed(
  () => !scaffoldDismissed.value && files.allFiles.length === 0 && !files.currentPath,
)

async function doScaffold(): Promise<void> {
  scaffolding.value = true
  try {
    await scaffoldKb()
    await files.refreshTree()
    await useSkillsStore().refresh()
    await files.openFile('wiki/index.md')
  } finally {
    scaffolding.value = false
  }
}

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
      <button
        class="text-fg-3 hover:text-fg-0"
        :class="{ '!text-accent': ui.sidebarOpen }"
        title="Toggle sidebar (⌘B)"
        @click="ui.sidebarOpen = !ui.sidebarOpen"
      >
        <span class="codicon codicon-layout-sidebar-left" />
      </button>
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
        v-if="git.isRepo"
        class="btn text-xs"
        :title="`Git: ${git.branch ?? ''}${git.dirtyCount ? ` · ${git.dirtyCount} changed` : ''}`"
        @click="openGit"
      >
        <span class="codicon codicon-sm codicon-git-branch mr-1" />{{ git.branch
        }}<span v-if="git.dirtyCount" class="ml-1 text-accent">{{ git.dirtyCount }}</span>
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
        :class="{ '!text-accent': ui.agentOpen }"
        title="Toggle agent panel (⌘J)"
        @click="ui.agentOpen = !ui.agentOpen"
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

    <!-- Concurrent-tab warning -->
    <div
      v-if="kb.lockedByOther"
      class="flex items-center gap-2 px-3 py-1.5 text-xs shrink-0 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-b border-yellow-500/30"
    >
      <span class="codicon codicon-sm codicon-warning" />
      该知识库已在另一个标签页打开——两边同时编辑会互相覆盖(自动保存、git、标注)。建议只保留一个标签页操作。
    </div>

    <div class="flex-1 flex min-h-0">
      <!-- Sidebar -->
      <aside v-show="ui.sidebarOpen" class="w-64 shrink-0 border-r border-border bg-bg-1 flex flex-col">
        <div class="flex-1 panel-scroll">
          <FileTree />
        </div>
        <BacklinksPanel />
      </aside>

      <!-- Main content -->
      <main class="flex-1 min-w-0 bg-bg-0 flex flex-col">
        <GraphView v-if="ui.view === 'graph'" class="flex-1 min-h-0" />
        <template v-else>
          <EditorTabs />
          <div class="flex-1 min-h-0 relative">
            <!-- PDFs stay mounted per open tab (trace-app pattern) — switching
                 tabs only toggles visibility, never reloads the document. -->
            <PdfViewer v-show="kind === 'pdf'" class="absolute inset-0" />
            <template v-if="files.currentPath && kind !== 'pdf'">
              <MarkdownEditor v-if="isMarkdown && files.mode === 'edit'" />
              <MarkdownPreview v-else-if="isMarkdown" />
              <MarkdownEditor v-else-if="kind === 'text'" />
              <ImageViewer v-else-if="kind === 'image'" />
              <EpubViewer v-else-if="kind === 'epub'" />
              <div v-else class="h-full flex items-center justify-center text-fg-3">
                <div class="text-center">
                  <span class="codicon codicon-lg codicon-file-binary block mb-2" />
                  Binary file — no preview
                </div>
              </div>
            </template>
            <div
              v-else-if="!files.currentPath"
              class="h-full flex items-center justify-center text-fg-3"
            >
              <div v-if="showScaffold" class="text-center max-w-md px-6">
                <span class="codicon codicon-lg codicon-sparkle block mb-3 text-accent" />
                <div class="text-fg-1 font-medium mb-2">这个文件夹还是空的</div>
                <p class="text-xs leading-relaxed mb-4">
                  可以初始化为知识库:创建 raw/(源文件收集)、wiki/(LLM 维护的页面)、
                  AGENTS.md(约定)和 ingest / lint 两个起步技能。
                </p>
                <div class="flex gap-2 justify-center">
                  <button class="btn-primary text-xs" :disabled="scaffolding" @click="doScaffold">
                    <span class="codicon codicon-sm codicon-rocket mr-1" />初始化知识库
                  </button>
                  <button class="btn text-xs" @click="scaffoldDismissed = true">先不用</button>
                </div>
              </div>
              <div v-else class="text-center">
                <span class="codicon codicon-lg codicon-markdown block mb-2" />
                Select a file to start
              </div>
            </div>
          </div>
        </template>
      </main>

      <!-- Agent panel -->
      <aside v-show="ui.agentOpen" class="w-96 shrink-0 border-l border-border">
        <ChatPanel @open-settings="settingsOpen = true" />
      </aside>
    </div>

    <ReviewPanel />
    <GitPanel />
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
