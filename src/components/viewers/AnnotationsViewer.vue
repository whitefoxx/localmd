<script setup lang="ts">
/**
 * Rendered view of a `*.annotations.json` sidecar — the sole way these open
 * (there is no raw-JSON toggle). Cards show each mark's category, excerpt and
 * comment; clicking one jumps to its position in the book. Edits go through the
 * files store buffer (`files.content`), which is ALSO what this view reads —
 * one source of truth, so the list can never disagree with what's on disk.
 *
 * Editing: mutate a clone of the parsed JSON (preserving fields we don't model),
 * push it back via files.onEdited + flush, then signal live viewers through
 * notifySidecarChanged (PDFs stay mounted across tab switches).
 */
import { ref, computed } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { fileKind } from '@/lib/filetypes'
import {
  HIGHLIGHT_COLORS,
  annotationSource,
  isAnnotationsPath,
  buildAnnotationItems,
  notifySidecarChanged,
  type AnnotationItem,
  type AnnotationCategory,
} from '@/lib/annotations'
import { t } from '@/i18n'

const files = useFilesStore()
const citations = useCitationsStore()

const sidecar = computed(() =>
  files.currentPath && isAnnotationsPath(files.currentPath) ? files.currentPath : null,
)
const source = computed(() => (sidecar.value ? annotationSource(sidecar.value) : null))
const kind = computed(() => (source.value ? fileKind(source.value) : null))
const sourceName = computed(() => source.value?.slice(source.value.lastIndexOf('/') + 1) ?? '')
const sourceExists = computed(() => !!source.value && files.allFiles.includes(source.value))

/** The sidecar's parsed JSON — read from the store buffer, so it always matches
 *  Raw. null when the buffer isn't valid JSON (mid-write / corrupt). */
const parsed = computed<{ annotations?: unknown[] } | null>(() => {
  if (!sidecar.value) return null
  try {
    return JSON.parse(files.content) as { annotations?: unknown[] }
  } catch {
    return null
  }
})

const items = computed<AnnotationItem[]>(() =>
  source.value && Array.isArray(parsed.value?.annotations)
    ? buildAnnotationItems(source.value, parsed.value!.annotations!)
    : [],
)

/** Reactive category label — reads i18n so it re-renders on language change. */
function categoryName(category: AnnotationCategory): string {
  return t(`viewers.annotations.category.${category}`)
}
function categoryLabel(it: AnnotationItem): string {
  return it.category === 'other' ? it.typeLabel : categoryName(it.category)
}

/** Header summary: how many of each category. */
const counts = computed(() => {
  const c: Record<AnnotationCategory, number> = { highlight: 0, underline: 0, note: 0, other: 0 }
  for (const it of items.value) c[it.category]++
  return (['highlight', 'underline', 'note', 'other'] as AnnotationCategory[])
    .filter((k) => c[k])
    .map((k) => ({ label: categoryName(k), n: c[k] }))
})

/** PDF groups by page; EPUB is one flat list in reading order. */
const groups = computed<{ label: string; items: AnnotationItem[] }[]>(() => {
  if (kind.value !== 'pdf') return items.value.length ? [{ label: '', items: items.value }] : []
  const out: { label: string; items: AnnotationItem[] }[] = []
  for (const it of items.value) {
    const label = t('viewers.annotations.page', { page: it.page ?? '' })
    const last = out[out.length - 1]
    if (last?.label === label) last.items.push(it)
    else out.push({ label, items: [it] })
  }
  return out
})

/* ───────── navigation ───────── */

function openSource(): void {
  if (source.value && sourceExists.value) void files.openFile(source.value)
}

function jump(it: AnnotationItem): void {
  if (!source.value || !sourceExists.value) return
  if (it.cfi) void citations.openAnnotation(source.value, { cfi: it.cfi })
  else if (it.range) void citations.openAnnotation(source.value, { range: it.range })
  else if (it.page) void citations.openAnnotation(source.value, { page: it.page, rects: it.rects })
}

/* ───────── edits ─────────
 * Every edit clones the parsed JSON, mutates the entry at `origIndex`, and
 * writes it back — unmodeled fields (rects, fontColor, blendMode…) round-trip.
 */

async function patch(origIndex: number, fn: (entry: Record<string, unknown>) => void): Promise<void> {
  if (!parsed.value?.annotations || !source.value) return
  const obj = JSON.parse(JSON.stringify(parsed.value)) as { annotations: Record<string, unknown>[] }
  const entry = obj.annotations[origIndex]
  if (!entry) return
  fn(entry)
  files.onEdited(JSON.stringify(obj, null, 2))
  await files.flush()
  notifySidecarChanged(source.value)
}

async function removeAt(origIndex: number): Promise<void> {
  if (!parsed.value?.annotations || !source.value) return
  const obj = JSON.parse(JSON.stringify(parsed.value)) as { annotations: unknown[] }
  obj.annotations.splice(origIndex, 1)
  files.onEdited(JSON.stringify(obj, null, 2))
  await files.flush()
  notifySidecarChanged(source.value)
}

async function setColor(it: AnnotationItem, color: string): Promise<void> {
  if (it.color.toLowerCase() === color.toLowerCase()) return
  await patch(it.origIndex, (entry) => {
    if (kind.value === 'pdf') {
      const a = entry.annotation as Record<string, unknown>
      a.strokeColor = color
      if ('color' in a) a.color = color
      // Fresh id so a live PdfDocument syncs this as delete+add: same-id changes
      // aren't re-imported, and id reuse crashes EmbedPDF's async delete-commit.
      a.id = crypto.randomUUID()
    } else {
      entry.color = color
    }
  })
}

const editingId = ref<string | null>(null)
const draft = ref('')

function beginNote(it: AnnotationItem): void {
  editingId.value = it.id
  draft.value = it.comment
}

async function saveNote(it: AnnotationItem): Promise<void> {
  const text = draft.value.trim()
  editingId.value = null
  await patch(it.origIndex, (entry) => {
    if (kind.value === 'pdf') {
      const a = entry.annotation as Record<string, unknown>
      if (text) a.contents = text
      else delete a.contents
    } else {
      if (text) entry.note = text
      else delete entry.note
    }
  })
}

/** Focus the note textarea when it mounts. */
function focusEl(el: unknown): void {
  ;(el as HTMLTextAreaElement | null)?.focus()
}
</script>

<template>
  <div class="h-full panel-scroll">
    <div class="max-w-3xl mx-auto px-6 py-8">
      <!-- Title block -->
      <div class="flex items-center gap-2.5 mb-1 min-w-0">
        <span
          class="codicon text-accent shrink-0"
          :class="kind === 'pdf' ? 'codicon-file-pdf' : 'codicon-book'"
        />
        <h1 class="text-lg font-semibold text-fg-0 truncate">{{ sourceName }}</h1>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3 mb-6">
        <span>{{ $t('viewers.annotations.count', { n: items.length }) }}</span>
        <span v-for="c in counts" :key="c.label" class="text-fg-3">{{ c.n }} {{ c.label }}</span>
        <button v-if="sourceExists" class="text-accent hover:underline" @click="openSource">
          <span class="codicon codicon-sm codicon-go-to-file align-text-bottom" /> {{ $t('viewers.annotations.openSource') }}
        </button>
        <span v-else class="text-yellow-500">{{ $t('viewers.annotations.sourceMissing') }}</span>
      </div>

      <div v-if="!items.length" class="text-center text-fg-3 py-16">
        <span class="codicon codicon-lg codicon-bookmark block mb-2" />
        {{ $t('viewers.annotations.empty') }}
      </div>

      <section v-for="g in groups" :key="g.label || 'all'" class="mb-6">
        <h2 v-if="g.label" class="text-[11px] uppercase tracking-wide text-fg-3 mb-2">
          {{ g.label }}
        </h2>
        <article
          v-for="it in g.items"
          :key="it.id"
          class="group relative mb-3 rounded-md border border-border bg-bg-1 overflow-hidden transition-colors"
          :class="sourceExists ? 'hover:border-accent/60 cursor-pointer' : ''"
          :title="sourceExists ? $t('viewers.annotations.jumpTitle') : ''"
          @click="jump(it)"
        >
          <!-- color bar -->
          <span class="absolute left-0 top-0 bottom-0 w-1" :style="{ backgroundColor: it.color }" />
          <div class="pl-4 pr-3 py-3">
            <!-- category badge -->
            <div class="flex items-center gap-2 mb-1.5">
              <span
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
                :style="{ backgroundColor: it.color + '33', color: 'rgb(var(--c-fg-1))' }"
              >
                <span class="w-2 h-2 rounded-full" :style="{ backgroundColor: it.color }" />
                {{ categoryLabel(it) }}
              </span>
              <span v-if="it.createdAt" class="text-[11px] text-fg-3">
                {{ it.createdAt.slice(0, 10) }}
              </span>
            </div>

            <!-- excerpt (the marked passage) -->
            <blockquote
              v-if="it.excerpt"
              class="text-sm leading-relaxed text-fg-1 whitespace-pre-line"
              :class="it.category === 'underline' ? 'underline decoration-2 underline-offset-4' : ''"
              :style="it.category === 'underline' ? { textDecorationColor: it.color } : undefined"
            >{{ it.excerpt }}</blockquote>
            <div
              v-else-if="it.category !== 'note'"
              class="text-sm text-fg-3 italic"
            >{{ $t('viewers.annotations.noExcerpt') }}</div>

            <!-- comment: display / inline edit. For a note-type mark the comment
                 IS the content, so it shows even without an excerpt above. -->
            <div v-if="editingId === it.id" class="mt-2" @click.stop>
              <textarea
                v-model="draft"
                :ref="focusEl"
                rows="3"
                class="w-full text-sm bg-bg-2 rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-accent resize-y"
                :placeholder="$t('viewers.annotations.notePlaceholder')"
                @keydown.enter.meta.prevent="saveNote(it)"
                @keydown.esc.stop="editingId = null"
              />
              <div class="flex gap-2 mt-1">
                <button class="btn-primary text-xs" @click="saveNote(it)">{{ $t('common.save') }}</button>
                <button class="btn text-xs" @click="editingId = null">{{ $t('common.cancel') }}</button>
              </div>
            </div>
            <div
              v-else-if="it.comment"
              class="mt-2 flex items-start gap-1.5 text-sm"
              :class="it.category === 'note' ? 'text-fg-1' : 'text-fg-2'"
              :title="$t('viewers.annotations.editComment')"
              @click.stop="beginNote(it)"
            >
              <span class="codicon codicon-sm codicon-comment mt-0.5 text-fg-3 shrink-0" />
              <span class="whitespace-pre-line">{{ it.comment }}</span>
            </div>

            <!-- hover actions -->
            <div class="mt-2 flex items-center gap-2">
              <span class="flex-1" />
              <div
                class="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                @click.stop
              >
                <button
                  v-if="editingId !== it.id && !it.comment"
                  class="btn text-xs"
                  :title="$t('viewers.annotations.addComment')"
                  @click="beginNote(it)"
                >
                  <span class="codicon codicon-sm codicon-comment-add" />
                </button>
                <template v-if="it.category === 'highlight'">
                  <button
                    v-for="c in HIGHLIGHT_COLORS"
                    :key="c.value"
                    class="w-4 h-4 rounded-full border transition-transform hover:scale-110"
                    :class="
                      it.color.toLowerCase() === c.value.toLowerCase() ? 'border-fg-1' : 'border-border'
                    "
                    :style="{ backgroundColor: c.value }"
                    :title="$t('viewers.annotations.changeTo', { name: c.name })"
                    @click="setColor(it, c.value)"
                  />
                </template>
                <button class="btn text-xs hover:!text-removed" :title="$t('viewers.annotations.deleteAnnotation')" @click="removeAt(it.origIndex)">
                  <span class="codicon codicon-sm codicon-trash" />
                </button>
              </div>
            </div>
          </div>
        </article>
      </section>
    </div>
  </div>
</template>
