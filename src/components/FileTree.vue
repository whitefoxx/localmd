<script setup lang="ts">
import { ref, provide, computed } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useKbStore } from '@/stores/kb'
import { useKbIndexStore } from '@/stores/kbIndex'
import * as fs from '@/lib/fs'
import { importFileInto } from '@/lib/capture'
import { indexableKind, indexDocument } from '@/lib/docindex'
import FileTreeNode from '@/components/FileTreeNode.vue'
import type { TreeNode } from '@/lib/fs'

const files = useFilesStore()
const kb = useKbStore()
const fileInput = ref<HTMLInputElement | null>(null)
const indexStatus = ref('')
const expanded = ref(true)

const ctxItem =
  'w-full flex items-center gap-2 px-3 py-1.5 text-left text-fg-1 hover:bg-bg-2 hover:text-fg-0'
const ctxSep = 'my-1 border-t border-border'

/* ── context menu (shared with every FileTreeNode via provide) ──────────── */
const ctx = ref<{ node: TreeNode; x: number; y: number } | null>(null)
provide('fileTreeCtx', (node: TreeNode, e: MouseEvent) => {
  ctx.value = { node, x: e.clientX, y: e.clientY }
})

/* ── drag-to-move (shared with every FileTreeNode via provide) ──────────── */
/** Move a file/dir into targetDir ('' = KB root). No-ops when it's already
 *  there or would move a directory into itself; refuses name collisions. */
async function moveEntry(source: string, isDir: boolean, targetDir: string): Promise<void> {
  const name = source.slice(source.lastIndexOf('/') + 1)
  const parent = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : ''
  if (parent === targetDir) return
  if (isDir && (targetDir === source || targetDir.startsWith(`${source}/`))) return
  const dest = targetDir ? `${targetDir}/${name}` : name
  if (await fs.exists(dest)) {
    window.alert(`"${targetDir || 'KB 根目录'}" 下已存在 ${name},移动已取消`)
    return
  }
  await files.renameEntry(source, dest, isDir)
}
provide('fileTreeMove', moveEntry)

function onRootDragOver(e: DragEvent): void {
  if (e.dataTransfer?.types.includes('application/x-bmd-path')) e.preventDefault()
}
function onRootDrop(e: DragEvent): void {
  const src = e.dataTransfer?.getData('application/x-bmd-path')
  if (!src) return
  e.preventDefault()
  e.stopPropagation()
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
  const name = prompt('New file name (e.g. idea.md):')?.trim()
  if (!name) return
  const rel = inTarget(name)
  const path = /\.[^/]+$/.test(rel) ? rel : `${rel}.md`
  const stem = path.split('/').pop()!.replace(/\.md$/, '')
  await files.createFile(path, path.endsWith('.md') ? `# ${stem}\n\n` : '')
}

async function newFolder(): Promise<void> {
  closeMenu()
  const name = prompt('New folder name:')?.trim()
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
}

/** Build a PDF/EPUB/MD index for every indexable file under `dir` ('' = root). */
async function indexDocs(dir: string): Promise<void> {
  closeMenu()
  const prefix = dir ? `${dir}/` : ''
  const docs = files.allFiles.filter((p) => p.startsWith(prefix) && indexableKind(p))
  if (!docs.length) return
  for (let i = 0; i < docs.length; i++) {
    indexStatus.value = `Indexing ${i + 1}/${docs.length}…`
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
  indexStatus.value = 'Indexing…'
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
  const next = prompt('Rename to:', node.name)?.trim()
  if (!next || next === node.name) return
  const i = node.path.lastIndexOf('/')
  const newPath = i < 0 ? next : `${node.path.slice(0, i)}/${next}`
  await files.renameEntry(node.path, newPath, node.kind === 'dir')
}

async function menuDelete(node: TreeNode): Promise<void> {
  closeMenu()
  const what = node.kind === 'dir' ? 'folder (and its contents)' : 'file'
  if (!confirm(`Delete ${what} “${node.name}”? This cannot be undone.`)) return
  await files.deleteEntry(node.path, node.kind === 'dir')
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
  <div class="py-2" @click.self="files.clearSelection()" @dragover="onRootDragOver" @drop="onRootDrop">
    <div class="flex items-center px-3 mb-1">
      <button
        class="flex items-center gap-1 text-xs uppercase tracking-wide text-fg-3 hover:text-fg-1 flex-1 min-w-0"
        @click="expanded = !expanded"
      >
        <span
          class="codicon codicon-sm shrink-0"
          :class="expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
        />
        <span class="truncate">{{ indexStatus || 'Files' }}</span>
      </button>
      <button class="text-fg-3 hover:text-fg-1 ml-2" title="New file" @click="newFile">
        <span class="codicon codicon-sm codicon-new-file" />
      </button>
      <button class="text-fg-3 hover:text-fg-1 ml-2" title="New folder" @click="newFolder">
        <span class="codicon codicon-sm codicon-new-folder" />
      </button>
      <button class="text-fg-3 hover:text-fg-1 ml-2" title="Import files" @click="pickImport">
        <span class="codicon codicon-sm codicon-desktop-download" />
      </button>
      <button
        class="text-fg-3 hover:text-fg-1 ml-2"
        title="Collapse all"
        @click="files.collapseAll()"
      >
        <span class="codicon codicon-sm codicon-collapse-all" />
      </button>
      <button
        class="text-fg-3 hover:text-fg-1 ml-2"
        title="Refresh"
        @click="() => files.refreshTree()"
      >
        <span class="codicon codicon-sm codicon-refresh" />
      </button>
    </div>
    <template v-if="expanded">
      <FileTreeNode v-for="node in files.tree" :key="node.path" :node="node" :depth="0" />
      <div v-if="!files.tree.length" class="px-3 py-2 text-xs text-fg-3">Empty folder</div>
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
            <span class="codicon codicon-sm codicon-new-file" />New File
          </button>
          <button :class="ctxItem" @click="newFolder">
            <span class="codicon codicon-sm codicon-new-folder" />New Folder
          </button>
          <button :class="ctxItem" @click="pickImport">
            <span class="codicon codicon-sm codicon-cloud-upload" />Import Files…
          </button>
          <button :class="ctxItem" @click="indexDocs(ctx.node.path)">
            <span class="codicon codicon-sm codicon-book" />Index docs for AI
          </button>
          <div :class="ctxSep" />
        </template>
        <template v-else>
          <button :class="ctxItem" @click="menuOpen(ctx.node)">
            <span class="codicon codicon-sm codicon-go-to-file" />Open
          </button>
          <button
            v-if="indexableKind(ctx.node.path)"
            :class="ctxItem"
            @click="indexFile(ctx.node.path)"
          >
            <span class="codicon codicon-sm codicon-book" />Index for AI
          </button>
          <div :class="ctxSep" />
        </template>

        <button :class="ctxItem" @click="menuRename(ctx.node)">
          <span class="codicon codicon-sm codicon-edit" />Rename…
          <span class="ml-auto text-fg-3 text-xs">F2</span>
        </button>
        <button :class="ctxItem" @click="menuDelete(ctx.node)">
          <span class="codicon codicon-sm codicon-trash text-removed" />
          <span class="text-removed">Delete</span>
          <span class="ml-auto text-fg-3 text-xs">⌫</span>
        </button>
        <div :class="ctxSep" />
        <button :class="ctxItem" @click="menuCopyPath(ctx.node, false)">
          <span class="codicon codicon-sm codicon-link" />Copy Path
        </button>
        <button :class="ctxItem" @click="menuCopyPath(ctx.node, true)">
          <span class="codicon codicon-sm codicon-link" />Copy Relative Path
        </button>
      </div>
    </template>
  </div>
</template>
