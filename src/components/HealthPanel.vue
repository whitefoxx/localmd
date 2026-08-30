<script setup lang="ts">
/**
 * KB health: what the link graph alone can tell you about the wiki.
 *
 * One finding per card, and the card says three things in a fixed order —
 * what was checked, why it matters, and what it found. The title carries the
 * weight (it is the thing being scanned for) and the count sits beside it as a
 * badge, coloured only when there is something to do: a red 2 and a grey 0 are
 * answers you can read without reading.
 *
 * What earns a card is a finding with something to DO about it. The rest of
 * `computeLint` reaches the agent through kb_health and stops there — a panel
 * that listed every check would be a list to scroll past, not to act on.
 */
import { computed, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useKbIndexStore } from '@/stores/kbIndex'
import { useFilesStore } from '@/stores/files'
import { openInEditor, revealEditor } from '@/lib/openInEditor'
import { t } from '@/i18n'

const ui = useUiStore()
const index = useKbIndexStore()
const files = useFilesStore()

const broken = computed(() => index.health.brokenLinks)
const orphans = computed(() => index.health.orphans)
/** Documents nothing cites — the whole-KB form of the viewer's badge. */
const unread = computed(() => index.sourcesWithoutNote)
/** Indexes whose document has left the folder. They keep answering to its
 *  block ids, so a citation into a book that is gone still looks alive. */
const stale = computed(() => index.staleIndexes)
/** Pages whose citations name a source number the page never declares. */
const undeclared = computed(() => index.undeclaredCitations)

/** Hand the batch to the agent as an editable draft. Reading a pile of PDFs
 *  is the expensive kind of run, so this only ever drafts: the prompt asks
 *  for a plan first and caps the first batch, and the user still has to send
 *  it. */
function writeNotes(): void {
  ui.healthOpen = false
  ui.agentOpen = true
  ui.pendingPrompt = t('health.unreadPrompt', {
    list: unread.value.map((p) => `- ${p}`).join('\n'),
  })
}

/** Hand the repair to the agent as a draft, like the unread batch above: what
 *  to do differs per entry — a renamed document can have its ids recovered, a
 *  deleted one only cleaned up — and both end in an action the user approves
 *  anyway. Drafting says which is which and lets them send it. */
function fixStale(): void {
  ui.healthOpen = false
  ui.agentOpen = true
  ui.pendingPrompt = t('health.stalePrompt', {
    list: stale.value
      .map((s) =>
        s.renamedTo
          ? `- ${s.dir} — built from ${s.source}, which is now ${s.renamedTo}`
          : `- ${s.dir} — built from ${s.source}, which is gone`,
      )
      .join('\n'),
  })
}

/** Drafts the repair: each page gets the declaration its own links imply, and
 *  the ones nothing implies are handed back as a question rather than filled
 *  in with a guess. */
function declareSources(): void {
  ui.healthOpen = false
  ui.agentOpen = true
  ui.pendingPrompt = t('health.undeclaredPrompt', {
    list: undeclared.value
      .map((u) =>
        u.suggested.length
          ? `- ${u.path} — add ${u.suggested.map((x) => `[[${x.source.kind}${x.num}:${x.source.path}]]`).join(', ')}`
          : `- ${u.path} — cites ${u.numbers.map((n) => `[[${n}:…]]`).join(', ')}, source unknown`,
      )
      .join('\n'),
  })
}

watch(
  () => ui.healthOpen,
  (open) => {
    if (open) void index.refresh()
  },
)

async function open(path: string): Promise<void> {
  ui.healthOpen = false
  ui.graphOpen = false
  await openInEditor(path)
}

/** Straight to the scan-scope list — the panel's own "why is this here?". */
function openScope(): void {
  ui.healthOpen = false
  ui.openSettings('health')
}

/** Open the page in edit mode and jump to the broken link's location. */
async function revealBroken(path: string, target: string): Promise<void> {
  ui.healthOpen = false
  ui.graphOpen = false
  await files.openAndReveal(path, target)
  revealEditor()
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
          <!-- What is being scanned is a setting, and "why is this file not
               listed / why is that one" is asked here rather than there. -->
          <button
            class="text-fg-3 hover:text-fg-0"
            :title="$t('health.editScope')"
            @click="openScope()"
          >
            <span class="codicon codicon-settings-gear" />
          </button>
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
                  <!-- text-left: a button centres its text, and a long link
                       target wraps onto two ragged centred lines that read as a
                       heading rather than as a path. -->
                  <button
                    v-for="t in b.targets"
                    :key="t"
                    class="rounded bg-removed/10 px-1.5 py-0.5 text-left font-mono text-[11px] text-removed hover:bg-removed/20"
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

          <!-- Documents with no note. Not a defect — a backlog: the same test
               the viewer's badge makes, asked of the whole KB. -->
          <section class="rounded-lg border border-border bg-bg-2/30 p-3">
            <div class="flex items-center gap-2">
              <span
                class="codicon codicon-sm shrink-0"
                :class="unread.length ? 'codicon-book text-fg-3' : 'codicon-check text-added'"
              />
              <h3 class="flex-1 text-sm font-semibold text-fg-0">{{ $t('health.unreadHeading') }}</h3>
              <span class="rounded-full bg-bg-2 px-2 py-0.5 text-[11px] font-medium tabular-nums text-fg-2">
                {{ unread.length }}
              </span>
            </div>
            <p class="mt-1 text-xs leading-relaxed text-fg-3">{{ $t('health.unreadDesc') }}</p>

            <div v-if="!unread.length" class="mt-2 text-xs text-fg-3">{{ $t('health.allClear') }}</div>
            <template v-else>
              <ul class="mt-2 space-y-1">
                <li v-for="p in unread" :key="p" class="rounded px-2 py-1.5 hover:bg-bg-2/70">
                  <button class="group/row flex w-full items-center gap-1.5 text-left" @click="open(p)">
                    <span class="codicon codicon-sm codicon-file-pdf shrink-0 text-fg-3" />
                    <span class="break-all text-xs text-accent group-hover/row:underline">{{ p }}</span>
                  </button>
                </li>
              </ul>
              <button class="btn mt-3 text-xs" @click="writeNotes">
                <span class="codicon codicon-sm codicon-edit" />
                {{ $t('health.unreadAction') }}
              </button>
            </template>
          </section>

          <!-- Indexes outliving their document. Not a defect in the notes —
               a leftover of ours: the directory keeps answering to block ids
               for a file nobody can open. -->
          <section class="rounded-lg border border-border bg-bg-2/30 p-3">
            <div class="flex items-center gap-2">
              <span
                class="codicon codicon-sm shrink-0"
                :class="stale.length ? 'codicon-warning text-removed' : 'codicon-check text-added'"
              />
              <h3 class="flex-1 text-sm font-semibold text-fg-0">{{ $t('health.staleHeading') }}</h3>
              <span
                class="rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
                :class="stale.length ? 'bg-removed/15 text-removed' : 'bg-bg-2 text-fg-3'"
              >{{ stale.length }}</span>
            </div>
            <p class="mt-1 text-xs leading-relaxed text-fg-3">{{ $t('health.staleDesc') }}</p>

            <div v-if="!stale.length" class="mt-2 text-xs text-fg-3">{{ $t('health.allClear') }}</div>
            <template v-else>
              <ul class="mt-2 space-y-1">
                <li v-for="s in stale" :key="s.dir" class="rounded px-2 py-1.5">
                  <span class="block break-all text-xs text-fg-2">{{ s.source }}</span>
                  <span class="mt-0.5 block text-[11px] text-fg-3">
                    {{
                      s.renamedTo
                        ? $t('health.staleRenamed', { path: s.renamedTo })
                        : $t('health.staleGone')
                    }}
                  </span>
                </li>
              </ul>
              <button class="btn mt-3 text-xs" @click="fixStale">
                <span class="codicon codicon-sm codicon-tools" />
                {{ $t('health.staleAction') }}
              </button>
            </template>
          </section>

          <!-- Citations that name a number the page never defines. Quiet,
               because they look exactly like the precise kind. -->
          <section class="rounded-lg border border-border bg-bg-2/30 p-3">
            <div class="flex items-center gap-2">
              <span
                class="codicon codicon-sm shrink-0"
                :class="undeclared.length ? 'codicon-question text-fg-3' : 'codicon-check text-added'"
              />
              <h3 class="flex-1 text-sm font-semibold text-fg-0">
                {{ $t('health.undeclaredHeading') }}
              </h3>
              <span class="rounded-full bg-bg-2 px-2 py-0.5 text-[11px] font-medium tabular-nums text-fg-2">
                {{ undeclared.length }}
              </span>
            </div>
            <p class="mt-1 text-xs leading-relaxed text-fg-3">{{ $t('health.undeclaredDesc') }}</p>

            <div v-if="!undeclared.length" class="mt-2 text-xs text-fg-3">
              {{ $t('health.allClear') }}
            </div>
            <template v-else>
              <ul class="mt-2 space-y-1">
                <li v-for="u in undeclared" :key="u.path" class="rounded px-2 py-1.5 hover:bg-bg-2/70">
                  <button class="group/row flex w-full items-center gap-1.5 text-left" @click="open(u.path)">
                    <span class="codicon codicon-sm codicon-file shrink-0 text-fg-3" />
                    <span class="break-all text-xs text-accent group-hover/row:underline">{{ u.path }}</span>
                  </button>
                  <span class="mt-0.5 block break-all text-[11px] text-fg-3">
                    {{
                      u.suggested.length
                        ? $t('health.undeclaredSuggest', { path: u.suggested[0].source.path })
                        : $t('health.undeclaredUnknown')
                    }}
                  </span>
                </li>
              </ul>
              <button class="btn mt-3 text-xs" @click="declareSources">
                <span class="codicon codicon-sm codicon-edit" />
                {{ $t('health.undeclaredAction') }}
              </button>
            </template>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>
