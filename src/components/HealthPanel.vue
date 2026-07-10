<script setup lang="ts">
import { watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useKbIndexStore } from '@/stores/kbIndex'
import { useFilesStore } from '@/stores/files'

const ui = useUiStore()
const index = useKbIndexStore()
const files = useFilesStore()

watch(
  () => ui.healthOpen,
  (open) => {
    if (open) void index.refresh()
  },
)

async function open(path: string): Promise<void> {
  ui.healthOpen = false
  ui.view = 'file'
  await files.openFile(path)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="ui.healthOpen"
      class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      @click.self="ui.healthOpen = false"
    >
      <div class="w-[560px] max-w-[90vw] max-h-[70vh] rounded-lg border border-border bg-bg-1 flex flex-col">
        <div class="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
          <span class="codicon codicon-pulse text-accent" />
          <h2 class="font-semibold text-fg-0 flex-1">KB health</h2>
          <button class="text-fg-3 hover:text-fg-0" @click="ui.healthOpen = false">
            <span class="codicon codicon-close" />
          </button>
        </div>

        <div class="panel-scroll p-4 space-y-5 text-sm">
          <section>
            <h3 class="text-xs uppercase tracking-wide text-fg-3 mb-2">
              Broken wikilinks ({{ index.health.brokenLinks.length }})
            </h3>
            <div v-if="!index.health.brokenLinks.length" class="text-fg-3">None 🎉</div>
            <div v-for="b in index.health.brokenLinks" :key="b.path" class="mb-1.5">
              <button class="text-accent hover:underline" @click="open(b.path)">{{ b.path }}</button>
              <span class="text-fg-2"> → </span>
              <span class="text-removed font-mono text-xs">{{ b.targets.join(', ') }}</span>
            </div>
          </section>

          <section>
            <h3 class="text-xs uppercase tracking-wide text-fg-3 mb-2">
              Orphan pages — no links in or out ({{ index.health.orphans.length }})
            </h3>
            <div v-if="!index.health.orphans.length" class="text-fg-3">None 🎉</div>
            <div v-for="p in index.health.orphans" :key="p">
              <button class="text-accent hover:underline" @click="open(p)">{{ p }}</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>
