<script setup lang="ts">
/**
 * The Help panel — the same `docs/app/` files the agent reads through
 * app_help, rendered for the user.
 *
 * One source, deliberately. A manual maintained separately from what the agent
 * knows is a manual that will eventually contradict it, and the user has no way
 * to tell which one is wrong. Here, asking in chat and reading the page give the
 * same answer because they are the same text.
 *
 * Contents → topic, one level. Deep hierarchy in a help system mostly hides
 * things; eleven topics fit on one screen.
 */
import { ref, computed, watch, nextTick } from 'vue'
import { useUiStore } from '@/stores/ui'
import { listAppDocs, appDoc } from '@/lib/appDocs'
import { renderMarkdown } from '@/lib/markdown'
import { getLocale } from '@/i18n'
import { FEEDBACK_URL } from '@/lib/links'

const ui = useUiStore()

const scroller = ref<HTMLElement | null>(null)

// getLocale() is reactive, so switching the interface language re-renders the
// open page in the other language rather than needing the panel reopened.
const topics = computed(() => listAppDocs(getLocale()))
const current = computed(() => (ui.helpTopic ? appDoc(ui.helpTopic, getLocale()) : undefined))

/** Cross-references are written as `topic-id` in the markdown; turning them
 *  into links is what makes the manual navigable rather than a list of files.
 *  Done on the rendered HTML so the code spans are already delimited. */
const html = computed(() => {
  if (!current.value) return ''
  const ids = new Set(topics.value.map((t) => t.id))
  // No wikilinks in these docs — the resolver exists to satisfy the renderer.
  const rendered = renderMarkdown(current.value.body, { resolve: () => null })
  return rendered.replace(
    /<code[^>]*>([a-z][a-z0-9-]*)<\/code>/g,
    (whole, id: string) =>
      ids.has(id)
        ? `<a href="#" data-help-topic="${id}" class="help-xref">${appDoc(id, getLocale())?.title ?? id}</a>`
        : whole,
  )
})

function go(topic: string | null): void {
  ui.helpTopic = topic
  void nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = 0
  })
}

/** Follow a cross-reference. The links are inside v-html, so there is no
 *  component to bind a handler to — one delegated listener covers them all. */
function onBodyClick(e: MouseEvent): void {
  const link = (e.target as HTMLElement).closest('[data-help-topic]')
  if (!link) return
  e.preventDefault()
  go(link.getAttribute('data-help-topic'))
}

// Opening from elsewhere (Settings, a keyboard shortcut) lands on a topic; the
// scroll reset belongs here rather than in every caller.
watch(
  () => ui.helpOpen,
  (open) => {
    if (open) void nextTick(() => scroller.value && (scroller.value.scrollTop = 0))
  },
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="ui.helpOpen"
      class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      @click.self="ui.helpOpen = false"
    >
      <div
        class="w-[760px] max-w-[95vw] h-[660px] max-h-[88vh] rounded-xl border border-border bg-bg-1 shadow-2xl flex flex-col overflow-hidden"
      >
        <!-- Header: back sits where the close button would be on the contents
             page, so the top-left is always "get me out of here". -->
        <div class="flex items-center gap-2 h-12 px-3 border-b border-border shrink-0">
          <button
            v-if="current"
            class="w-7 h-7 flex items-center justify-center rounded-md text-fg-3 hover:text-fg-0 hover:bg-bg-3 transition-colors"
            :title="$t('help.contents')"
            @click="go(null)"
          >
            <span class="codicon codicon-arrow-left" />
          </button>
          <span class="text-sm font-semibold text-fg-0 truncate">
            {{ current ? current.title : $t('help.title') }}
          </span>
          <span class="flex-1" />
          <button
            class="w-7 h-7 flex items-center justify-center rounded-md text-fg-3 hover:text-fg-0 hover:bg-bg-3 transition-colors"
            :title="$t('layout.closeEsc')"
            @click="ui.helpOpen = false"
          >
            <span class="codicon codicon-close" />
          </button>
        </div>

        <div ref="scroller" class="flex-1 min-h-0 overflow-y-auto panel-scroll">
          <!-- ── Contents ─────────────────────────────────────────────── -->
          <div v-if="!current" class="px-5 py-5">
            <p class="text-sm text-fg-2 leading-relaxed">{{ $t('help.intro') }}</p>

            <!-- The way out of the manual, before it rather than after it.
                 Someone opens Help because something is wrong; if the manual
                 does not cover it, the answer must not be at the bottom of a
                 list they would have to read first to find out it is not
                 there. -->
            <p class="mt-3 text-xs text-fg-3 leading-relaxed">
              {{ $t('help.feedbackIntro') }}
              <a :href="FEEDBACK_URL" target="_blank" rel="noopener noreferrer" class="text-accent hover:underline">
                {{ $t('help.feedbackLink') }}</a
              >{{ $t('help.feedbackOutro') }}
            </p>

            <div class="mt-4 rounded-lg border border-border divide-y divide-border overflow-hidden">
              <button
                v-for="t in topics"
                :key="t.id"
                class="w-full flex items-start gap-3 px-3.5 py-3 hover:bg-bg-2 text-left transition-colors"
                @click="go(t.id)"
              >
                <div class="min-w-0 flex-1">
                  <div class="text-sm text-fg-0">{{ t.title }}</div>
                  <p class="mt-0.5 text-xs text-fg-3 leading-relaxed">{{ t.summary }}</p>
                </div>
                <span class="codicon codicon-sm codicon-chevron-right text-fg-3 shrink-0 mt-1" />
              </button>
            </div>

          </div>

          <!-- ── One topic ────────────────────────────────────────────── -->
          <!-- eslint-disable-next-line vue/no-v-html -- our own bundled docs -->
          <div v-else class="md-preview help-doc px-6 py-5" @click="onBodyClick" v-html="html" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* The rendered doc opens with an <h1> repeating the title already in the header
   bar, and the header is what stays visible while scrolling. */
.help-doc :deep(h1:first-child) {
  display: none;
}
/* A cross-reference is a link, not the inline code it was written as. */
.help-doc :deep(.help-xref) {
  color: rgb(var(--c-accent));
  cursor: pointer;
}
.help-doc :deep(.help-xref:hover) {
  text-decoration: underline;
}
</style>
