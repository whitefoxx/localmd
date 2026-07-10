<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useKbIndexStore } from '@/stores/kbIndex'

const files = useFilesStore()
const index = useKbIndexStore()
const expanded = ref(true)

const links = computed(() =>
  files.currentPath ? index.backlinks(files.currentPath) : [],
)

watch(
  () => files.currentPath,
  () => void index.refresh(),
  { immediate: true },
)
</script>

<template>
  <div v-if="files.currentPath" class="border-t border-border">
    <button
      class="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wide text-fg-3 hover:text-fg-1"
      @click="expanded = !expanded"
    >
      <span
        class="codicon codicon-sm"
        :class="expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
      />
      Backlinks ({{ links.length }})
    </button>
    <div v-if="expanded" class="pb-2">
      <button
        v-for="p in links"
        :key="p"
        class="w-full text-left px-8 py-0.5 text-sm text-fg-1 truncate hover:bg-bg-2"
        @click="files.openFile(p)"
      >
        {{ p }}
      </button>
      <div v-if="!links.length" class="px-8 text-xs text-fg-3">No backlinks</div>
    </div>
  </div>
</template>
