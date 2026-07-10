<script setup lang="ts">
import { useFilesStore } from '@/stores/files'
import { baseName } from '@/lib/wiki'

const files = useFilesStore()

function onAuxClick(e: MouseEvent, path: string): void {
  // Middle-click closes a tab, like VS Code.
  if (e.button === 1) {
    e.preventDefault()
    void files.closeTab(path)
  }
}
</script>

<template>
  <div
    v-if="files.openTabs.length"
    class="flex items-stretch h-9 border-b border-border bg-bg-1 overflow-x-auto shrink-0 panel-scroll"
  >
    <button
      v-for="path in files.openTabs"
      :key="path"
      class="group flex items-center gap-1.5 px-3 text-sm border-r border-border whitespace-nowrap"
      :class="
        path === files.currentPath
          ? 'bg-bg-0 text-fg-0'
          : 'text-fg-2 hover:text-fg-0 hover:bg-bg-2/50'
      "
      :title="path"
      @click="files.openFile(path)"
      @auxclick="onAuxClick($event, path)"
    >
      <span class="truncate max-w-[160px]">{{ baseName(path) }}</span>
      <span
        v-if="path === files.currentPath && files.saveState !== 'saved'"
        class="w-2 h-2 rounded-full bg-accent shrink-0"
      />
      <span
        v-else
        class="codicon codicon-sm codicon-close text-fg-3 hover:text-fg-0 opacity-0 group-hover:opacity-100 shrink-0"
        :class="{ '!opacity-100': path === files.currentPath }"
        @click.stop="files.closeTab(path)"
      />
    </button>
  </div>
</template>
