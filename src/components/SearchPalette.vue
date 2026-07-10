<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useFilesStore } from '@/stores/files'
import { useKbIndexStore } from '@/stores/kbIndex'

const ui = useUiStore()
const files = useFilesStore()
const index = useKbIndexStore()

const query = ref('')
const selected = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

interface Row {
  kind: 'file' | 'hit'
  path: string
  line?: number
  text?: string
}

const rows = computed<Row[]>(() => {
  const { files: fileMatches, hits } = index.search(query.value)
  return [
    ...fileMatches.map((path): Row => ({ kind: 'file', path })),
    ...hits.map((h): Row => ({ kind: 'hit', path: h.path, line: h.line, text: h.text })),
  ].slice(0, 60)
})

watch(rows, () => (selected.value = 0))

watch(
  () => ui.searchOpen,
  async (open) => {
    if (open) {
      query.value = ''
      void index.refresh()
      await nextTick()
      inputEl.value?.focus()
    }
  },
)

async function pick(row: Row | undefined): Promise<void> {
  if (!row) return
  ui.searchOpen = false
  ui.view = 'file'
  await files.openFile(row.path)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    ui.searchOpen = false
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    selected.value = Math.min(selected.value + 1, rows.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selected.value = Math.max(selected.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    void pick(rows.value[selected.value])
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="ui.searchOpen"
      class="fixed inset-0 z-50 bg-black/50 flex justify-center pt-[12vh]"
      @click.self="ui.searchOpen = false"
    >
      <div class="w-[560px] max-w-[90vw] h-fit max-h-[70vh] rounded-lg border border-border bg-bg-1 flex flex-col overflow-hidden">
        <input
          ref="inputEl"
          v-model="query"
          class="px-4 py-3 bg-transparent text-fg-0 placeholder-fg-3 focus:outline-none border-b border-border"
          placeholder="Search files and content…"
          @keydown="onKeydown"
        />
        <div class="panel-scroll">
          <button
            v-for="(row, i) in rows"
            :key="`${row.kind}:${row.path}:${row.line ?? ''}`"
            class="w-full text-left px-4 py-1.5 flex items-center gap-2 text-sm"
            :class="i === selected ? 'bg-bg-2' : 'hover:bg-bg-2/50'"
            @click="pick(row)"
            @mousemove="selected = i"
          >
            <span
              class="codicon codicon-sm shrink-0 text-fg-3"
              :class="row.kind === 'file' ? 'codicon-markdown' : 'codicon-search'"
            />
            <template v-if="row.kind === 'file'">
              <span class="truncate text-fg-0">{{ row.path }}</span>
            </template>
            <template v-else>
              <span class="shrink-0 text-fg-3 font-mono text-xs">{{ row.path }}:{{ row.line }}</span>
              <span class="truncate text-fg-2">{{ row.text }}</span>
            </template>
          </button>
          <div v-if="query && !rows.length" class="px-4 py-3 text-sm text-fg-3">No results</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
