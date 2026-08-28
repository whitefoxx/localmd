<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useKbIndexStore } from '@/stores/kbIndex'
import { baseName } from '@/lib/wiki'
import { t } from '@/i18n'

const files = useFilesStore()
const index = useKbIndexStore()
const expanded = ref(true)
const relatedOpen = ref(true)

const links = computed(() =>
  files.currentPath ? index.backlinks(files.currentPath) : [],
)

/** What else this file belongs with. Rows carry their reason — "related" with
 *  nothing behind it is a guess the reader cannot check. */
const related = computed(() => {
  if (!files.currentPath) return []
  const r = index.related(files.currentPath)
  return [
    ...r.byTag.map((g) => ({
      path: g.path,
      why: t('backlinks.sharedTags', { list: g.shared.map((x) => `#${x}`).join(' ') }),
    })),
    ...r.bySource.map((g) => ({
      path: g.path,
      why: t('backlinks.sharedSources', { list: g.shared.map(baseName).join(', ') }),
    })),
  ]
})

watch(
  () => files.currentPath,
  () => void index.refresh(),
  { immediate: true },
)
</script>

<template>
  <div v-if="files.currentPath" class="border-t border-border shrink-0 flex flex-col min-h-0 max-h-[38%]">
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

    <!-- Related: shown only when there is something to say. An empty heading
         that is empty for most files is a heading people stop reading. -->
    <template v-if="related.length">
      <button
        class="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wide text-fg-3 hover:text-fg-1 shrink-0 border-t border-border"
        @click="relatedOpen = !relatedOpen"
      >
        <span
          class="codicon codicon-sm"
          :class="relatedOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'"
        />
        {{ $t('backlinks.relatedHeading', { n: related.length }) }}
      </button>
      <div v-if="relatedOpen" class="pb-2 overflow-auto panel-scroll min-h-0">
        <button
          v-for="r in related"
          :key="r.path"
          class="w-full text-left pl-6 pr-2 py-0.5 hover:bg-bg-2"
          @click="files.openFile(r.path)"
        >
          <div class="truncate text-sm text-fg-1">{{ r.path }}</div>
          <div class="truncate text-[11px] text-fg-3">{{ r.why }}</div>
        </button>
      </div>
    </template>
  </div>
</template>
