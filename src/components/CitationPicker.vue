<script setup lang="ts">
/**
 * The question a citation click could not answer for itself.
 *
 * Block ids are per-document names — every book has a `b10-62` — so when a
 * chip carries no declared source, the id alone can point at several documents
 * at once. Taking the first was how a note about Han-dynasty salt policy
 * opened a book about undergraduate mathematics: silently, plausibly, and
 * wrong. Nothing here guesses; it shows what the id actually matches, with the
 * passage each one holds, and lets the reader say which they meant.
 *
 * The other state is the empty one: the id matches nothing that still exists,
 * or a declared file is no longer in the folder. That used to open a tab onto
 * a missing path. Saying so is shorter and true.
 */
import { computed } from 'vue'
import { useCitationsStore } from '@/stores/citations'
import { useKbIndexStore } from '@/stores/kbIndex'

const citations = useCitationsStore()
const kbIndex = useKbIndexStore()

const shown = computed(() => citations.unresolved)

/** Longest quote a row carries — enough to recognise the passage, not so much
 *  that the list stops being scannable. */
const MAX_QUOTE = 180

interface Row {
  path: string
  name: string
  quote: string | null
}

const rows = computed<Row[]>(() =>
  (shown.value?.paths ?? []).map((path) => {
    const quote = kbIndex.blockText(shown.value!.blockId, path)
    return {
      path,
      name: path.split('/').pop() ?? path,
      quote: quote && quote.length > MAX_QUOTE ? `${quote.slice(0, MAX_QUOTE)}…` : quote,
    }
  }),
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="shown"
      class="fixed inset-0 z-50 bg-black/50 flex justify-center pt-[12vh]"
      @click.self="citations.dismissUnresolved()"
    >
      <div
        data-citation-picker
        class="w-[560px] max-w-[90vw] h-fit max-h-[70vh] rounded-lg border border-border bg-bg-1 flex flex-col overflow-hidden"
      >
        <div class="px-4 py-3 border-b border-border">
          <p class="text-sm text-fg-1">
            {{ rows.length ? $t('citations.pickTitle', { id: shown.blockId }) : $t('citations.goneTitle') }}
          </p>
          <p class="mt-1 text-xs text-fg-3 leading-relaxed">
            {{
              rows.length
                ? $t('citations.pickBody', { n: rows.length })
                : shown.declared
                  ? $t('citations.goneDeclared', { path: shown.declared })
                  : $t('citations.goneBody', { id: shown.blockId })
            }}
          </p>
        </div>

        <div v-if="rows.length" class="panel-scroll">
          <button
            v-for="row in rows"
            :key="row.path"
            class="w-full text-left px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-bg-2"
            @click="citations.resolveTo(row.path)"
          >
            <span class="block text-sm text-fg-1 truncate" :title="row.path">{{ row.name }}</span>
            <span v-if="row.quote" class="mt-0.5 block text-xs text-fg-3 leading-relaxed">
              {{ row.quote }}
            </span>
          </button>
        </div>

        <div class="px-4 py-2.5 flex justify-end border-t border-border">
          <button class="btn text-xs" @click="citations.dismissUnresolved()">
            {{ $t('common.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
