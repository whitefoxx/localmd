<script setup lang="ts">
/**
 * Read-only preview for Excel workbooks: one tab per sheet, values as the
 * cells would display them (shared strings, cached formula results, dates).
 * The extractor is imported on demand — most sessions never open a workbook.
 * Legacy binary .xls opens here too, and says so.
 */
import { ref, computed, watch } from 'vue'
import { useFilesStore } from '@/stores/files'
import * as fs from '@/lib/fs'
import { fileKind } from '@/lib/filetypes'
import { t } from '@/i18n'
import type { SheetTable } from '@/lib/xlsx'

const MAX_ROWS = 2000
const MAX_COLS = 200

const files = useFilesStore()
const sheets = ref<SheetTable[]>([])
const active = ref(0)
const loading = ref(false)
const error = ref('')
const legacy = ref(false)

/** Guards against an earlier, slower load overwriting a later one. */
let loadToken = 0

async function load(path: string | null): Promise<void> {
  const token = ++loadToken
  sheets.value = []
  active.value = 0
  error.value = ''
  legacy.value = false
  if (!path || fileKind(path) !== 'sheet') return
  loading.value = true
  try {
    const [{ extractXlsx, LegacyXlsError }, bytes] = await Promise.all([
      import('@/lib/xlsx'),
      fs.readBinary(path),
    ])
    if (token !== loadToken) return
    try {
      const result = await extractXlsx(bytes)
      if (token !== loadToken) return
      sheets.value = result.sheets
    } catch (err) {
      if (err instanceof LegacyXlsError) legacy.value = true
      else throw err
    }
  } catch (err) {
    if (token === loadToken) error.value = (err as Error).message || t('viewers.sheet.loadFailed')
  } finally {
    if (token === loadToken) loading.value = false
  }
}

const view = computed(() => {
  const s = sheets.value[active.value]
  if (!s) return null
  const totalRows = s.rows.length
  const totalCols = s.rows.reduce((w, r) => Math.max(w, r.length), 0)
  const width = Math.min(totalCols, MAX_COLS)
  const rows = s.rows
    .slice(0, MAX_ROWS)
    .map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''))
  return {
    rows,
    width,
    totalRows,
    cut: totalRows > MAX_ROWS || totalCols > MAX_COLS || s.clipped,
  }
})

/** 0 → 'A', 26 → 'AA' — the spreadsheet column label. */
function colLetter(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    s = String.fromCharCode(64 + ((n - 1) % 26) + 1) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

watch(() => files.currentPath, load, { immediate: true })
</script>

<template>
  <div class="h-full flex flex-col">
    <div v-if="loading" class="flex-1 flex items-center justify-center gap-2 text-sm text-fg-3">
      <span class="codicon codicon-sm codicon-loading codicon-modifier-spin" />
      {{ $t('viewers.sheet.loading') }}
    </div>

    <div v-else-if="legacy" class="flex-1 flex items-center justify-center text-fg-3">
      <div class="text-center max-w-md px-6">
        <span class="codicon codicon-lg codicon-file block mb-2" />
        <div class="text-fg-1 mb-1">{{ $t('viewers.sheet.legacyTitle') }}</div>
        <p class="text-xs leading-relaxed">{{ $t('viewers.sheet.legacyHint') }}</p>
      </div>
    </div>

    <div v-else-if="error" class="flex-1 flex items-center justify-center text-fg-3">
      <div class="text-center max-w-md px-6">
        <span class="codicon codicon-lg codicon-warning block mb-2" />
        <p class="text-xs leading-relaxed">{{ error }}</p>
      </div>
    </div>

    <template v-else-if="sheets.length">
      <div
        v-if="sheets.length > 1"
        class="flex gap-1 px-3 py-1.5 border-b border-border overflow-x-auto shrink-0"
      >
        <button
          v-for="(s, i) in sheets"
          :key="i"
          class="px-2 py-0.5 rounded text-xs whitespace-nowrap"
          :class="i === active ? 'bg-bg-2 text-fg-1 font-medium' : 'text-fg-3 hover:text-fg-1'"
          @click="active = i"
        >
          {{ s.name }}
        </button>
      </div>

      <div class="flex-1 min-h-0 panel-scroll">
        <div
          v-if="view?.cut"
          class="px-4 py-1.5 text-xs text-fg-3 border-b border-border bg-bg-1"
        >
          {{ $t('viewers.sheet.cut', { shown: view.rows.length, total: view.totalRows }) }}
        </div>
        <div
          v-if="!view?.rows.length"
          class="h-full flex items-center justify-center text-fg-3 text-xs"
        >
          {{ $t('viewers.sheet.empty') }}
        </div>
        <table
          v-else
          class="text-xs border-collapse"
          style="font-variant-numeric: tabular-nums"
        >
          <thead>
            <tr>
              <th class="sheet-gutter sheet-sticky"></th>
              <th
                v-for="i in view.width"
                :key="i"
                class="sheet-cell sheet-sticky text-center font-medium text-fg-3"
              >
                {{ colLetter(i - 1) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, r) in view.rows" :key="r">
              <td class="sheet-gutter">{{ r + 1 }}</td>
              <td v-for="(cell, c) in row" :key="c" class="sheet-cell">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sheet-cell {
  border: 1px solid rgb(var(--c-border));
  padding: 0.25rem 0.6rem;
  text-align: left;
  white-space: pre-wrap;
  max-width: 24rem;
  vertical-align: top;
}
.sheet-gutter {
  border: 1px solid rgb(var(--c-border));
  padding: 0.25rem 0.5rem;
  text-align: right;
  color: rgb(var(--c-fg-3));
  user-select: none;
  background: rgb(var(--c-bg-1));
}
.sheet-sticky {
  position: sticky;
  top: 0;
  background: rgb(var(--c-bg-1));
  z-index: 10;
}
</style>
