<script setup lang="ts">
import { ref, computed } from 'vue'
import { useFilesStore } from '@/stores/files'
import { baseName } from '@/lib/wiki'

const files = useFilesStore()

const ctxItem =
  'w-full flex items-center gap-2 px-3 py-1.5 text-left text-fg-1 hover:bg-bg-2 hover:text-fg-0'

/* ── context menu ───────────────────────────────────────────────────────── */
const ctx = ref<{ path: string; x: number; y: number } | null>(null)
function openMenu(e: MouseEvent, path: string): void {
  ctx.value = { path, x: e.clientX, y: e.clientY }
}
function closeMenu(): void {
  ctx.value = null
}
const menuStyle = computed(() => {
  if (!ctx.value) return {}
  const left = Math.max(4, Math.min(ctx.value.x, window.innerWidth - 210))
  const top = Math.max(4, Math.min(ctx.value.y, window.innerHeight - 200))
  return { left: `${left}px`, top: `${top}px` }
})
/** Whether the menu target has any tabs to its right (enables "Close to the Right"). */
const hasRight = computed(() => {
  if (!ctx.value) return false
  const i = files.openTabs.indexOf(ctx.value.path)
  return i >= 0 && i < files.openTabs.length - 1
})

function run(fn: () => void): void {
  fn()
  closeMenu()
}

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
      @contextmenu.prevent="openMenu($event, path)"
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

  <!-- Right-click menu -->
  <template v-if="ctx">
    <div class="fixed inset-0 z-40" @click="closeMenu" @contextmenu.prevent="closeMenu" />
    <div
      class="fixed z-50 min-w-[190px] rounded-md border border-border bg-bg-1 shadow-lg py-1 text-sm"
      :style="menuStyle"
    >
      <button :class="ctxItem" @click="run(() => files.closeTab(ctx!.path))">
        Close<span class="ml-auto text-fg-3 text-xs">⌘W</span>
      </button>
      <button :class="ctxItem" @click="run(() => files.closeOtherTabs(ctx!.path))">
        Close Others
      </button>
      <button
        :class="hasRight ? ctxItem : 'w-full flex items-center px-3 py-1.5 text-left text-fg-3 cursor-not-allowed'"
        :disabled="!hasRight"
        @click="hasRight && run(() => files.closeTabsToRight(ctx!.path))"
      >
        Close to the Right
      </button>
      <button :class="ctxItem" @click="run(() => files.closeSavedTabs())">Close Saved</button>
      <button :class="ctxItem" @click="run(() => files.closeAllTabs())">Close All</button>
    </div>
  </template>
</template>
