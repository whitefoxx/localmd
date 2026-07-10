<script setup lang="ts">
import { ref, computed } from 'vue'
import { useFilesStore } from '@/stores/files'
import type { TreeNode } from '@/lib/fs'

const props = defineProps<{ node: TreeNode; depth: number }>()

const files = useFilesStore()
const expanded = ref(props.depth === 0)

const isActive = computed(() => files.currentPath === props.node.path)
const indent = computed(() => ({ paddingLeft: `${12 + props.depth * 14}px` }))

const icon = computed(() => {
  if (props.node.kind === 'dir') return expanded.value ? 'codicon-folder-opened' : 'codicon-folder'
  if (props.node.name.endsWith('.md')) return 'codicon-markdown'
  return 'codicon-file'
})

function onClick(): void {
  if (props.node.kind === 'dir') {
    expanded.value = !expanded.value
  } else {
    void files.openFile(props.node.path)
  }
}
</script>

<template>
  <div>
    <button
      class="w-full flex items-center gap-1.5 py-0.5 pr-2 text-left text-sm truncate hover:bg-bg-2"
      :class="isActive ? 'bg-bg-2 text-fg-0' : 'text-fg-1'"
      :style="indent"
      @click="onClick"
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
