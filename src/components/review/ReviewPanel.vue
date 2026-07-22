<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useReviewStore } from '@/stores/review'
import { useFilesStore } from '@/stores/files'
import { diffLines, collapseContext } from '@/lib/diff'

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
  return collapseContext(diffLines(change.before ?? '', change.after))
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
            {{ $t('review.title') }} <span class="text-fg-3 font-normal">({{ review.count }})</span>
          </h2>
          <button class="btn text-xs" :disabled="!review.count" @click="review.discardAll()">
            {{ $t('review.discardAll') }}
          </button>
          <button class="btn-primary text-xs" :disabled="!review.count" @click="review.approveAll()">
            {{ $t('review.approveAll') }}
          </button>
          <button class="text-fg-3 hover:text-fg-0 ml-1" @click="review.panelOpen = false">
            <span class="codicon codicon-close" />
          </button>
        </div>

        <div v-if="!review.count" class="flex-1 flex items-center justify-center text-fg-3">
          {{ $t('review.noPending') }}
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
              <span class="truncate flex-1">{{ c.path }}</span>
              <span
                v-if="c.awaiting"
                class="text-[10px] px-1 rounded bg-accent/15 text-accent shrink-0"
                :title="$t('review.awaitingTitle')"
              >{{ $t('review.awaiting') }}</span>
            </button>
          </div>

          <!-- Diff view -->
          <div class="flex-1 min-w-0 flex flex-col">
            <div v-if="selected" class="flex items-center gap-2 px-3 h-9 border-b border-border shrink-0">
              <span class="text-xs font-mono text-fg-2 flex-1 truncate">{{ selected }}</span>
              <button class="btn text-xs" @click="openInEditor(selected)">{{ $t('common.open') }}</button>
              <button class="btn text-xs" @click="review.discard(selected)">
                {{ review.changes.find((c) => c.path === selected)?.awaiting ? $t('review.reject') : $t('review.discard') }}
              </button>
              <button class="btn-primary text-xs" @click="review.approve(selected)">
                {{ review.changes.find((c) => c.path === selected)?.awaiting ? $t('review.approveWrite') : $t('review.approve') }}
              </button>
            </div>
            <div class="flex-1 panel-scroll font-mono text-xs leading-5 selectable">
              <template v-for="(line, i) in diff" :key="i">
                <div
                  v-if="line.type === 'skip'"
                  class="px-3 py-0.5 text-center text-fg-3 bg-bg-2/60 select-none"
                >{{ $t('review.unchangedLines', { n: line.count }) }}</div>
                <div
                  v-else
                  class="px-3 whitespace-pre-wrap"
                  :class="{
                    'bg-added/10 text-added': line.type === 'add',
                    'bg-removed/10 text-removed': line.type === 'del',
                    'text-fg-2': line.type === 'same',
                  }"
                >{{ (line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  ') + line.text }}</div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
