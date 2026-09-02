<script setup lang="ts">
/**
 * What the graph says about the node you picked.
 *
 * Clicking a node used to leave the graph, which threw away the one thing it
 * was opened for — the neighbourhood being read. So a click now holds the node
 * instead, and this card answers "what is this page" beside the picture rather
 * than in place of it. Leaving is still one button, and now it is a decision
 * instead of a side effect of pointing at something.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useFilesStore } from '@/stores/files'
import { renderMarkdown } from '@/lib/markdown'
import { handleCodeCopy } from '@/lib/copyCode'
import { useKbImages } from '@/composables/useKbImages'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import { fileStem } from '@/lib/wiki'
import type { GraphPreview } from '@/lib/graphData'

const props = defineProps<{
  preview: GraphPreview
  canGoBack: boolean
  canLocate: boolean
  editing: boolean
  expanded: boolean
}>()
const emit = defineEmits<{
  /** Read a link's target here, without moving the graph. */
  (e: 'follow', path: string): void
  /** Undo the last follow. */
  (e: 'back'): void
  /** Aim the graph at this page — what clicking its node would have done. */
  (e: 'locate'): void
  /** Write in this file rather than read it. */
  (e: 'edit', path: string): void
  /** Stop writing. */
  (e: 'done'): void
  /** Take the frame, or give it back. */
  (e: 'resize'): void
  /** Leave the graph and open this file in the editor. */
  (e: 'open', path: string): void
  /** Search the knowledge base for this tag. */
  (e: 'search', tag: string): void
  /** Make this page the graph's pinned node — a drill-down that stays here. */
  (e: 'select', path: string): void
  (e: 'close'): void
}>()

const files = useFilesStore()
const body = ref<HTMLElement | null>(null)

/** What the card is about, as one string. The scroll reset and the attribute
 *  the tests read are the same question, so they ask it in one place. */
const subject = computed(() =>
  props.preview.kind === 'tag' ? `#${props.preview.tag}` : props.preview.path,
)

// A different page starts at its own top. Without this, following a link from
// halfway down a long note lands you halfway down the next one.
watch(subject, async () => {
  await nextTick()
  if (body.value) body.value.scrollTop = 0
})

const html = computed(() =>
  props.preview.kind === 'page' && props.preview.body
    ? renderMarkdown(props.preview.body, { resolve: (t) => files.resolveWikilink(t) })
    : '',
)

// Pictures stored in the KB. A note that is mostly a screenshot would otherwise
// preview as a column of empty boxes — the composable explains why the renderer
// cannot do this itself.
useKbImages(
  body,
  () => html.value,
  (href) =>
    props.preview.kind === 'page' ? files.resolveMarkdownLink(props.preview.path, href) : null,
)

/**
 * A link in the card is read in the card.
 *
 * One rule rather than a branch per kind of file: anything that resolves to a
 * real path in the folder becomes the card's next subject, and what the card
 * can say about it is the card's problem — a PDF says it has no text, and the
 * button below still opens it properly. A link naming nothing (a wikilink to a
 * page that does not exist) does nothing at all; offering to CREATE a page from
 * a preview would be the graph writing to the folder, which is not what looking
 * around is for.
 *
 * Citation chips stay inert. Following one is a jump into a document at a
 * paragraph — a reading action, not a page to glance at — so it belongs to the
 * editor, which is one button away.
 */
function onClick(e: MouseEvent): void {
  if (handleCodeCopy(e)) return
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  e.preventDefault()
  if (a.classList.contains('citation') || a.classList.contains('cite-source')) return
  if (a.classList.contains('wikilink')) {
    if (a.dataset.resolved === '1' && a.dataset.target) emit('follow', a.dataset.target)
    return
  }
  const href = a.getAttribute('href') ?? ''
  if (/^https?:\/\//.test(href)) {
    window.open(href, '_blank', 'noopener')
    return
  }
  const rel =
    props.preview.kind === 'page' ? files.resolveMarkdownLink(props.preview.path, href) : null
  if (rel) emit('follow', rel)
}
</script>

<template>
  <div
    class="pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-border bg-bg-1/95 shadow-2xl backdrop-blur"
    :data-preview="subject"
  >
    <div class="flex items-start gap-2 border-b border-border px-3 py-2">
      <!-- Only once there is somewhere to go back TO. A button that is always
           there but usually does nothing teaches you to stop reading it. -->
      <button
        v-if="canGoBack"
        class="shrink-0 text-fg-3 hover:text-fg-0"
        :title="$t('graph.previewBack')"
        @click="emit('back')"
      >
        <span class="codicon codicon-sm codicon-arrow-left" />
      </button>
      <span
        class="codicon codicon-sm mt-0.5 shrink-0"
        :class="
          preview.kind === 'tag'
            ? 'codicon-tag text-added'
            : preview.kind === 'binary'
              ? 'codicon-file-binary text-fg-3'
              : 'codicon-file text-accent'
        "
      />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-semibold text-fg-0">
          {{ preview.kind === 'tag' ? `#${preview.tag}` : preview.title }}
        </div>
        <div v-if="preview.kind !== 'tag'" class="truncate text-[11px] text-fg-3">
          {{ preview.path }}
        </div>
      </div>
      <!-- A page can be written in. A tag has no file, and a PDF has no text
           this could put a caret into — both are read here or nowhere. The
           glyphs and the words are the editor toolbar's, because it is the
           same switch: a second vocabulary for one idea is a second thing to
           learn. -->
      <button
        v-if="preview.kind === 'page'"
        class="shrink-0"
        :class="editing ? 'text-accent' : 'text-fg-3 hover:text-fg-0'"
        :title="editing ? $t('common.preview') : $t('common.edit')"
        @click="editing ? emit('done') : emit('edit', preview.path)"
      >
        <span
          class="codicon codicon-sm"
          :class="editing ? 'codicon-open-preview' : 'codicon-edit'"
        />
      </button>
      <button
        class="shrink-0 text-fg-3 hover:text-fg-0"
        :title="expanded ? $t('graph.previewShrink') : $t('graph.previewExpand')"
        @click="emit('resize')"
      >
        <span
          class="codicon codicon-sm"
          :class="expanded ? 'codicon-screen-normal' : 'codicon-screen-full'"
        />
      </button>
      <button
        class="shrink-0 text-fg-3 hover:text-fg-0"
        :title="$t('graph.previewClose')"
        @click="emit('close')"
      >
        <span class="codicon codicon-sm codicon-close" />
      </button>
    </div>

    <!-- The editor itself, not a lookalike. It takes no props: it binds to the
         open file, which `edit` has just made this one — so highlighting, live
         rendering, wikilink completion, image paste and the undo history are
         the ones you already know, and there is no second editor to keep in
         step with the real one. Two instances can be mounted at once (the main
         pane is still there under the graph); each ignores a document change
         that already matches its own, so they do not fight. -->
    <div v-if="editing && preview.kind === 'page'" class="min-h-0 flex-1 overflow-hidden">
      <MarkdownEditor />
    </div>
    <!-- Filling the window is for reading a whole page, so the column stops
         where a line stops being readable and the headings go back to the
         reading view's scale — `md-compact` exists for a 360px card. -->
    <div v-else ref="body" class="panel-scroll min-h-0 flex-1" @click="onClick">
      <div class="mx-auto w-full max-w-3xl px-3 py-2">
      <!-- A tag has no file to show, so it shows what carries it. Clicking one
           re-aims the graph at that page rather than leaving for it: you came
           here to look around, and the button below is what leaving is for. -->
      <template v-if="preview.kind === 'tag'">
        <p v-if="!preview.pages.length" class="py-4 text-center text-xs text-fg-3">
          {{ $t('graph.previewNoPages') }}
        </p>
        <ul v-else class="space-y-0.5">
          <li v-for="p in preview.pages" :key="p">
            <button
              class="w-full truncate rounded px-1.5 py-1 text-left text-xs text-fg-1 hover:bg-bg-2"
              :title="p"
              @click="emit('select', p)"
            >
              {{ fileStem(p) }}
            </button>
          </li>
        </ul>
      </template>

      <!-- Not text on disk: say so rather than rendering its bytes as mojibake.
           Opening it is still offered — the viewers know what to do with it. -->
      <p v-else-if="preview.kind === 'binary'" class="py-6 text-center text-xs text-fg-3">
        {{ $t('graph.previewBinary', { format: preview.format }) }}
      </p>

      <p v-else-if="!preview.body" class="py-6 text-center text-xs text-fg-3">
        {{ $t('graph.previewEmpty') }}
      </p>

      <template v-else>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="md-preview" :class="expanded ? '' : 'md-compact text-sm'" v-html="html" />
        <p v-if="preview.truncated" class="mt-3 border-t border-border pt-2 text-xs text-fg-3">
          {{ $t('graph.previewTruncated') }}
        </p>
      </template>
      </div>
    </div>

    <div
      v-if="editing"
      class="shrink-0 border-t border-border px-3 py-2 text-center text-xs text-fg-3"
    >
      {{ files.saveState === 'saved' ? $t('graph.previewSaved') : $t('graph.previewSaving') }}
    </div>
    <div v-else class="shrink-0 space-y-1.5 border-t border-border px-3 py-2">
      <!-- Only while this page is somewhere you cannot see. A dimmed node and
           its mark are drawn at an opacity that reads as absent, so "where is
           this" is a real question here and nowhere else. -->
      <button
        v-if="canLocate"
        class="btn w-full justify-center text-xs"
        @click="emit('locate')"
      >
        <span class="codicon codicon-sm codicon-target" />
        {{ $t('graph.previewLocate') }}
      </button>
      <button
        v-if="preview.kind === 'tag'"
        class="btn w-full justify-center text-xs"
        @click="emit('search', preview.tag)"
      >
        <span class="codicon codicon-sm codicon-search" />
        {{ $t('graph.previewSearchTag') }}
      </button>
      <button v-else class="btn w-full justify-center text-xs" @click="emit('open', preview.path)">
        <span class="codicon codicon-sm codicon-go-to-file" />
        {{ $t('graph.previewOpen') }}
      </button>
    </div>
  </div>
</template>
