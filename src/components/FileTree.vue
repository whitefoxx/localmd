<script setup lang="ts">
import { useFilesStore } from '@/stores/files'
import FileTreeNode from '@/components/FileTreeNode.vue'

const files = useFilesStore()

async function newFile(): Promise<void> {
  const name = prompt('New markdown file name (e.g. notes/idea.md):')
  if (!name) return
  const path = name.endsWith('.md') ? name : `${name}.md`
  await files.createFile(path, `# ${path.split('/').pop()!.replace(/\.md$/, '')}\n\n`)
}
</script>

<template>
  <div class="py-2">
    <div class="flex items-center px-3 mb-1">
      <span class="text-xs uppercase tracking-wide text-fg-3 flex-1">Files</span>
      <button class="text-fg-3 hover:text-fg-1" title="New file" @click="newFile">
        <span class="codicon codicon-sm codicon-new-file" />
      </button>
      <button
        class="text-fg-3 hover:text-fg-1 ml-2"
        title="Refresh"
        @click="() => files.refreshTree()"
      >
        <span class="codicon codicon-sm codicon-refresh" />
      </button>
    </div>
    <FileTreeNode v-for="node in files.tree" :key="node.path" :node="node" :depth="0" />
    <div v-if="!files.tree.length" class="px-3 py-2 text-xs text-fg-3">Empty folder</div>
  </div>
</template>
