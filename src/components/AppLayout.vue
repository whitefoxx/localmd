<script setup lang="ts">
import { ref, computed, defineAsyncComponent } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useThemeStore } from '@/stores/theme'
import { useReviewStore } from '@/stores/review'
import { useGitStore } from '@/stores/git'
import { useUiStore } from '@/stores/ui'
import { useKbIndexStore } from '@/stores/kbIndex'
import { useSettingsStore } from '@/stores/settings'
import { activeBindings, formatBinding, HOTKEY_BY_ID } from '@/lib/hotkeys'
import * as fs from '@/lib/fs'
import FileTree from '@/components/FileTree.vue'
import EditorTabs from '@/components/EditorTabs.vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import MarkdownPreview from '@/components/MarkdownPreview.vue'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import ReviewPanel from '@/components/review/ReviewPanel.vue'
import GitPanel from '@/components/GitPanel.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import SearchPalette from '@/components/SearchPalette.vue'
import CitationPicker from '@/components/CitationPicker.vue'
import GraphView from '@/components/GraphView.vue'
import HealthPanel from '@/components/HealthPanel.vue'
import HelpPanel from '@/components/HelpPanel.vue'
import BacklinksPanel from '@/components/BacklinksPanel.vue'
import OpenFilesPanel from '@/components/OpenFilesPanel.vue'
import ImageViewer from '@/components/viewers/ImageViewer.vue'
import PdfViewer from '@/components/viewers/PdfViewer.vue'
/**
 * The EPUB reader is loaded on demand, not because it is rarely used but
 * because of what it drags: epub.js is the one heavy third-party library a
 * viewer imports directly, and a static import put it in the main chunk, so
 * every visitor downloaded a book reader whether or not they ever opened a
 * book. (It is also why epub.js's deprecated `unload` listener showed up in
 * the console of people reading a PDF.)
 *
 * Safe here and NOT for `PdfViewer`, which is the asymmetry to keep in mind:
 * this one is already `v-else-if`-mounted, so making it async genuinely defers
 * the fetch. PdfViewer is rendered with `v-show` on purpose — it stays mounted
 * so switching to another file and back does not tear down and reload an open
 * document — and an async component under `v-show` would resolve on first
 * paint anyway, buying a second request and nothing else.
 *
 * The cost is a chunk fetch on the first EPUB open of a fresh visit; the
 * service worker precaches it, so it is once, and opening a book already
 * involves reading and parsing the file.
 */
const EpubViewer = defineAsyncComponent(() => import('@/components/viewers/EpubViewer.vue'))
import DocxViewer from '@/components/viewers/DocxViewer.vue'
import ArtifactViewer from '@/components/viewers/ArtifactViewer.vue'
import AnnotationsViewer from '@/components/viewers/AnnotationsViewer.vue'
import TextPreview from '@/components/viewers/TextPreview.vue'
import CsvPreview from '@/components/viewers/CsvPreview.vue'
import MediaViewer from '@/components/viewers/MediaViewer.vue'
import SheetViewer from '@/components/viewers/SheetViewer.vue'
import SlidesViewer from '@/components/viewers/SlidesViewer.vue'
import { isAnnotationsPath } from '@/lib/annotations'
import { captureFiles } from '@/lib/capture'
import { syncAfterFsChange } from '@/lib/fileOps'
import { scaffoldKb } from '@/lib/scaffold'
import { useSkillsStore } from '@/stores/skillsStore'
import { fileKind, isProseText, isTabular } from '@/lib/filetypes'
import { stripMarkdown, READ_ALOUD_ENABLED } from '@/lib/tts'
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
const settings = useSettingsStore()

/** The Search shortcut as currently bound — shown on the empty editor, where
 *  "open a file" is the only thing anyone is trying to do. */
const searchHotkey = computed(() =>
  formatBinding(activeBindings(HOTKEY_BY_ID.search, settings.state.hotkeys)[0]),
)

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
  files.noteCaptured(await captureFiles(dropped))
  await syncAfterFsChange() // tree + git status; new files show as U immediately
}

/** A name only guesses at a file's kind; the bytes decide (see lib/filetypes).
 *  When the read came back unreadable, every text-shaped view is off and the
 *  placeholder below explains why — one branch for both causes. */
const kind = computed(() => {
  if (!files.currentPath) return null
  return files.unreadable ? 'binary' : fileKind(files.currentPath)
})
const isMarkdown = computed(() => kind.value === 'markdown')
// .txt gets a serif reading view with the same Edit/Preview toggle as markdown.
const isPlainText = computed(
  () => !files.unreadable && !!files.currentPath && isProseText(files.currentPath),
)
// .csv/.tsv get a table view behind the same toggle.
const isTabularFile = computed(
  () => !files.unreadable && !!files.currentPath && isTabular(files.currentPath),
)

/** PDF and EPUB carry the zen toggle in their own toolbars; anything else needs
 *  the escape hatch below, or it would have no visible way back. */
const isReader = computed(() => kind.value === 'pdf' || kind.value === 'epub')

/** Whether the file view draws its own action row in the top-right corner
 *  (edit/preview, read-aloud). One computed rather than two copies of the
 *  condition: zen's exit button has to sit clear of that row, and the two
 *  drifting apart is exactly how they came to overlap. */
const hasEditorActions = computed(
  () => (isMarkdown.value || isPlainText.value || isTabularFile.value) && !!files.currentPath,
)

/**
 * Zen mode's peek: the cursor near the top of the page brings back the reader's
 * toolbar and the way out. Reading happens in the middle of the screen, so the
 * top strip is the one place a mouse only goes on purpose.
 *
 * The EPUB reader renders its chapters in an iframe, whose mousemoves never
 * reach this handler — it sets the same flag from inside (see EpubViewer).
 */
const PEEK_PX = 72
function onZenMove(e: MouseEvent): void {
  if (!ui.zen) return
  ui.zenPeek = e.clientY < PEEK_PX
}

/* Annotation sidecars (*.annotations.json) always render as the annotations
   page — no raw-JSON view in-app. */
const isAnnotations = computed(
  () => !files.unreadable && !!files.currentPath && isAnnotationsPath(files.currentPath),
)

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
// Which KB is open, not what the address says: opening a folder from inside the
// demo used to leave every demo affordance on screen (see kb.isDemo).
const isDemo = computed(() => kb.isDemo)
const saving = ref(false)
const saveError = ref('')

/**
 * Copy the demo into a folder the visitor picks, then carry on in that folder.
 * The demo's own tabs are reopened from the real copy, so the citation they
 * were just clicking still works — landing them in an empty window would make
 * saving feel like losing their place.
 */
async function saveDemo(): Promise<void> {
  saveError.value = ''
  const target = await fs.pickDirectory()
  if (!target) return
  saving.value = true
  try {
    const { saveDemoTo, TargetNotEmpty } = await import('@/lib/demo')
    const open = [...files.openTabs]
    const current = files.currentPath
    try {
      await saveDemoTo(target)
    } catch (err) {
      saveError.value =
        err instanceof TargetNotEmpty ? t('demo.saveNotEmpty') : t('demo.saveFailed')
      return
    }
    if (!(await kb.openHandle(target))) return
    await files.refreshTree()
    for (const path of open) await files.openFile(path)
    if (current) await files.openFile(current)
    kbMenuOpen.value = false
  } finally {
    saving.value = false
  }
}
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

    <!-- `relative` is the drawers' containing block: on a narrow screen the two
         side panels leave the flex row and lie over the document instead of
         squeezing it, which on a phone squeezed it to one word per line. -->
    <div class="flex-1 flex min-h-0 relative">
      <!-- Activity bar (VS Code style). Zen mode takes it, the tree, the tabs
           and the agent panel off screen — see ui.zen. -->
      <nav
        v-if="!ui.zen"
        class="w-12 shrink-0 bg-bg-1 border-r border-border flex flex-col items-center py-2 gap-1"
      >
        <!-- The mark, and only the mark: not a button, it goes nowhere. What a
             logo is worth in a workspace is the one line saying what this is,
             so that is what it carries — the same sentence the start screen
             opens with, never a second wording of it. -->
        <div
          class="mb-1 flex h-8 w-8 shrink-0 cursor-default select-none items-center justify-center"
          :title="$t('openKb.headline')"
        >
          <img src="/icon.svg" alt="localmd" class="h-[22px] w-[22px] rounded-[6px]" />
        </div>
        <div class="mb-1 h-px w-5 shrink-0 bg-border" />

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
        <!-- Agent changes already on disk, reviewable after the fact. An
             ask-first pause is not announced here — it is a card in the
             conversation that asked. -->
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
        <button :class="actBtn" :title="$t('help.title')" @click="ui.openHelp()">
          <span class="codicon codicon-question" :class="{ 'text-accent': ui.helpOpen }" />
        </button>
        <button :class="actBtn" :title="themeLabel" @click="theme.cycle()">
          <span class="codicon" :class="themeIcon" />
        </button>
        <button :class="actBtn" :title="$t('layout.closeFolder')" @click="closeKb">
          <span class="codicon codicon-close" />
        </button>
      </nav>

      <!-- The drawers' way out. Sits over the document but stops short of the
           activity bar, so the strip a drawer leaves showing is tappable and the
           icons beside it still work — reaching for a different panel stays one
           tap, not two. Below the drawers (z-30) and above everything else. -->
      <div
        v-if="ui.isNarrow && !ui.zen && !ui.agentMaximized && (ui.sidebarOpen || ui.agentOpen)"
        class="absolute inset-y-0 left-12 right-0 z-20 bg-black/40"
        @click="ui.closeDrawers()"
      />

      <!-- Sidebar (right edge is a drag handle to resize) -->
      <aside
        v-show="ui.sidebarOpen && !ui.zen"
        class="border-r border-border bg-bg-1 flex flex-col"
        :class="ui.isNarrow ? 'absolute left-12 top-0 bottom-0 z-30 shadow-2xl' : 'relative shrink-0'"
        :style="{ width: `${ui.shownSidebarWidth}px` }"
      >
        <!-- Dragging an edge is a pointer gesture; a drawer is sized for us. -->
        <div
          v-if="!ui.isNarrow"
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
            <!-- The demo lives in memory. Say so where the folder name is, not
                 in a dialog nobody rereads: the risk is not that it is a demo,
                 it is spending an hour in one without noticing. -->
            <span
              v-if="isDemo"
              class="shrink-0 px-1.5 py-px rounded text-[10px] uppercase tracking-wide bg-bg-3 text-fg-3"
              :title="$t('demo.badgeHint')"
            >
              {{ $t('demo.badge') }}
            </span>
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
              {{ $t('layout.noOtherFolders') }}
            </div>
            <div class="border-t border-border my-1" />
            <button :class="menuItem" @click="newKb">
              <span class="codicon codicon-sm codicon-add text-fg-3" />{{ $t('layout.newKb') }}
            </button>
            <!-- The demo's way out: without it, liking the demo means starting
                 over somewhere else. -->
            <button v-if="isDemo" :class="menuItem" :disabled="saving" @click="saveDemo">
              <span class="codicon codicon-sm codicon-save-as text-fg-3" />
              {{ saving ? $t('demo.saving') : $t('demo.save') }}
            </button>
            <div v-if="isDemo" class="px-3 pb-1.5 text-[11px] text-fg-3 leading-snug">
              {{ saveError || $t('demo.saveHint') }}
            </div>
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
      <main class="flex-1 min-w-0 bg-bg-0 flex flex-col relative" @mousemove="onZenMove">
        <!-- Zen's way out, drawn with the toolbar it hides beside. Always
             reachable in two moves — cursor to the top, click — because Esc and
             a shortcut are not discoverable from inside a bare page.
             It drops below the file view's own action row where there is one:
             both want the same top-right corner, and markdown/text/table views
             kept theirs in zen, so the two buttons sat on top of each other. -->
        <button
          v-if="ui.zen && !isReader"
          class="absolute right-3 z-30 w-7 h-7 rounded flex items-center justify-center bg-bg-1/90 border border-border text-fg-2 hover:text-fg-0 shadow transition-opacity duration-200"
          :class="[
            ui.zenPeek ? 'opacity-100' : 'opacity-0 pointer-events-none',
            hasEditorActions ? 'top-11' : 'top-2',
          ]"
          :title="$t('layout.leaveZen')"
          @click="ui.toggleZen()"
        >
          <span class="codicon codicon-chrome-restore" />
        </button>
        <EditorTabs v-if="ui.editorTabsVisible && !ui.zen" />
        <!-- data-file-selection marks the open-file region: text selected here
             (and only here) is staged into the agent composer as context. -->
        <div class="flex-1 min-h-0 relative" data-file-selection>
            <!-- Editor actions (contextual: markdown, plain-text, tables) -->
            <div
              v-if="hasEditorActions"
              class="absolute top-2 right-3 z-10 flex gap-1"
            >
              <button
                v-if="READ_ALOUD_ENABLED && (isMarkdown || isPlainText)"
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

            <!-- PDFs stay mounted per open tab — switching tabs only toggles
                 visibility, never reloads the document. -->
            <PdfViewer v-show="kind === 'pdf'" class="absolute inset-0" />
            <template v-if="files.currentPath && kind !== 'pdf'">
              <MarkdownEditor v-if="isMarkdown && files.mode === 'edit'" />
              <MarkdownPreview v-else-if="isMarkdown" />
              <AnnotationsViewer v-else-if="isAnnotations" />
              <TextPreview v-else-if="isPlainText && files.mode === 'preview'" />
              <CsvPreview v-else-if="isTabularFile && files.mode === 'preview'" />
              <MarkdownEditor v-else-if="kind === 'text'" />
              <ImageViewer v-else-if="kind === 'image'" />
              <MediaViewer v-else-if="kind === 'audio' || kind === 'video'" />
              <EpubViewer v-else-if="kind === 'epub'" />
              <DocxViewer v-else-if="kind === 'docx'" />
              <SheetViewer v-else-if="kind === 'sheet'" />
              <SlidesViewer v-else-if="kind === 'slides'" />
              <ArtifactViewer v-else-if="kind === 'html'" />
              <div v-else class="h-full flex items-center justify-center text-fg-3">
                <div class="text-center">
                  <span class="codicon codicon-lg codicon-file-binary block mb-2" />
                  {{
                    files.unreadable === 'too-large'
                      ? $t('layout.tooLargeNoPreview')
                      : $t('layout.binaryNoPreview')
                  }}
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
                <!-- Scaffolding writes a handful of files and then opens one,
                     which is long enough to look like nothing happened. Say so
                     on the button that was pressed. -->
                <div class="flex gap-2 justify-center">
                  <button class="btn-primary text-xs" :disabled="scaffolding" @click="doScaffold">
                    <span
                      class="codicon codicon-sm mr-1"
                      :class="scaffolding ? 'codicon-loading codicon-modifier-spin' : 'codicon-rocket'"
                    />{{ scaffolding ? $t('layout.scaffoldWorking') : $t('layout.scaffoldInit') }}
                  </button>
                  <button class="btn text-xs" :disabled="scaffolding" @click="scaffoldDismissed = true">
                    {{ $t('layout.scaffoldSkip') }}
                  </button>
                </div>
              </div>
              <!-- A flex column rather than a `block` on the icon: codicon.css
                   sets `display: inline-block` at a specificity a utility class
                   cannot reach, so the icon sat on the text's line instead of
                   above it, off by its own baseline nudge. -->
              <div v-else class="flex flex-col items-center gap-2 text-center">
                <span class="codicon codicon-lg codicon-markdown" />
                <div>{{ $t('layout.selectFile') }}</div>
                <!-- The shortcut as it is bound right now, not as it shipped —
                     it is rebindable in Settings, and a hint naming a key that
                     does nothing is worse than no hint. -->
                <div class="text-xs text-fg-3">
                  {{ $t('layout.selectFileHint') }}
                  <kbd
                    class="mx-0.5 rounded border border-border bg-bg-2 px-1 py-0.5 font-sans text-[11px] text-fg-2"
                  >{{ searchHotkey }}</kbd>
                </div>
              </div>
            </div>
          </div>
      </main>

      <!-- Agent panel — docked on the right (left edge resizes), or maximized to
           fill the whole window as a z-40 overlay above the editor. The chat's
           own content is centered at a readable width in maximized mode. -->
      <aside
        v-show="ui.agentOpen && !ui.zen"
        :class="
          ui.agentMaximized
            ? 'fixed inset-0 z-40 bg-bg-1'
            : ui.isNarrow
              ? 'absolute right-0 top-0 bottom-0 z-30 border-l border-border bg-bg-1 shadow-2xl'
              : 'relative shrink-0 border-l border-border'
        "
        :style="ui.agentMaximized ? undefined : { width: `${ui.shownAgentWidth}px` }"
      >
        <div
          v-if="!ui.agentMaximized && !ui.isNarrow"
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
          <!-- Each entry is a filter: click one and the graph is about that
               type, click it again and it is about everything. -->
          <button
            v-for="[t, color] in graphLegend.types"
            :key="t"
            class="flex items-center gap-1.5 shrink-0 rounded px-1.5 py-0.5 transition hover:bg-bg-2"
            :class="
              ui.graphType === t
                ? 'ring-1 ring-accent/60 bg-accent/10'
                : ui.graphType
                  ? 'opacity-40'
                  : ''
            "
            :title="ui.graphType === t ? $t('layout.graphTypeClear') : $t('layout.graphTypeFilter')"
            @click="ui.graphType = ui.graphType === t ? null : t"
          >
            <span class="inline-block h-2.5 w-2.5 rounded-full" :style="{ background: color }" />
            <span class="text-fg-2 whitespace-nowrap">{{ t }}</span>
          </button>
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
      v-if="!ui.agentOpen && !ui.zen"
      class="absolute bottom-5 right-2 z-30 w-9 h-9 rounded-full bg-accent text-white shadow-lg shadow-black/25 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
      :style="ui.narrowNoticeOpen ? { bottom: `${ui.narrowNoticeHeight + 12}px` } : undefined"
      :title="$t('layout.openAgent')"
      @click="ui.agentOpen = true"
    >
      <span class="codicon codicon-sparkle" />
    </button>

    <ReviewPanel />
    <GitPanel />
    <SettingsModal :open="ui.settingsOpen" @close="ui.settingsOpen = false" />
    <SearchPalette />
    <CitationPicker />
    <HealthPanel />
    <HelpPanel />

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
