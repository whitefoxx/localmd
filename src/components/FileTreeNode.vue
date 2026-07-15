<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useGitStore } from '@/stores/git'
import { GIT_DECOR } from '@/lib/gitStatus'
import type { TreeNode } from '@/lib/fs'

const props = defineProps<{ node: TreeNode; depth: number }>()

const files = useFilesStore()
const git = useGitStore()
const isDir = computed(() => props.node.kind === 'dir')
const dragOver = ref(false)
const expanded = computed(() => files.expandedDirs.has(props.node.path))
const highlighted = computed(() => files.selectedPath === props.node.path)
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

function onClick(): void {
  files.select(props.node.path, isDir.value)
  if (isDir.value) files.toggleDir(props.node.path)
  else void files.openFile(props.node.path)
}

function onContextMenu(e: MouseEvent): void {
  files.select(props.node.path, isDir.value)
  openContextMenu?.(props.node, e)
}

/* ── drag to move ─────────────────────────────────────────────────────── */
const DRAG_PATH = 'application/x-bmd-path'
const DRAG_ISDIR = 'application/x-bmd-isdir'
const moveEntry = inject<((source: string, isDir: boolean, targetDir: string) => void) | undefined>(
  'fileTreeMove',
  undefined,
)

/** Drop target dir for this row: the dir itself, or a file's parent — so a
 *  drop landing on any row goes where it visually belongs, never to the root. */
const dropDir = computed(() => {
  if (isDir.value) return props.node.path
  const i = props.node.path.lastIndexOf('/')
  return i < 0 ? '' : props.node.path.slice(0, i)
})

function onDragStart(e: DragEvent): void {
  if (!e.dataTransfer) return
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData(DRAG_PATH, props.node.path)
  e.dataTransfer.setData(DRAG_ISDIR, String(isDir.value))
}
function onDragOver(e: DragEvent): void {
  if (!e.dataTransfer?.types.includes(DRAG_PATH)) return
  e.preventDefault()
  e.stopPropagation()
  e.dataTransfer.dropEffect = 'move'
  dragOver.value = true
}
function onDrop(e: DragEvent): void {
  dragOver.value = false
  const src = e.dataTransfer?.getData(DRAG_PATH)
  if (!src) return
  e.preventDefault()
  e.stopPropagation()
  moveEntry?.(src, e.dataTransfer!.getData(DRAG_ISDIR) === 'true', dropDir.value)
  if (isDir.value && !expanded.value) files.toggleDir(props.node.path) // reveal where it landed
}
</script>

<template>
  <div>
    <button
      class="w-full flex items-center gap-1.5 py-0.5 pr-2 text-left text-sm truncate"
      :class="[
        highlighted ? 'bg-accent/15 text-fg-0' : 'text-fg-1 hover:bg-bg-2',
        dragOver ? 'ring-1 ring-inset ring-accent bg-accent/10' : '',
      ]"
      :style="indent"
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
