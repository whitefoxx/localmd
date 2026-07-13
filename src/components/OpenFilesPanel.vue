<script setup lang="ts">
import { ref } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useUiStore } from '@/stores/ui'
import { baseName } from '@/lib/wiki'

const files = useFilesStore()
const ui = useUiStore()
const expanded = ref(true)
</script>

<template>
  <div v-if="files.openTabs.length" class="border-b border-border shrink-0">
    <div class="flex items-center pr-1">
      <button
        class="flex items-center gap-1.5 pl-3 py-1.5 text-xs uppercase tracking-wide text-fg-3 hover:text-fg-1 flex-1 min-w-0"
        @click="expanded = !expanded"
      >
        <span
          class="codicon codicon-sm shrink-0"
          :class="expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
        />
        <span class="truncate">Open Files ({{ files.openTabs.length }})</span>
      </button>
      <button
        class="text-fg-3 hover:text-fg-1 px-1"
        :title="ui.editorTabsVisible ? 'Hide editor tab bar' : 'Show editor tab bar'"
        @click="ui.editorTabsVisible = !ui.editorTabsVisible"
      >
        <span
          class="codicon codicon-sm"
          :class="ui.editorTabsVisible ? 'codicon-eye' : 'codicon-eye-closed'"
        />
      </button>
      <button class="text-fg-3 hover:text-fg-1 px-1" title="Save all" @click="() => files.flush()">
        <span class="codicon codicon-sm codicon-save-all" />
      </button>
      <button
        class="text-fg-3 hover:text-fg-1 px-1"
        title="Close all"
        @click="() => files.closeAllTabs()"
      >
        <span class="codicon codicon-sm codicon-close-all" />
      </button>
    </div>
    <div v-if="expanded" class="pb-1 max-h-48 overflow-auto panel-scroll">
      <button
        v-for="p in files.openTabs"
        :key="p"
        class="group w-full flex items-center gap-1.5 pl-6 pr-2 py-0.5 text-sm"
        :class="p === files.currentPath ? 'bg-accent/15 text-fg-0' : 'text-fg-1 hover:bg-bg-2'"
        :title="p"
        @click="files.openFile(p)"
      >
        <span
          class="codicon codicon-sm text-fg-3 shrink-0"
          :class="p.endsWith('.md') ? 'codicon-markdown' : 'codicon-file'"
        />
        <span class="truncate flex-1 text-left">{{ baseName(p) }}</span>
        <span
          v-if="p === files.currentPath && files.saveState !== 'saved'"
          class="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
        />
        <span
          v-else
          class="codicon codicon-sm codicon-close text-fg-3 hover:text-fg-0 opacity-0 group-hover:opacity-100 shrink-0"
          @click.stop="files.closeTab(p)"
        />
      </button>
    </div>
  </div>
</template>
