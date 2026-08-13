<script setup lang="ts">
/**
 * Table preview for CSV/TSV files. Renders the already-loaded editor text
 * (`files.content` — these files are `text` kind), so Edit and Preview always
 * show the same bytes. The first row is displayed as a sticky header — the
 * overwhelmingly common case — and very large files are cut off with a note
 * rather than rendered whole.
 */
import { computed } from 'vue'
import { useFilesStore } from '@/stores/files'
import { parseDelimited, sniffDelimiter } from '@/lib/csv'

const MAX_ROWS = 2000
const MAX_COLS = 200

const files = useFilesStore()

const table = computed(() => {
  const text = files.content
  const rows = parseDelimited(text, sniffDelimiter(text, files.currentPath ?? ''))
  while (rows.length && rows[rows.length - 1].every((f) => f === '')) rows.pop()
  const totalRows = rows.length
  const totalCols = rows.reduce((w, r) => Math.max(w, r.length), 0)
  const width = Math.min(totalCols, MAX_COLS)
  const shown = rows
    .slice(0, MAX_ROWS)
    .map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''))
  return {
    header: shown[0] ?? null,
    body: shown.slice(1),
    shownRows: shown.length,
    totalRows,
    rowsCut: totalRows > MAX_ROWS,
    colsCut: totalCols > MAX_COLS,
  }
})
</script>

<template>
  <div class="h-full panel-scroll">
    <div v-if="!table.header" class="h-full flex items-center justify-center text-fg-3 text-xs">
      {{ $t('viewers.csv.empty') }}
    </div>
    <template v-else>
      <div
        v-if="table.rowsCut || table.colsCut"
        class="px-4 py-1.5 text-xs text-fg-3 border-b border-border bg-bg-1"
      >
        {{
          table.rowsCut
            ? $t('viewers.csv.rowsCut', { shown: table.shownRows, total: table.totalRows })
            : $t('viewers.csv.colsCut')
        }}
      </div>
      <table class="text-xs border-collapse" style="font-variant-numeric: tabular-nums">
        <thead>
          <tr>
            <th class="csv-gutter sticky-header"></th>
            <th v-for="(cell, i) in table.header" :key="i" class="csv-cell sticky-header font-medium">
              {{ cell }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, r) in table.body" :key="r">
            <td class="csv-gutter">{{ r + 2 }}</td>
            <td v-for="(cell, c) in row" :key="c" class="csv-cell">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.csv-cell {
  border: 1px solid rgb(var(--c-border));
  padding: 0.25rem 0.6rem;
  text-align: left;
  white-space: pre-wrap;
  max-width: 24rem;
  vertical-align: top;
}
.csv-gutter {
  border: 1px solid rgb(var(--c-border));
  padding: 0.25rem 0.5rem;
  text-align: right;
  color: rgb(var(--c-fg-3));
  user-select: none;
  background: rgb(var(--c-bg-1));
}
.sticky-header {
  position: sticky;
  top: 0;
  background: rgb(var(--c-bg-1));
  z-index: 10;
}
</style>
