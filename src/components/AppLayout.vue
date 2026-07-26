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
import DocxViewer from '@/components/viewers/DocxViewer.vue'
import ArtifactViewer from '@/components/viewers/ArtifactViewer.vue'
import AnnotationsViewer from '@/components/viewers/AnnotationsViewer.vue'
import TextPreview from '@/components/viewers/TextPreview.vue'
import { isAnnotationsPath } from '@/lib/annotations'
import { captureFiles } from '@/lib/capture'
import { scaffoldKb } from '@/lib/scaffold'
import { useSkillsStore } from '@/stores/skillsStore'
import { fileKind, isProseText } from '@/lib/filetypes'
import { stripMarkdown } from '@/lib/tts'
import { useTtsStore } from '@/stores/tts'
import { baseName, splitFrontmatter } from '@/lib/wiki'
import { typeColor } from '@/lib/typeColor'
import type { RecentKb } from '@/lib/idb'
import { t } from '@/i18n'

/* Shared styling for the VS Code–style activity-bar buttons. */
const actBtn =
  'group relative w-10 h-10 flex items-center justify-center rounded-md text-fg-2 hover:text-fg-0 hover:bg-bg-2 transition-colors'

const kb = useKbStore()
const files = useFilesStore()
const tts = useTtsStore()
const theme = useThemeStore()
const review = useReviewStore()
const git = useGitStore()
const ui = useUiStore()

function openGit(): void {
  git.panelOpen = true
  void git.refresh()
}

/** True while dragging a panel edge — shows a full-window overlay so the mouse
 *  can't get captured by iframes (EPUB) and the drag stays smooth. */
const resizing = ref(false)

/** Shared drag loop for the panel edges. `apply` maps the pointer delta to a
 *  new width and clamps it. */
function startResize(getWidth: (dx: number) => number): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    const startX = e.clientX
    resizing.value = true
    function onMove(ev: MouseEvent): void {
      getWidth(ev.clientX - startX)
    }
    function onUp(): void {
      resizing.value = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
}

// Agent panel: left edge, dragging left widens it.
const startAgentResize = (e: MouseEvent): void => {
  const startW = ui.agentWidth
  startResize((dx) => (ui.agentWidth = Math.max(280, Math.min(startW - dx, window.innerWidth - 360))))(
    e,
  )
}
// Sidebar: right edge, dragging right widens it.
const startSidebarResize = (e: MouseEvent): void => {
  const startW = ui.sidebarWidth
  startResize((dx) => (ui.sidebarWidth = Math.max(180, Math.min(startW + dx, window.innerWidth - 480))))(
    e,
  )
}
const kbIndex = useKbIndexStore()

/** OKF `type` → color legend for the graph top bar: the distinct types present
 *  among graph nodes (each colored via typeColor, matching the node fills),
 *  plus whether any untyped node or the accent-colored current file is shown. */
const graphLegend = computed(() => {
  const present = new Map<string, string>()
  let hasUntyped = false
  for (const id of kbIndex.graph.nodes) {
    const t = kbIndex.types.get(id)
    if (t) present.set(t, typeColor(t))
    else hasUntyped = true
  }
  return {
    types: [...present.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    hasUntyped,
    hasCurrent: !!files.currentPath && kbIndex.graph.nodes.includes(files.currentPath),
  }
})

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

/** Only external OS-file drags raise the capture overlay — internal file-tree
 *  moves carry a custom type, not "Files". */
function onDragOver(e: DragEvent): void {
  dragging.value = !!e.dataTransfer?.types.includes('Files')
}

async function onDrop(e: DragEvent): Promise<void> {
  dragging.value = false
  const dropped = [...(e.dataTransfer?.files ?? [])]
  if (!dropped.length) return
  await captureFiles(dropped)
  await files.refreshTree()
  if (git.isRepo) void git.refresh() // new files show as U immediately
}

const kind = computed(() => (files.currentPath ? fileKind(files.currentPath) : null))
const isMarkdown = computed(() => kind.value === 'markdown')
// .txt gets a serif reading view with the same Edit/Preview toggle as markdown.
const isPlainText = computed(() => (files.currentPath ? isProseText(files.currentPath) : false))

/* Annotation sidecars (*.annotations.json) always render as the annotations
   page — no raw-JSON view in-app. */
const isAnnotations = computed(() => !!files.currentPath && isAnnotationsPath(files.currentPath))

/** Read aloud: the current text selection if there is one, else the whole
   markdown/plain-text file (markdown stripped to prose first). The button uses
   mousedown.prevent so pressing it doesn't collapse the selection. */
function readAloud(): void {
  const path = files.currentPath
  if (!path) return
  const sel = window.getSelection()?.toString().trim()
  if (sel) {
    tts.speak(sel, t('layout.selection'))
    return
  }
  const body = splitFrontmatter(files.content).body
  tts.speak(isMarkdown.value ? stripMarkdown(body) : body, baseName(path))
}

const saveLabel = computed(
  () =>
    ({ saved: t('common.saved'), dirty: t('common.unsaved'), saving: t('common.saving') })[
      files.saveState
    ],
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
  () =>
    `Git: ${git.branch ?? ''}${git.dirtyCount ? ` · ${t('layout.nChanged', { n: git.dirtyCount })}` : ''}`,
)

const themeLabel = computed(
  () =>
    t('layout.theme', {
      pref: { system: t('layout.themeSystem'), light: t('layout.themeLight'), dark: t('layout.themeDark') }[
        theme.pref
      ],
    }),
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

/** Flush the current KB, swap to another, then reload the tree. A cancelled
 *  picker leaves the current KB intact. Opening a folder never writes to it —
 *  an empty one gets the scaffold offer below, which the user accepts or not. */
async function switchKb(pick: () => Promise<boolean>): Promise<void> {
  kbMenuOpen.value = false
  await files.flush()
  if (!(await pick())) return
  files.reset()
  kbIndex.reset()
  scaffoldDismissed.value = false // a "not now" applied to the folder we just left
  await files.refreshTree()
  await files.restoreTabs()
}

function openFolder(): void {
  void switchKb(() => kb.pickAndOpen())
}
/** Same picker as Open Folder — "new" is the user's intent, not a different
 *  action: an empty folder is offered the starter layout once it's open. */
function newKb(): void {
  void switchKb(() => kb.pickAndOpen())
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
    @dragover.prevent="onDragOver"
    @dragleave.self="dragging = false"
    @drop.prevent="onDrop"
  >
    <!-- Concurrent-tab warning -->
    <div
      v-if="kb.lockedByOther"
      class="flex items-center gap-2 px-3 py-1.5 text-xs shrink-0 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-b border-yellow-500/30"
    >
      <span class="codicon codicon-sm codicon-warning" />
      {{ $t('layout.concurrentWarning') }}
    </div>

    <div class="flex-1 flex min-h-0">
      <!-- Activity bar (VS Code style) -->
      <nav class="w-12 shrink-0 bg-bg-1 border-r border-border flex flex-col items-center py-2 gap-1">
        <!-- Top group -->
        <button :class="actBtn" :title="$t('layout.toggleSidebar')" @click="ui.sidebarOpen = !ui.sidebarOpen">
          <span
            v-if="ui.sidebarOpen"
            class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent"
          />
          <span class="codicon codicon-files" :class="{ 'text-accent': ui.sidebarOpen }" />
        </button>
        <button :class="actBtn" :title="$t('layout.search')" @click="ui.searchOpen = true">
          <span class="codicon codicon-search" />
        </button>
        <button :class="actBtn" :title="$t('layout.graphView')" @click="ui.graphOpen = !ui.graphOpen">
          <span
            v-if="ui.graphOpen"
            class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent"
          />
          <span class="codicon codicon-type-hierarchy-sub" :class="{ 'text-accent': ui.graphOpen }" />
        </button>
        <button v-if="git.isRepo" :class="actBtn" :title="gitTitle" @click="openGit">
          <span
            v-if="git.panelOpen"
            class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent"
          />
          <span class="codicon codicon-git-pull-request" :class="{ 'text-accent': git.panelOpen }" />
          <!-- Top-right corner: spinner while git is working (e.g. fetching
               status), otherwise the count of changed files. -->
          <span
            v-if="git.busy"
            class="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-accent text-white"
          >
            <span class="codicon codicon-loading codicon-modifier-spin text-[10px]" />
          </span>
          <span
            v-else-if="git.dirtyCount"
            class="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] leading-4 text-center font-medium"
          >{{ git.dirtyCount }}</span>
        </button>
        <button :class="actBtn" :title="$t('layout.kbHealth')" @click="ui.healthOpen = true">
          <span class="codicon codicon-pulse" />
        </button>
        <button
          v-if="review.count"
          :class="actBtn"
          :title="$t('layout.reviewChanges')"
          @click="review.panelOpen = true"
        >
          <span class="codicon codicon-diff text-accent" />
          <span
            class="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] leading-4 text-center font-medium"
          >{{ review.count }}</span>
        </button>

        <span class="flex-1" />

        <!-- Bottom group -->
        <button :class="actBtn" :title="$t('common.settings')" @click="ui.settingsOpen = true">
          <span class="codicon codicon-settings-gear" :class="{ 'text-accent': ui.settingsOpen }" />
        </button>
        <button :class="actBtn" :title="themeLabel" @click="theme.cycle()">
          <span class="codicon" :class="themeIcon" />
        </button>
        <button :class="actBtn" :title="$t('layout.closeFolder')" @click="closeKb">
          <span class="codicon codicon-close" />
        </button>
      </nav>

      <!-- Sidebar (right edge is a drag handle to resize) -->
      <aside
        v-show="ui.sidebarOpen"
        class="shrink-0 border-r border-border bg-bg-1 flex flex-col relative"
        :style="{ width: `${ui.sidebarWidth}px` }"
      >
        <div
          class="absolute right-0 top-0 bottom-0 w-1 -mr-0.5 z-20 cursor-col-resize hover:bg-accent/40"
          :title="$t('layout.dragResize')"
          @mousedown.prevent="startSidebarResize"
        />
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
              <span class="codicon codicon-sm codicon-folder-opened text-fg-3" />{{ $t('layout.openFolder') }}
            </button>
            <div class="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-fg-3">
              {{ $t('layout.openRecent') }}
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
        <!-- scroll-pt-7 keeps scrollIntoView from parking a row under the
             tree's sticky heading row -->
        <div class="flex-1 min-h-0 panel-scroll scroll-pt-7 flex flex-col">
          <FileTree class="flex-1" />
        </div>
        <BacklinksPanel />
      </aside>

      <!-- Main content (always mounted — the graph is an overlay above it) -->
      <main class="flex-1 min-w-0 bg-bg-0 flex flex-col">
        <EditorTabs v-if="ui.editorTabsVisible" />
        <!-- data-file-selection marks the open-file region: text selected here
             (and only here) is staged into the agent composer as context. -->
        <div class="flex-1 min-h-0 relative" data-file-selection>
            <!-- Editor actions (contextual: markdown + plain-text reading) -->
            <div
              v-if="(isMarkdown || isPlainText) && files.currentPath"
              class="absolute top-2 right-3 z-10 flex gap-1"
            >
              <button
                class="btn text-xs shadow-sm"
                :title="$t('layout.readAloud')"
                @mousedown.prevent
                @click="readAloud"
              >
                <span class="codicon codicon-sm codicon-unmute" />
              </button>
              <button
                class="btn text-xs shadow-sm"
                @click="files.mode = files.mode === 'edit' ? 'preview' : 'edit'"
              >
                <span
                  class="codicon codicon-sm mr-1"
                  :class="files.mode === 'edit' ? 'codicon-open-preview' : 'codicon-edit'"
                />
                {{ files.mode === 'edit' ? $t('common.preview') : $t('common.edit') }}
              </button>
            </div>

            <!-- PDFs stay mounted per open tab (trace-app pattern) — switching
                 tabs only toggles visibility, never reloads the document. -->
            <PdfViewer v-show="kind === 'pdf'" class="absolute inset-0" />
            <template v-if="files.currentPath && kind !== 'pdf'">
              <MarkdownEditor v-if="isMarkdown && files.mode === 'edit'" />
              <MarkdownPreview v-else-if="isMarkdown" />
              <AnnotationsViewer v-else-if="isAnnotations" />
              <TextPreview v-else-if="isPlainText && files.mode === 'preview'" />
              <MarkdownEditor v-else-if="kind === 'text'" />
              <ImageViewer v-else-if="kind === 'image'" />
              <EpubViewer v-else-if="kind === 'epub'" />
              <DocxViewer v-else-if="kind === 'docx'" />
              <ArtifactViewer v-else-if="kind === 'html'" />
              <div v-else class="h-full flex items-center justify-center text-fg-3">
                <div class="text-center">
                  <span class="codicon codicon-lg codicon-file-binary block mb-2" />
                  {{ $t('layout.binaryNoPreview') }}
                </div>
              </div>
            </template>
            <div
              v-else-if="!files.currentPath"
              class="h-full flex items-center justify-center text-fg-3"
            >
              <div v-if="showScaffold" class="text-center max-w-md px-6">
                <span class="codicon codicon-lg codicon-sparkle block mb-3 text-accent" />
                <div class="text-fg-1 font-medium mb-2">{{ $t('layout.emptyFolderTitle') }}</div>
                <p class="text-xs leading-relaxed mb-4">
                  {{ $t('layout.scaffoldDesc') }}
                </p>
                <div class="flex gap-2 justify-center">
                  <button class="btn-primary text-xs" :disabled="scaffolding" @click="doScaffold">
                    <span class="codicon codicon-sm codicon-rocket mr-1" />{{ $t('layout.scaffoldInit') }}
                  </button>
                  <button class="btn text-xs" @click="scaffoldDismissed = true">{{ $t('layout.scaffoldSkip') }}</button>
                </div>
              </div>
              <div v-else class="text-center">
                <span class="codicon codicon-lg codicon-markdown block mb-2" />
                {{ $t('layout.selectFile') }}
              </div>
            </div>
          </div>
      </main>

      <!-- Agent panel — docked on the right (left edge resizes), or maximized to
           fill the whole window as a z-40 overlay above the editor. The chat's
           own content is centered at a readable width in maximized mode. -->
      <aside
        v-show="ui.agentOpen"
        :class="
          ui.agentMaximized
            ? 'fixed inset-0 z-40 bg-bg-1'
            : 'relative shrink-0 border-l border-border'
        "
        :style="ui.agentMaximized ? undefined : { width: `${ui.agentWidth}px` }"
      >
        <div
          v-if="!ui.agentMaximized"
          class="absolute left-0 top-0 bottom-0 w-1 -ml-0.5 z-20 cursor-col-resize hover:bg-accent/40"
          :title="$t('layout.dragResize')"
          @mousedown.prevent="startAgentResize"
        />
        <ChatPanel @open-settings="ui.settingsOpen = true" @close="ui.agentOpen = false" />
      </aside>
    </div>

    <!-- Graph view: full-screen overlay so the editor (PDFs included) stays
         mounted underneath — closing it never reloads anything. -->
    <div v-if="ui.graphOpen" class="fixed inset-0 z-40 bg-bg-0 flex flex-col">
      <div class="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
        <span class="codicon codicon-type-hierarchy-sub text-accent shrink-0" />
        <span class="font-semibold text-fg-0 shrink-0">{{ $t('layout.graph') }}</span>
        <span class="text-xs text-fg-3 shrink-0">{{ $t('layout.graphHint') }}</span>
        <!-- type color legend: what each node color means -->
        <div class="flex items-center gap-3 overflow-x-auto min-w-0 flex-1 pl-2 text-xs">
          <span
            v-for="[t, color] in graphLegend.types"
            :key="t"
            class="flex items-center gap-1.5 shrink-0"
          >
            <span class="inline-block h-2.5 w-2.5 rounded-full" :style="{ background: color }" />
            <span class="text-fg-2 whitespace-nowrap">{{ t }}</span>
          </span>
          <span v-if="graphLegend.hasUntyped" class="flex items-center gap-1.5 shrink-0">
            <span
              class="inline-block h-2.5 w-2.5 rounded-full"
              style="background: rgb(var(--c-fg-3))"
            />
            <span class="text-fg-3 whitespace-nowrap">{{ $t('layout.untyped') }}</span>
          </span>
          <span v-if="graphLegend.hasCurrent" class="flex items-center gap-1.5 shrink-0">
            <span
              class="inline-block h-2.5 w-2.5 rounded-full"
              style="background: rgb(var(--c-accent))"
            />
            <span class="text-fg-3 whitespace-nowrap">{{ $t('layout.currentFile') }}</span>
          </span>
        </div>
        <button class="text-fg-3 hover:text-fg-0 shrink-0" :title="$t('layout.closeEsc')" @click="ui.graphOpen = false">
          <span class="codicon codicon-close" />
        </button>
      </div>
      <GraphView class="flex-1 min-h-0" />
    </div>

    <!-- Click-away layer for the KB switcher menu -->
    <div v-if="kbMenuOpen" class="fixed inset-0 z-40" @click="kbMenuOpen = false" />

    <!-- Floating agent button — opens the panel, hides while it is open -->
    <button
      v-if="!ui.agentOpen"
      class="absolute bottom-5 right-5 z-30 w-12 h-12 rounded-full bg-accent text-white shadow-lg shadow-black/25 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
      :title="$t('layout.openAgent')"
      @click="ui.agentOpen = true"
    >
      <span class="codicon codicon-lg codicon-sparkle" />
    </button>

    <ReviewPanel />
    <GitPanel />
    <SettingsModal :open="ui.settingsOpen" @close="ui.settingsOpen = false" />
    <SearchPalette />
    <HealthPanel />

    <!-- While resizing a panel, capture the pointer above all iframes -->
    <div v-if="resizing" class="fixed inset-0 z-50 cursor-col-resize" />

    <!-- Drop overlay -->
    <div
      v-if="dragging"
      class="absolute inset-0 z-40 bg-accent/10 border-4 border-dashed border-accent flex items-center justify-center pointer-events-none"
    >
      <div class="text-accent text-lg font-semibold">{{ $t('layout.dropToCapture') }}</div>
    </div>
  </div>
</template>
