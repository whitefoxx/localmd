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
  ui.graphOpen = false
  await files.openFile(path)
}

/** Open the page in edit mode and jump to the broken link's location. */
async function revealBroken(path: string, target: string): Promise<void> {
  ui.healthOpen = false
  ui.graphOpen = false
  await files.openAndReveal(path, target)
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
          <p class="text-xs leading-relaxed text-fg-3">
            Structural checks over your wiki's link graph — page contents aren't read.
            Citations like <code class="rounded bg-bg-2 px-1 font-mono text-fg-2">[[1:b14-3]]</code>
            are ignored; only real page-to-page
            <code class="rounded bg-bg-2 px-1 font-mono text-fg-2">[[wikilinks]]</code> count.
          </p>

          <section>
            <h3 class="text-xs uppercase tracking-wide text-fg-3">
              Broken wikilinks ({{ index.health.brokenLinks.length }})
            </h3>
            <p class="mb-2 text-xs text-fg-3">
              These pages link to a target with no matching file. Click a target to jump to it in
              the page and fix or remove the link.
            </p>
            <div v-if="!index.health.brokenLinks.length" class="text-fg-3">None 🎉</div>
            <div v-for="b in index.health.brokenLinks" :key="b.path" class="mb-2">
              <button class="block text-left break-all text-accent hover:underline" @click="open(b.path)">
                {{ b.path }}
              </button>
              <div class="mt-1 flex flex-wrap gap-1">
                <button
                  v-for="t in b.targets"
                  :key="t"
                  class="rounded bg-removed/10 px-1 py-0.5 font-mono text-xs text-removed hover:bg-removed/20"
                  :title="`Jump to ${t} in ${b.path}`"
                  @click="revealBroken(b.path, t)"
                >
                  {{ t }}
                </button>
              </div>
            </div>
          </section>

          <section>
            <h3 class="text-xs uppercase tracking-wide text-fg-3">
              Orphan pages ({{ index.health.orphans.length }})
            </h3>
            <p class="mb-2 text-xs text-fg-3">
              Nothing links to them and they link nowhere — unreachable by navigation.
              Link them from a related page or an index.
            </p>
            <div v-if="!index.health.orphans.length" class="text-fg-3">None 🎉</div>
            <div v-for="p in index.health.orphans" :key="p">
              <button class="block text-left break-all text-accent hover:underline" @click="open(p)">{{ p }}</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>
