<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useFilesStore } from '@/stores/files'
import { useKbIndexStore, type SearchHit } from '@/stores/kbIndex'
import { useCitationsStore } from '@/stores/citations'
import { baseName } from '@/lib/wiki'

const ui = useUiStore()
const files = useFilesStore()
const index = useKbIndexStore()
const citations = useCitationsStore()

const query = ref('')
const selected = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

interface Row {
  kind: 'file' | 'hit' | 'doc'
  path: string
  line?: number
  text?: string
  blockId?: string | null
  type?: string | null
}

// `type:foo` (or `type:"foo bar"`) filters results to that OKF concept type;
// the rest of the query is the usual filename/content search.
const TYPE_RE = /\btype:(?:"([^"]*)"|(\S+))/i
const parsed = computed(() => {
  const m = query.value.match(TYPE_RE)
  return {
    typeFilter: m ? (m[1] ?? m[2]).toLowerCase() : '',
    text: query.value.replace(TYPE_RE, '').trim(),
  }
})

const rows = computed<Row[]>(() => {
  const { typeFilter, text } = parsed.value
  let fileMatches: string[]
  let hits: SearchHit[]
  if (typeFilter) {
    const inType = (p: string) => (index.types.get(p) ?? '').toLowerCase().includes(typeFilter)
    if (text) {
      const r = index.search(text)
      fileMatches = r.files.filter(inType)
      hits = r.hits.filter((h) => inType(h.path))
    } else {
      // Type filter alone → list every page of that type.
      fileMatches = [...index.types.keys()].filter(inType).sort()
      hits = []
    }
  } else {
    const r = index.search(text)
    fileMatches = r.files
    hits = r.hits
  }
  return [
    ...fileMatches.map((path): Row => ({ kind: 'file', path, type: index.types.get(path) ?? null })),
    ...hits.map(
      (h): Row => ({
        kind: h.doc ? 'doc' : 'hit',
        path: h.path,
        line: h.line,
        text: h.text,
        blockId: h.blockId,
        type: index.types.get(h.path) ?? null,
      }),
    ),
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
  ui.graphOpen = false
  if (row.kind === 'doc') {
    // Jump straight to the matched passage inside the PDF/EPUB.
    await citations.openCitation(row.path, row.blockId ?? null)
    return
  }
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
          placeholder="Search files and content…  (type:foo to filter by concept type)"
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
              :class="{
                'codicon-markdown': row.kind === 'file',
                'codicon-search': row.kind === 'hit',
                'codicon-book': row.kind === 'doc',
              }"
            />
            <template v-if="row.kind === 'file'">
              <span class="truncate text-fg-0">{{ row.path }}</span>
            </template>
            <template v-else-if="row.kind === 'doc'">
              <span class="shrink-0 max-w-[140px] truncate text-fg-3 text-xs">
                {{ baseName(row.path) }}
              </span>
              <span class="truncate text-fg-2">{{ row.text }}</span>
            </template>
            <template v-else>
              <span class="shrink-0 text-fg-3 font-mono text-xs">{{ row.path }}:{{ row.line }}</span>
              <span class="truncate text-fg-2">{{ row.text }}</span>
            </template>
            <span
              v-if="row.type"
              class="ml-auto shrink-0 max-w-[110px] truncate rounded border px-1 text-[10px] leading-[1.4]"
              :style="{ color: index.colorFor(row.type), borderColor: index.colorFor(row.type) }"
            >
              {{ row.type }}
            </span>
          </button>
          <div v-if="query && !rows.length" class="px-4 py-3 text-sm text-fg-3">No results</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
