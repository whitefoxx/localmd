<script setup lang="ts">
/**
 * KB health: what the link graph alone can tell you about the wiki.
 *
 * Two findings, each its own card, and the card says three things in a fixed
 * order — what was checked, why it matters, and what it found. The title
 * carries the weight (it is the thing being scanned for) and the count sits
 * beside it as a badge, coloured only when there is something to do: a red 2
 * and a grey 0 are answers you can read without reading.
 */
import { computed, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useKbIndexStore } from '@/stores/kbIndex'
import { useFilesStore } from '@/stores/files'

const ui = useUiStore()
const index = useKbIndexStore()
const files = useFilesStore()

const broken = computed(() => index.health.brokenLinks)
const orphans = computed(() => index.health.orphans)

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
      <div
        class="w-[560px] max-w-[90vw] max-h-[70vh] rounded-lg border border-border bg-bg-1 shadow-xl flex flex-col"
      >
        <div class="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
          <span class="codicon codicon-pulse text-accent" />
          <h2 class="font-semibold text-fg-0 flex-1">{{ $t('health.title') }}</h2>
          <button class="text-fg-3 hover:text-fg-0" @click="ui.healthOpen = false">
            <span class="codicon codicon-close" />
          </button>
        </div>

        <div class="panel-scroll p-4 space-y-4 text-sm">
          <!-- What is and isn't counted. The two sample links explain
               themselves on hover — they are the whole vocabulary of this
               panel, and neither is obvious from its shape. Each card is
               positioned against the PARAGRAPH rather than its chip: a chip
               near the right edge would push its card past the panel, and the
               scroll container would cut it in half. -->
          <p class="relative text-xs leading-relaxed text-fg-3">
            {{ $t('health.introBefore') }}
            <span class="group inline-block">
              <code
                class="cursor-help rounded bg-bg-2 px-1 font-mono text-fg-2 decoration-dotted underline-offset-4 group-hover:underline"
                >[[1:b14-3]]</code
              >
              <span
                class="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-full rounded-md border border-border bg-bg-0 px-3 py-2 text-xs leading-relaxed text-fg-1 shadow-lg group-hover:block"
                >{{ $t('health.citationHint') }}</span
              >
            </span>
            {{ $t('health.introMiddle') }}
            <span class="group inline-block">
              <code
                class="cursor-help rounded bg-bg-2 px-1 font-mono text-fg-2 decoration-dotted underline-offset-4 group-hover:underline"
                >[[wikilinks]]</code
              >
              <span
                class="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-full rounded-md border border-border bg-bg-0 px-3 py-2 text-xs leading-relaxed text-fg-1 shadow-lg group-hover:block"
                >{{ $t('health.wikilinkHint') }}</span
              >
            </span>
            {{ $t('health.introAfter') }}
          </p>

          <!-- Broken wikilinks -->
          <section class="rounded-lg border border-border bg-bg-2/30 p-3">
            <div class="flex items-center gap-2">
              <span
                class="codicon codicon-sm shrink-0"
                :class="broken.length ? 'codicon-warning text-removed' : 'codicon-check text-added'"
              />
              <h3 class="flex-1 text-sm font-semibold text-fg-0">{{ $t('health.brokenHeading') }}</h3>
              <span
                class="rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
                :class="broken.length ? 'bg-removed/15 text-removed' : 'bg-bg-2 text-fg-3'"
              >{{ broken.length }}</span>
            </div>
            <p class="mt-1 text-xs leading-relaxed text-fg-3">{{ $t('health.brokenDesc') }}</p>

            <div v-if="!broken.length" class="mt-2 text-xs text-fg-3">{{ $t('health.allClear') }}</div>
            <ul v-else class="mt-2 space-y-1">
              <li v-for="b in broken" :key="b.path" class="rounded px-2 py-1.5 hover:bg-bg-2/70">
                <button class="group/row flex w-full items-center gap-1.5 text-left" @click="open(b.path)">
                  <span class="codicon codicon-sm codicon-file shrink-0 text-fg-3" />
                  <!-- The whole row is the target; the underline belongs to the
                       name alone. An underlined icon reads as a glitch. -->
                  <span class="break-all text-xs text-accent group-hover/row:underline">{{ b.path }}</span>
                </button>
                <div class="mt-1 flex flex-wrap gap-1 pl-5">
                  <button
                    v-for="t in b.targets"
                    :key="t"
                    class="rounded bg-removed/10 px-1.5 py-0.5 font-mono text-[11px] text-removed hover:bg-removed/20"
                    :title="$t('health.jumpTo', { target: t, path: b.path })"
                    @click="revealBroken(b.path, t)"
                  >
                    [[{{ t }}]]
                  </button>
                </div>
              </li>
            </ul>
          </section>

          <!-- Orphan pages -->
          <section class="rounded-lg border border-border bg-bg-2/30 p-3">
            <div class="flex items-center gap-2">
              <span
                class="codicon codicon-sm shrink-0"
                :class="orphans.length ? 'codicon-circle-slash text-fg-3' : 'codicon-check text-added'"
              />
              <h3 class="flex-1 text-sm font-semibold text-fg-0">{{ $t('health.orphansHeading') }}</h3>
              <span
                class="rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
                :class="orphans.length ? 'bg-bg-2 text-fg-2' : 'bg-bg-2 text-fg-3'"
              >{{ orphans.length }}</span>
            </div>
            <p class="mt-1 text-xs leading-relaxed text-fg-3">{{ $t('health.orphansDesc') }}</p>

            <div v-if="!orphans.length" class="mt-2 text-xs text-fg-3">{{ $t('health.allClear') }}</div>
            <ul v-else class="mt-2 space-y-0.5">
              <li v-for="p in orphans" :key="p">
                <button
                  class="group/row flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-bg-2/70"
                  @click="open(p)"
                >
                  <span class="codicon codicon-sm codicon-file shrink-0 text-fg-3" />
                  <span class="break-all text-xs text-accent group-hover/row:underline">{{ p }}</span>
                </button>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>
