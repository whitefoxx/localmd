<script setup lang="ts">
/**
 * The delete question: what is about to go, itemised, with each row still
 * yours to take back out.
 *
 * It exists because the native `confirm` it replaced could not show a list.
 * Two clicks in the file tree select every top-level entry, and a sentence
 * saying "Delete these 4 items?" over `raw/` and `wiki/` is telling the truth
 * in a shape that reads as four files. Here the folders are the loud rows —
 * their own icon, their own tint, and the number of files they are carrying —
 * because a folder is the only row whose name understates it.
 *
 * Everything defaults to ticked, so the ordinary case is one click. Escape,
 * the backdrop and ✕ all cancel, and cancel means nothing is deleted — see
 * `lib/confirmDelete` for why an unanswerable question has to count as no.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  pendingDelete,
  registerDeleteDialog,
  settleDelete,
  type DeleteCandidate,
} from '@/lib/confirmDelete'

let unregister: (() => void) | null = null
onMounted(() => (unregister = registerDeleteDialog()))
onBeforeUnmount(() => unregister?.())

/** Paths the user has left ticked. Rebuilt whenever a new question opens, so
 *  a row unticked last time does not stay unticked in the next batch. */
const ticked = ref(new Set<string>())
/**
 * The panel takes focus when a question opens.
 *
 * Two reasons, and the second is the important one. Escape is handled on the
 * panel, and a keydown only reaches it if the focus is inside — a modal whose
 * Escape depends on the user having clicked something first is a modal with no
 * way out. And the focus lands on the panel rather than on a button, so the
 * space bar and Enter arrive at nothing: the destructive action in this dialog
 * is reachable only by aiming at it.
 */
const panel = ref<HTMLElement | null>(null)
watch(
  pendingDelete,
  (req) => {
    ticked.value = new Set(req?.candidates.map((c) => c.path) ?? [])
    if (req) void nextTick(() => panel.value?.focus())
  },
  { immediate: true },
)

const candidates = computed<DeleteCandidate[]>(() => pendingDelete.value?.candidates ?? [])
const picked = computed(() => candidates.value.filter((c) => ticked.value.has(c.path)))
/** Folders are the rows worth counting separately — the summary the old
 *  one-line confirm could not fit. */
const pickedDirs = computed(() => picked.value.filter((c) => c.isDir))
const pickedInside = computed(() => pickedDirs.value.reduce((n, c) => n + c.files, 0))

function toggle(path: string): void {
  const next = new Set(ticked.value)
  if (!next.delete(path)) next.add(path)
  ticked.value = next
}

function name(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
/** The folders above a row, shown small in front of the name — two files
 *  called `index.md` are only told apart by where they live. */
function parent(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : `${path.slice(0, i)}/`
}

function cancel(): void {
  settleDelete([])
}
function confirm(): void {
  if (picked.value.length) settleDelete(picked.value)
}

/** Escape cancels. Enter deliberately does not confirm: this is the one dialog
 *  in the app where the key you press by reflex must not be the destructive
 *  one. */
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  cancel()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="pendingDelete"
      class="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4"
      @click.self="cancel"
      @keydown="onKey"
    >
      <div
        ref="panel"
        tabindex="-1"
        class="relative flex max-h-[80vh] w-[520px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-border bg-bg-1 shadow-2xl outline-none"
      >
        <div class="flex items-center gap-2 border-b border-border px-4 py-3">
          <span class="codicon codicon-sm codicon-trash text-removed" />
          <span class="text-sm font-medium text-fg-1">{{ $t('files.deleteTitle') }}</span>
          <button
            class="ml-auto flex h-6 w-6 items-center justify-center rounded text-fg-3 hover:bg-bg-2 hover:text-fg-1"
            :title="$t('common.close')"
            @click="cancel"
          >
            <span class="codicon codicon-sm codicon-close" />
          </button>
        </div>

        <p class="px-4 pt-3 text-sm text-fg-2">{{ $t('files.deleteLead') }}</p>

        <!-- The list. Scrolls rather than truncating: a batch of forty is
             exactly the batch whose contents you most need to be able to read. -->
        <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <label
            v-for="c in candidates"
            :key="c.path"
            class="flex cursor-pointer select-none items-center gap-2.5 rounded px-2 py-1.5 hover:bg-bg-2"
          >
            <input
              type="checkbox"
              class="h-4 w-4 shrink-0 accent-[rgb(var(--c-removed))]"
              :checked="ticked.has(c.path)"
              @change="toggle(c.path)"
            />
            <span
              class="codicon codicon-sm shrink-0"
              :class="c.isDir ? 'codicon-folder text-removed' : 'codicon-file text-fg-3'"
            />
            <span class="min-w-0 flex-1 truncate text-sm" :title="c.path">
              <span v-if="parent(c.path)" class="text-fg-3">{{ parent(c.path) }}</span>
              <span :class="c.isDir ? 'font-medium text-fg-0' : 'text-fg-1'">{{ name(c.path) }}</span>
              <span v-if="c.isDir" class="text-fg-3">/</span>
            </span>
            <!-- A folder's name is the one label in this list that understates
                 what is behind it, so it carries the number itself. -->
            <span
              v-if="c.isDir"
              class="shrink-0 rounded bg-removed/15 px-1.5 py-0.5 text-xs font-medium text-removed"
            >
              {{ c.files ? $t('files.nFiles', { n: c.files }) : $t('files.emptyFolder') }}
            </span>
          </label>
        </div>

        <div class="border-t border-border px-4 py-3">
          <p class="text-xs text-fg-3">
            {{
              pickedDirs.length
                ? $t('files.deleteSummaryFolders', {
                    n: picked.length,
                    dirs: pickedDirs.length,
                    files: pickedInside,
                  })
                : $t('files.deleteSummary', { n: picked.length })
            }}
          </p>
          <div class="mt-2.5 flex justify-end gap-2">
            <button class="btn text-sm" @click="cancel">{{ $t('common.cancel') }}</button>
            <button
              class="rounded-md bg-removed px-3 py-1.5 text-sm font-medium text-bg-0 disabled:opacity-40"
              :disabled="!picked.length"
              @click="confirm"
            >
              {{ $t('files.deleteConfirmButton', { n: picked.length }) }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
