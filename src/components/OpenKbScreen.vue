<script setup lang="ts">
import { computed } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { isSupported } from '@/lib/fs'
import type { RecentKb } from '@/lib/idb'

const kb = useKbStore()
const files = useFilesStore()
const supported = computed(() => isSupported())

async function open(): Promise<void> {
  if (await kb.pickAndOpen()) await files.refreshTree()
}

async function openRecent(entry: RecentKb): Promise<void> {
  if (await kb.openRecent(entry)) await files.refreshTree()
}
</script>

<template>
  <div class="h-full flex items-center justify-center">
    <div class="w-[420px] max-w-full px-6">
      <h1 class="text-3xl font-bold text-fg-0 mb-1">browser-md</h1>
      <p class="text-fg-2 mb-6">
        Your AI knowledge base, in the browser. Files stay on your device — nothing is uploaded.
      </p>

      <template v-if="supported">
        <button class="btn-primary w-full py-2 text-base" @click="open">
          <span class="codicon codicon-folder-opened mr-2" />Open local folder
        </button>

        <div v-if="kb.error" class="mt-3 text-sm text-removed">{{ kb.error }}</div>

        <div v-if="kb.recents.length" class="mt-8">
          <div class="text-xs uppercase tracking-wide text-fg-3 mb-2">Recent</div>
          <button
            v-for="r in kb.recents"
            :key="r.name"
            class="w-full text-left px-3 py-2 rounded hover:bg-bg-2 text-fg-1 flex items-center gap-2"
            @click="openRecent(r)"
          >
            <span class="codicon codicon-folder text-fg-3" />
            <span class="flex-1 truncate">{{ r.name }}</span>
            <span class="text-xs text-fg-3">{{ new Date(r.lastOpened).toLocaleDateString() }}</span>
          </button>
        </div>
      </template>

      <div v-else class="p-4 rounded border border-border bg-bg-1 text-sm text-fg-2">
        This browser does not support opening local folders (File System Access API). Please use
        Chrome or Edge.
      </div>
    </div>
  </div>
</template>
