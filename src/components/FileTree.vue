<script setup lang="ts">
import { ref, provide, computed, watch, nextTick } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useKbStore } from '@/stores/kb'
import { useKbIndexStore } from '@/stores/kbIndex'
import * as fs from '@/lib/fs'
import { importFileInto } from '@/lib/capture'
import { indexableKind, indexDocument } from '@/lib/docindex'
import {
  moveEntry,
  newFileInteractive,
  deleteInteractive,
  refreshGitStatus,
} from '@/lib/fileOps'
import FileTreeNode from '@/components/FileTreeNode.vue'
import type { TreeNode } from '@/lib/fs'
import { t } from '@/i18n'

const files = useFilesStore()
const kb = useKbStore()
const fileInput = ref<HTMLInputElement | null>(null)
const indexStatus = ref('')
const expanded = ref(true)
const rootEl = ref<HTMLElement | null>(null)

/* Follow the active file: whenever it changes (a tab click, or an open from
 * backlinks / open-files / a wikilink / the agent), the tree expands the path
 * down to it, highlights that row alone, and scrolls it into view.
 * `block: 'nearest'` only nudges when the row is actually off-screen — e.g.
 * after the backlinks panel resizes below. */
watch(
  () => files.currentPath,
  async (path) => {
    if (!path) return
    files.revealPath(path)
    await nextTick() // rows of a just-expanded folder need to exist first
    const el = rootEl.value?.querySelector(`[data-tree-path="${CSS.escape(path)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  },
)

const ctxItem =
  'w-full flex items-center gap-2 px-3 py-1.5 text-left text-fg-1 hover:bg-bg-2 hover:text-fg-0'
const ctxSep = 'my-1 border-t border-border'

/* ── context menu (shared with every FileTreeNode via provide) ──────────── */
const ctx = ref<{ node: TreeNode; x: number; y: number } | null>(null)
provide('fileTreeCtx', (node: TreeNode, e: MouseEvent) => {
  ctx.value = { node, x: e.clientX, y: e.clientY }
})

/* ── drag-to-move: the actual logic lives in lib/fileOps (shared with the
 *    ⌘M hotkey); nodes reach it via provide. ─────────────────────────────── */
provide('fileTreeMove', moveEntry)

/* Root drop = move to the KB root — but ONLY on true blank space (.self
 * modifiers): rows handle their own drops (dir = into it, file = into its
 * parent), so a drop between rows can't fall through to the root by accident. */
function onRootDragOver(e: DragEvent): void {
  if (e.dataTransfer?.types.includes('application/x-bmd-path')) e.preventDefault()
}
function onRootDrop(e: DragEvent): void {
  const src = e.dataTransfer?.getData('application/x-bmd-path')
  if (!src) return
  e.preventDefault()
  void moveEntry(src, e.dataTransfer!.getData('application/x-bmd-isdir') === 'true', '')
}
function closeMenu(): void {
  ctx.value = null
}
const menuStyle = computed(() => {
  if (!ctx.value) return {}
  const left = Math.max(4, Math.min(ctx.value.x, window.innerWidth - 210))
  const top = Math.max(4, Math.min(ctx.value.y, window.innerHeight - 340))
  return { left: `${left}px`, top: `${top}px` }
})

/* ── new items land in the target dir (selected folder / file's parent / root) */
function inTarget(name: string): string {
  return files.targetDir ? `${files.targetDir}/${name}` : name
}

async function newFile(): Promise<void> {
  closeMenu()
  await newFileInteractive()
}

async function newFolder(): Promise<void> {
  closeMenu()
  const name = prompt(t('files.newFolderPrompt'))?.trim()
  if (!name) return
  const path = inTarget(name)
  await fs.mkdir(path)
  await files.refreshTree()
  files.select(path, true)
}

function pickImport(): void {
  closeMenu()
  fileInput.value?.click()
}
async function onImport(e: Event): Promise<void> {
  const el = e.target as HTMLInputElement
  const list = el.files ? Array.from(el.files) : []
  el.value = ''
  if (!list.length) return
  for (const f of list) await importFileInto(f, files.targetDir)
  await files.refreshTree()
  refreshGitStatus()
}

/** Build a PDF/EPUB/MD index for every indexable file under `dir` ('' = root). */
async function indexDocs(dir: string): Promise<void> {
  closeMenu()
  const prefix = dir ? `${dir}/` : ''
  const docs = files.allFiles.filter((p) => p.startsWith(prefix) && indexableKind(p))
  if (!docs.length) return
  for (let i = 0; i < docs.length; i++) {
    indexStatus.value = t('files.indexingN', { i: i + 1, total: docs.length })
    try {
      await indexDocument(docs[i])
    } catch (err) {
      console.error('index failed', docs[i], err)
    }
  }
  indexStatus.value = ''
  await files.refreshTree()
  await useKbIndexStore().refresh()
}

/** (Re)build the AI index for a single pdf/epub/md file. */
async function indexFile(path: string): Promise<void> {
  closeMenu()
  indexStatus.value = t('files.indexing')
  try {
    await indexDocument(path)
  } catch (err) {
    console.error('index failed', path, err)
  }
  indexStatus.value = ''
  await useKbIndexStore().refresh()
}

/* ── rename / delete / copy (operate on the menu target) ────────────────── */
function menuOpen(node: TreeNode): void {
  closeMenu()
  files.select(node.path, node.kind === 'dir')
  if (node.kind === 'dir') {
    if (!files.expandedDirs.has(node.path)) files.toggleDir(node.path)
  } else void files.openFile(node.path)
}

async function menuRename(node: TreeNode): Promise<void> {
  closeMenu()
  const next = prompt(t('files.renamePrompt'), node.name)?.trim()
  if (!next || next === node.name) return
  const i = node.path.lastIndexOf('/')
  const newPath = i < 0 ? next : `${node.path.slice(0, i)}/${next}`
  await files.renameEntry(node.path, newPath, node.kind === 'dir')
  refreshGitStatus()
}

async function menuDelete(node: TreeNode): Promise<void> {
  closeMenu()
  await deleteInteractive(node.path, node.kind === 'dir')
}

async function menuCopyPath(node: TreeNode, relative: boolean): Promise<void> {
  closeMenu()
  const text = relative ? node.path : `${kb.name ?? ''}/${node.path}`
  try {
    await navigator.clipboard.writeText(text)
  } catch (err) {
    console.error('clipboard write failed', err)
  }
}
</script>

<template>
  <div ref="rootEl" class="pb-2" @click.self="files.clearSelection()" @dragover.self="onRootDragOver" @drop.self="onRootDrop">
    <!-- The tree scrolls inside the sidebar's panel-scroll container; the
         heading + actions row stays pinned to its top edge (opaque bg so rows
         slide underneath). -->
    <div class="sticky top-0 z-10 flex items-center px-3 pt-2 pb-1 bg-bg-1">
      <button
        class="flex items-center gap-1 text-xs uppercase tracking-wide text-fg-3 hover:text-fg-1 flex-1 min-w-0"
        @click="expanded = !expanded"
      >
        <span
          class="codicon codicon-sm shrink-0"
          :class="expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
        />
        <span class="truncate">{{ indexStatus || $t('files.heading') }}</span>
      </button>
      <button class="text-fg-3 hover:text-fg-1 ml-2" :title="$t('files.newFile')" @click="newFile">
        <span class="codicon codicon-sm codicon-new-file" />
      </button>
      <button class="text-fg-3 hover:text-fg-1 ml-2" :title="$t('files.newFolder')" @click="newFolder">
        <span class="codicon codicon-sm codicon-new-folder" />
      </button>
      <button class="text-fg-3 hover:text-fg-1 ml-2" :title="$t('files.importFiles')" @click="pickImport">
        <span class="codicon codicon-sm codicon-desktop-download" />
      </button>
      <button
        class="text-fg-3 hover:text-fg-1 ml-2"
        :title="$t('files.collapseAll')"
        @click="files.collapseAll()"
      >
        <span class="codicon codicon-sm codicon-collapse-all" />
      </button>
      <button
        class="text-fg-3 hover:text-fg-1 ml-2"
        :title="$t('files.refresh')"
        @click="() => files.refreshTree()"
      >
        <span class="codicon codicon-sm codicon-refresh" />
      </button>
    </div>
    <template v-if="expanded">
      <FileTreeNode v-for="node in files.tree" :key="node.path" :node="node" :depth="0" />
      <div v-if="!files.tree.length" class="px-3 py-2 text-xs text-fg-3">{{ $t('files.emptyFolder') }}</div>
    </template>
    <input ref="fileInput" type="file" multiple class="hidden" @change="onImport" />

    <!-- Right-click context menu -->
    <template v-if="ctx">
      <div class="fixed inset-0 z-40" @click="closeMenu" @contextmenu.prevent="closeMenu" />
      <div
        class="fixed z-50 min-w-[190px] rounded-md border border-border bg-bg-1 shadow-lg py-1 text-sm"
        :style="menuStyle"
      >
        <template v-if="ctx.node.kind === 'dir'">
          <button :class="ctxItem" @click="newFile">
            <span class="codicon codicon-sm codicon-new-file" />{{ $t('files.menu.newFile') }}
          </button>
          <button :class="ctxItem" @click="newFolder">
            <span class="codicon codicon-sm codicon-new-folder" />{{ $t('files.menu.newFolder') }}
          </button>
          <button :class="ctxItem" @click="pickImport">
            <span class="codicon codicon-sm codicon-cloud-upload" />{{ $t('files.menu.importFiles') }}
          </button>
          <button :class="ctxItem" @click="indexDocs(ctx.node.path)">
            <span class="codicon codicon-sm codicon-book" />{{ $t('files.menu.indexDocs') }}
          </button>
          <div :class="ctxSep" />
        </template>
        <template v-else>
          <button :class="ctxItem" @click="menuOpen(ctx.node)">
            <span class="codicon codicon-sm codicon-go-to-file" />{{ $t('files.menu.open') }}
          </button>
          <button
            v-if="indexableKind(ctx.node.path)"
            :class="ctxItem"
            @click="indexFile(ctx.node.path)"
          >
            <span class="codicon codicon-sm codicon-book" />{{ $t('files.menu.indexForAi') }}
          </button>
          <div :class="ctxSep" />
        </template>

        <button :class="ctxItem" @click="menuRename(ctx.node)">
          <span class="codicon codicon-sm codicon-edit" />{{ $t('files.menu.rename') }}
          <span class="ml-auto text-fg-3 text-xs">F2</span>
        </button>
        <button :class="ctxItem" @click="menuDelete(ctx.node)">
          <span class="codicon codicon-sm codicon-trash text-removed" />
          <span class="text-removed">{{ $t('files.menu.delete') }}</span>
          <span class="ml-auto text-fg-3 text-xs">⌫</span>
        </button>
        <div :class="ctxSep" />
        <button :class="ctxItem" @click="menuCopyPath(ctx.node, false)">
          <span class="codicon codicon-sm codicon-link" />{{ $t('files.menu.copyPath') }}
        </button>
        <button :class="ctxItem" @click="menuCopyPath(ctx.node, true)">
          <span class="codicon codicon-sm codicon-link" />{{ $t('files.menu.copyRelativePath') }}
        </button>
      </div>
    </template>
  </div>
</template>
