<script setup lang="ts">
import { computed, inject } from 'vue'
import { useFilesStore } from '@/stores/files'
import type { TreeNode } from '@/lib/fs'

const props = defineProps<{ node: TreeNode; depth: number }>()

const files = useFilesStore()
const isDir = computed(() => props.node.kind === 'dir')
const expanded = computed(() => files.expandedDirs.has(props.node.path))
const highlighted = computed(() => files.selectedPath === props.node.path)
const indent = computed(() => ({ paddingLeft: `${12 + props.depth * 14}px` }))

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
</script>

<template>
  <div>
    <button
      class="w-full flex items-center gap-1.5 py-0.5 pr-2 text-left text-sm truncate"
      :class="highlighted ? 'bg-accent/15 text-fg-0' : 'text-fg-1 hover:bg-bg-2'"
      :style="indent"
      @click="onClick"
      @contextmenu.prevent="onContextMenu"
    >
      <span
        v-if="node.kind === 'dir'"
        class="codicon codicon-sm text-fg-3"
        :class="expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
      />
      <span v-else class="w-[14px] shrink-0" />
      <span class="codicon codicon-sm text-fg-3" :class="icon" />
      <span class="truncate">{{ node.name }}</span>
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
