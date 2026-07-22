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
  <div v-if="files.currentPath" class="border-t border-border shrink-0 flex flex-col min-h-0 max-h-[25%]">
    <button
      class="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wide text-fg-3 hover:text-fg-1 shrink-0"
      @click="expanded = !expanded"
    >
      <span
        class="codicon codicon-sm"
        :class="expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
      />
      {{ $t('backlinks.heading', { n: links.length }) }}
    </button>
    <div v-if="expanded" class="pb-2 overflow-auto panel-scroll min-h-0">
      <button
        v-for="p in links"
        :key="p"
        class="w-full text-left pl-6 pr-2 py-0.5 text-sm text-fg-1 truncate hover:bg-bg-2"
        @click="files.openFile(p)"
      >
        {{ p }}
      </button>
      <div v-if="!links.length" class="pl-6 pr-2 text-xs text-fg-3">{{ $t('backlinks.empty') }}</div>
    </div>
  </div>
</template>
