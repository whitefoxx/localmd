<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useGitStore } from '@/stores/git'
import { GIT_DECOR } from '@/lib/gitStatus'
import { DRAG_ROWS, moveRows, readDragRows, writeDragRows } from '@/lib/fileOps'
import type { TreeNode } from '@/lib/fs'

const props = defineProps<{ node: TreeNode; depth: number }>()

const files = useFilesStore()
const git = useGitStore()
const isDir = computed(() => props.node.kind === 'dir')
const dragOver = ref(false)
const expanded = computed(() => files.expandedDirs.has(props.node.path))
const highlighted = computed(() => files.selectedPaths.has(props.node.path))
/** This row as the selection holds it. */
const row = computed(() => ({ path: props.node.path, isDir: isDir.value }))
// Base 24px matches the Open Files / Backlinks list indent (pl-6); each level
// adds 14px. Keeps all sidebar lists visually aligned.
const indent = computed(() => ({ paddingLeft: `${24 + props.depth * 14}px` }))

/* ── git status decoration (VS Code style: colored name + U/M/D letter) ──── */
const gitKind = computed(() => {
  if (!git.isRepo) return null
  return isDir.value ? git.dirStatus(props.node.path) : (git.statusByPath.get(props.node.path) ?? null)
})
const gitDeco = computed(() => (gitKind.value ? GIT_DECOR[gitKind.value] : null))

const icon = computed(() => {
  if (isDir.value) return expanded.value ? 'codicon-folder-opened' : 'codicon-folder'
  if (props.node.name.endsWith('.md')) return 'codicon-markdown'
  return 'codicon-file'
})

/** Injected from FileTree — opens the shared context menu at the cursor. */
const openContextMenu = inject<((node: TreeNode, e: MouseEvent) => void) | undefined>(
  'fileTreeCtx',
  undefined,
)

/**
 * Plain click opens; the modifiers only build a selection.
 *
 * Deliberately: shift-clicking a run of eight files to delete them must not
 * also open eight tabs, and neither modifier toggles a folder either. Opening
 * is what an unmodified click means, and it is the only thing that means it.
 */
function onClick(e: MouseEvent): void {
  if (e.shiftKey) {
    files.extendSelection(row.value.path, row.value.isDir)
    return
  }
  if (e.metaKey || e.ctrlKey) {
    files.toggleSelect(row.value.path, row.value.isDir)
    return
  }
  files.select(row.value.path, row.value.isDir)
  if (isDir.value) files.toggleDir(props.node.path)
  else void files.openFile(props.node.path)
}

/** Right-clicking inside a multi-selection keeps it, so the menu acts on what
 *  is highlighted; landing outside makes this row the selection first. A menu
 *  offering to delete four things while one is highlighted is a trap. */
function onContextMenu(e: MouseEvent): void {
  if (!highlighted.value) files.select(row.value.path, row.value.isDir)
  openContextMenu?.(props.node, e)
}

/* ── drag to move ─────────────────────────────────────────────────────── */

/** Drop target dir for this row: the dir itself, or a file's parent — so a
 *  drop landing on any row goes where it visually belongs, never to the root. */
const dropDir = computed(() => {
  if (isDir.value) return props.node.path
  const i = props.node.path.lastIndexOf('/')
  return i < 0 ? '' : props.node.path.slice(0, i)
})

/** Dragging a row inside a multi-selection carries the whole selection;
 *  dragging one outside it takes the selection with it first, so what moves is
 *  always what is highlighted. */
function onDragStart(e: DragEvent): void {
  if (!e.dataTransfer) return
  if (!highlighted.value) files.select(row.value.path, row.value.isDir)
  writeDragRows(e.dataTransfer, [...files.selection])
}
function onDragOver(e: DragEvent): void {
  if (!e.dataTransfer?.types.includes(DRAG_ROWS)) return
  e.preventDefault()
  e.stopPropagation()
  e.dataTransfer.dropEffect = 'move'
  dragOver.value = true
}
function onDrop(e: DragEvent): void {
  dragOver.value = false
  const rows = readDragRows(e.dataTransfer)
  if (!rows.length) return
  e.preventDefault()
  e.stopPropagation()
  void moveRows(rows, dropDir.value)
  if (isDir.value && !expanded.value) files.toggleDir(props.node.path) // reveal where it landed
}
</script>

<template>
  <div>
    <button
      class="w-full flex select-none items-center gap-1.5 py-0.5 pr-2 text-left text-sm truncate"
      :class="[
        highlighted ? 'bg-accent/15 text-fg-0' : 'text-fg-1 hover:bg-bg-2',
        dragOver ? 'ring-1 ring-inset ring-accent bg-accent/10' : '',
      ]"
      :style="indent"
      :data-tree-path="node.path"
      draggable="true"
      @click="onClick"
      @contextmenu.prevent="onContextMenu"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="dragOver = false"
      @drop="onDrop"
    >
      <!-- Files carry NO chevron placeholder: their icon sits in the chevron
           column, so a file's icon aligns with "> dir" at the same depth. -->
      <span
        v-if="node.kind === 'dir'"
        class="w-[14px] shrink-0 flex items-center justify-center text-fg-3"
      >
        <span
          class="codicon codicon-sm"
          :class="expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
        />
      </span>
      <span class="w-4 shrink-0 flex items-center justify-center text-fg-3">
        <span class="codicon codicon-sm" :class="icon" />
      </span>
      <span class="truncate flex-1" :class="gitDeco?.class">{{ node.name }}</span>
      <span v-if="gitDeco" class="shrink-0 text-xs font-medium" :class="gitDeco.class">
        {{ gitDeco.letter }}
      </span>
    </button>
    <template v-if="node.kind === 'dir' && expanded">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
      />
    </template>
  </div>
</template>
