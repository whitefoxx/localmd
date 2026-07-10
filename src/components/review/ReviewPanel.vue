<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useReviewStore } from '@/stores/review'
import { useFilesStore } from '@/stores/files'
import { diffLines } from '@/lib/diff'

const review = useReviewStore()
const files = useFilesStore()

const selected = ref<string | null>(null)

watch(
  () => review.changes,
  (changes) => {
    if (!changes.find((c) => c.path === selected.value)) {
      selected.value = changes[0]?.path ?? null
    }
  },
  { immediate: true },
)

const diff = computed(() => {
  const change = review.changes.find((c) => c.path === selected.value)
  if (!change) return []
  return diffLines(change.before ?? '', change.after)
})

async function openInEditor(path: string): Promise<void> {
  review.panelOpen = false
  await files.openFile(path)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="review.panelOpen"
      class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      @click.self="review.panelOpen = false"
    >
      <div class="w-[860px] max-w-[95vw] h-[70vh] rounded-lg border border-border bg-bg-1 flex flex-col">
        <div class="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
          <span class="codicon codicon-diff text-accent" />
          <h2 class="font-semibold text-fg-0 flex-1">
            Agent changes <span class="text-fg-3 font-normal">({{ review.count }})</span>
          </h2>
          <button class="btn text-xs" :disabled="!review.count" @click="review.discardAll()">
            Discard all
          </button>
          <button class="btn-primary text-xs" :disabled="!review.count" @click="review.approveAll()">
            Approve all
          </button>
          <button class="text-fg-3 hover:text-fg-0 ml-1" @click="review.panelOpen = false">
            <span class="codicon codicon-close" />
          </button>
        </div>

        <div v-if="!review.count" class="flex-1 flex items-center justify-center text-fg-3">
          No pending changes
        </div>

        <div v-else class="flex-1 flex min-h-0">
          <!-- Changed file list -->
          <div class="w-56 shrink-0 border-r border-border panel-scroll py-2">
            <button
              v-for="c in review.changes"
              :key="c.path"
              class="w-full text-left px-3 py-1.5 text-sm truncate hover:bg-bg-2 flex items-center gap-1.5"
              :class="selected === c.path ? 'bg-bg-2 text-fg-0' : 'text-fg-1'"
              @click="selected = c.path"
            >
              <span
                class="codicon codicon-sm shrink-0"
                :class="c.before === null ? 'codicon-diff-added text-added' : 'codicon-diff-modified text-accent'"
              />
              <span class="truncate">{{ c.path }}</span>
            </button>
          </div>

          <!-- Diff view -->
          <div class="flex-1 min-w-0 flex flex-col">
            <div v-if="selected" class="flex items-center gap-2 px-3 h-9 border-b border-border shrink-0">
              <span class="text-xs font-mono text-fg-2 flex-1 truncate">{{ selected }}</span>
              <button class="btn text-xs" @click="openInEditor(selected)">Open</button>
              <button class="btn text-xs" @click="review.discard(selected)">Discard</button>
              <button class="btn-primary text-xs" @click="review.approve(selected)">Approve</button>
            </div>
            <div class="flex-1 panel-scroll font-mono text-xs leading-5 selectable">
              <div
                v-for="(line, i) in diff"
                :key="i"
                class="px-3 whitespace-pre-wrap"
                :class="{
                  'bg-added/10 text-added': line.type === 'add',
                  'bg-removed/10 text-removed': line.type === 'del',
                  'text-fg-2': line.type === 'same',
                }"
              >{{ (line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  ') + line.text }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
