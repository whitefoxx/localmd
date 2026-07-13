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
import OpenFilesPanel from '@/components/OpenFilesPanel.vue'
import ImageViewer from '@/components/viewers/ImageViewer.vue'
import PdfViewer from '@/components/viewers/PdfViewer.vue'
import EpubViewer from '@/components/viewers/EpubViewer.vue'
import { captureFiles } from '@/lib/capture'
import { scaffoldKb } from '@/lib/scaffold'
import { useSkillsStore } from '@/stores/skillsStore'
import { fileKind } from '@/lib/filetypes'
import type { RecentKb } from '@/lib/idb'

/* Shared styling for the VS Code–style activity-bar buttons. */
const actBtn =
  'group relative w-10 h-10 flex items-center justify-center rounded-md text-fg-2 hover:text-fg-0 hover:bg-bg-2 transition-colors'

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

/** True while dragging the agent panel edge — shows a full-window overlay so
 *  the mouse can't get captured by iframes (EPUB) and the drag stays smooth. */
const resizingAgent = ref(false)

/** Drag the agent panel's left edge to resize it (dragging left widens it). */
function startAgentResize(e: MouseEvent): void {
  const startX = e.clientX
  const startW = ui.agentWidth
  resizingAgent.value = true
  function onMove(ev: MouseEvent): void {
    const next = startW + (startX - ev.clientX)
    ui.agentWidth = Math.max(280, Math.min(next, window.innerWidth - 360))
  }
  function onUp(): void {
    resizingAgent.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.userSelect = ''
  }
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
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

const kind = computed(() => (files.currentPath ? fileKind(files.currentPath) : null))
const isMarkdown = computed(() => kind.value === 'markdown')

const saveLabel = computed(
  () => ({ saved: 'Saved', dirty: 'Unsaved', saving: 'Saving…' })[files.saveState],
)

/* Save state shown as a colored dot in the sidebar header (label = tooltip):
   green = saved, yellow = pending write. */
const saveDisplay = computed(
  () =>
    ({
      saved: { icon: 'codicon-circle-filled', class: 'text-added' },
      dirty: { icon: 'codicon-circle-filled', class: 'text-yellow-500' },
      saving: { icon: 'codicon-circle-filled', class: 'text-yellow-500 animate-pulse' },
    })[files.saveState],
)

const gitTitle = computed(
  () => `Git: ${git.branch ?? ''}${git.dirtyCount ? ` · ${git.dirtyCount} changed` : ''}`,
)

/* codicons 0.0.45 has no sun/moon glyphs — use ones that actually render. */
const themeIcon = computed(
  () =>
    ({ system: 'codicon-device-desktop', light: 'codicon-lightbulb', dark: 'codicon-color-mode' })[
      theme.pref
    ],
)

/* ── KB switcher menu (sidebar header dropdown) ─────────────────────────── */
const kbMenuOpen = ref(false)
const menuItem =
  'w-full flex items-center gap-2 px-3 py-1.5 text-left text-fg-1 hover:bg-bg-2 hover:text-fg-0'
const recentsOther = computed(() => kb.recents.filter((r) => r.name !== kb.name))

function toggleKbMenu(): void {
  kbMenuOpen.value = !kbMenuOpen.value
  if (kbMenuOpen.value) void kb.refreshRecents()
}

/** Flush the current KB, swap to another, then reload the tree (and optionally
 *  scaffold a brand-new one). A cancelled picker leaves the current KB intact. */
async function switchKb(pick: () => Promise<boolean>, scaffold = false): Promise<void> {
  kbMenuOpen.value = false
  await files.flush()
  if (!(await pick())) return
  files.reset()
  kbIndex.reset()
  if (scaffold) {
    await scaffoldKb()
    await files.refreshTree()
    await useSkillsStore().refresh()
    await files.openFile('wiki/index.md')
  } else {
    await files.refreshTree()
  }
}

function openFolder(): void {
  void switchKb(() => kb.pickAndOpen())
}
function newKb(): void {
  void switchKb(() => kb.pickAndOpen(), true)
}
function openRecentEntry(entry: RecentKb): void {
  void switchKb(() => kb.openRecent(entry))
}

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
    <!-- Concurrent-tab warning -->
    <div
      v-if="kb.lockedByOther"
      class="flex items-center gap-2 px-3 py-1.5 text-xs shrink-0 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-b border-yellow-500/30"
    >
      <span class="codicon codicon-sm codicon-warning" />
      该知识库已在另一个标签页打开——两边同时编辑会互相覆盖(自动保存、git、标注)。建议只保留一个标签页操作。
    </div>

    <div class="flex-1 flex min-h-0">
      <!-- Activity bar (VS Code style) -->
      <nav class="w-12 shrink-0 bg-bg-1 border-r border-border flex flex-col items-center py-2 gap-1">
        <!-- Top group -->
        <button :class="actBtn" title="Toggle sidebar (⌘B)" @click="ui.sidebarOpen = !ui.sidebarOpen">
          <span
            v-if="ui.sidebarOpen"
            class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent"
          />
          <span class="codicon codicon-files" :class="{ 'text-accent': ui.sidebarOpen }" />
        </button>
        <button :class="actBtn" title="Search (⌘K)" @click="ui.searchOpen = true">
          <span class="codicon codicon-search" />
        </button>
        <button
          :class="actBtn"
          title="Graph view"
          @click="ui.view = ui.view === 'graph' ? 'file' : 'graph'"
        >
          <span
            v-if="ui.view === 'graph'"
            class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent"
          />
          <span class="codicon codicon-type-hierarchy-sub" :class="{ 'text-accent': ui.view === 'graph' }" />
        </button>
        <button v-if="git.isRepo" :class="actBtn" :title="gitTitle" @click="openGit">
          <span
            v-if="git.panelOpen"
            class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent"
          />
          <span class="codicon codicon-git-branch" :class="{ 'text-accent': git.panelOpen }" />
          <span
            v-if="git.dirtyCount"
            class="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] leading-4 text-center font-medium"
          >{{ git.dirtyCount }}</span>
        </button>
        <button :class="actBtn" title="KB health" @click="ui.healthOpen = true">
          <span class="codicon codicon-pulse" />
        </button>
        <button
          v-if="review.count"
          :class="actBtn"
          title="Review agent changes"
          @click="review.panelOpen = true"
        >
          <span class="codicon codicon-diff text-accent" />
          <span
            class="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] leading-4 text-center font-medium"
          >{{ review.count }}</span>
        </button>

        <span class="flex-1" />

        <!-- Bottom group -->
        <button :class="actBtn" title="Settings" @click="settingsOpen = true">
          <span class="codicon codicon-settings-gear" :class="{ 'text-accent': settingsOpen }" />
        </button>
        <button :class="actBtn" :title="`Theme: ${theme.pref}`" @click="theme.cycle()">
          <span class="codicon" :class="themeIcon" />
        </button>
        <button :class="actBtn" title="Close folder" @click="closeKb">
          <span class="codicon codicon-close" />
        </button>
      </nav>

      <!-- Sidebar -->
      <aside v-show="ui.sidebarOpen" class="w-64 shrink-0 border-r border-border bg-bg-1 flex flex-col">
        <!-- KB switcher header (h-9 matches the editor tab bar / agent header) -->
        <div class="relative shrink-0 h-9 border-b border-border">
          <button
            class="flex items-center gap-1.5 w-full px-3 h-full text-left hover:bg-bg-2 transition-colors"
            :title="kb.name ?? ''"
            @click="toggleKbMenu"
          >
            <span class="codicon codicon-sm codicon-book text-accent shrink-0" />
            <span class="font-semibold text-fg-0 text-sm truncate">{{ kb.name }}</span>
            <span
              class="codicon codicon-sm codicon-chevron-down text-fg-3 shrink-0 transition-transform"
              :class="{ 'rotate-180': kbMenuOpen }"
            />
            <span class="flex-1" />
            <span
              class="codicon codicon-sm shrink-0"
              :class="[saveDisplay.icon, saveDisplay.class]"
              :title="saveLabel"
            />
          </button>

          <!-- Dropdown -->
          <div
            v-if="kbMenuOpen"
            class="absolute left-2 right-2 top-full mt-1 z-50 rounded-md border border-border bg-bg-1 shadow-lg py-1 text-sm"
          >
            <button :class="menuItem" @click="openFolder">
              <span class="codicon codicon-sm codicon-folder-opened text-fg-3" />Open Folder…
            </button>
            <div class="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-fg-3">
              Open Recent
            </div>
            <button
              v-for="r in recentsOther"
              :key="r.name"
              :class="menuItem"
              @click="openRecentEntry(r)"
            >
              <span class="codicon codicon-sm codicon-folder text-fg-3 shrink-0" />
              <span class="truncate">{{ r.name }}</span>
            </button>
            <div v-if="!recentsOther.length" class="px-3 py-1 text-xs text-fg-3">
              No other folders
            </div>
            <div class="border-t border-border my-1" />
            <button :class="menuItem" @click="newKb">
              <span class="codicon codicon-sm codicon-add text-fg-3" />New KB…
            </button>
          </div>
        </div>

        <OpenFilesPanel />
        <div class="flex-1 panel-scroll flex flex-col">
          <FileTree class="flex-1" />
        </div>
        <BacklinksPanel />
      </aside>

      <!-- Main content -->
      <main class="flex-1 min-w-0 bg-bg-0 flex flex-col">
        <GraphView v-if="ui.view === 'graph'" class="flex-1 min-h-0" />
        <template v-else>
          <EditorTabs v-if="ui.editorTabsVisible" />
          <div class="flex-1 min-h-0 relative">
            <!-- Editor actions (contextual, markdown only) -->
            <button
              v-if="isMarkdown && files.currentPath"
              class="btn text-xs absolute top-2 right-3 z-10 shadow-sm"
              @click="files.mode = files.mode === 'edit' ? 'preview' : 'edit'"
            >
              <span
                class="codicon codicon-sm mr-1"
                :class="files.mode === 'edit' ? 'codicon-open-preview' : 'codicon-edit'"
              />
              {{ files.mode === 'edit' ? 'Preview' : 'Edit' }}
            </button>

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

      <!-- Agent panel (left edge is a drag handle to resize) -->
      <aside
        v-show="ui.agentOpen"
        class="shrink-0 border-l border-border relative"
        :style="{ width: `${ui.agentWidth}px` }"
      >
        <div
          class="absolute left-0 top-0 bottom-0 w-1 -ml-0.5 z-20 cursor-col-resize hover:bg-accent/40"
          title="Drag to resize"
          @mousedown.prevent="startAgentResize"
        />
        <ChatPanel @open-settings="settingsOpen = true" @close="ui.agentOpen = false" />
      </aside>
    </div>

    <!-- Click-away layer for the KB switcher menu -->
    <div v-if="kbMenuOpen" class="fixed inset-0 z-40" @click="kbMenuOpen = false" />

    <!-- Floating agent button — opens the panel, hides while it is open -->
    <button
      v-if="!ui.agentOpen"
      class="absolute bottom-5 right-5 z-30 w-12 h-12 rounded-full bg-accent text-white shadow-lg shadow-black/25 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
      title="Open agent (⌘J)"
      @click="ui.agentOpen = true"
    >
      <span class="codicon codicon-lg codicon-sparkle" />
    </button>

    <ReviewPanel />
    <GitPanel />
    <SettingsModal :open="settingsOpen" @close="settingsOpen = false" />
    <SearchPalette />
    <HealthPanel />

    <!-- While resizing the agent panel, capture the pointer above all iframes -->
    <div v-if="resizingAgent" class="fixed inset-0 z-50 cursor-col-resize" />

    <!-- Drop overlay -->
    <div
      v-if="dragging"
      class="absolute inset-0 z-40 bg-accent/10 border-4 border-dashed border-accent flex items-center justify-center pointer-events-none"
    >
      <div class="text-accent text-lg font-semibold">Drop files to capture into raw/</div>
    </div>
  </div>
</template>
