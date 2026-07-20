<script setup lang="ts">
/**
 * Rendered view of a `*.annotations.json` sidecar — the default when opening
 * one from the file tree (AppLayout's Raw toggle switches to the JSON editor).
 * Cards show each highlight's excerpt + note; clicking a card jumps to the
 * annotated position in the book via the citations store. Edits (note, color,
 * delete) write the sidecar and signal live viewers through
 * notifySidecarChanged (PDFs stay mounted across tab switches).
 */
import { ref, computed, watch } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useCitationsStore } from '@/stores/citations'
import { fileKind } from '@/lib/filetypes'
import {
  HIGHLIGHT_COLORS,
  UNDERLINE_COLOR,
  annotationSource,
  isAnnotationsPath,
  compareCfi,
  toPdfHighlight,
  loadPdfSidecar,
  savePdfSidecar,
  loadEpubSidecar,
  saveEpubSidecar,
  notifySidecarChanged,
  type RawPdfAnnotation,
  type EpubAnnotation,
} from '@/lib/annotations'

const files = useFilesStore()
const citations = useCitationsStore()

/** Unified card model over both sidecar shapes. `id` is the PDF annotation id
 *  or the EPUB cfi — unique within one book's sidecar either way. */
interface Item {
  id: string
  color: string
  style: 'highlight' | 'underline'
  text: string
  note: string
  createdAt: string
  /** PDF: 1-based page (jump + grouping). */
  page?: number
  rects?: { x: number; y: number; w: number; h: number }[]
  /** EPUB: range CFI (jump). */
  cfi?: string
}

const sidecar = ref<string | null>(null)
const source = computed(() => (sidecar.value ? annotationSource(sidecar.value) : null))
const kind = computed(() => (source.value ? fileKind(source.value) : null))
const sourceName = computed(() => source.value?.slice(source.value.lastIndexOf('/') + 1) ?? '')
const sourceExists = computed(() => !!source.value && files.allFiles.includes(source.value))

const pdfRaw = ref<RawPdfAnnotation[]>([])
const epubRaw = ref<EpubAnnotation[]>([])

async function load(path: string | null): Promise<void> {
  editingId.value = null
  pdfRaw.value = []
  epubRaw.value = []
  sidecar.value = path && isAnnotationsPath(path) ? path : null
  if (!source.value) return
  if (kind.value === 'pdf') pdfRaw.value = await loadPdfSidecar(source.value)
  else epubRaw.value = await loadEpubSidecar(source.value)
}
watch(() => files.currentPath, (p) => void load(p), { immediate: true })

const groups = computed<{ label: string; items: Item[] }[]>(() => {
  if (kind.value === 'pdf') {
    const items: Item[] = []
    for (const raw of pdfRaw.value) {
      const h = toPdfHighlight(raw)
      if (!h) continue
      items.push({
        id: h.id,
        color: h.color,
        style: 'highlight',
        text: h.text,
        note: raw.annotation.custom?.note ?? '',
        createdAt: raw.annotation.created ?? '',
        page: h.pageIndex + 1,
        rects: h.rects,
      })
    }
    items.sort(
      (a, b) => a.page! - b.page! || (a.rects?.[0]?.y ?? 0) - (b.rects?.[0]?.y ?? 0),
    )
    const out: { label: string; items: Item[] }[] = []
    for (const it of items) {
      const label = `第 ${it.page} 页`
      const last = out[out.length - 1]
      if (last?.label === label) last.items.push(it)
      else out.push({ label, items: [it] })
    }
    return out
  }
  const items = epubRaw.value
    .slice()
    .sort((a, b) => compareCfi(a.cfi, b.cfi))
    .map(
      (a): Item => ({
        id: a.cfi,
        color: a.style === 'underline' ? UNDERLINE_COLOR : a.color,
        style: a.style ?? 'highlight',
        text: a.text,
        note: a.note ?? '',
        createdAt: a.createdAt ?? '',
        cfi: a.cfi,
      }),
    )
  return items.length ? [{ label: '', items }] : []
})
const total = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))

/* ───────── navigation ───────── */

function openSource(): void {
  if (source.value && sourceExists.value) void files.openFile(source.value)
}

function jump(it: Item): void {
  if (!source.value || !sourceExists.value) return
  if (it.cfi) void citations.openAnnotation(source.value, { cfi: it.cfi })
  else if (it.page) void citations.openAnnotation(source.value, { page: it.page, rects: it.rects })
}

/* ───────── edits ───────── */

async function persist(): Promise<void> {
  if (!source.value || !sidecar.value) return
  if (kind.value === 'pdf') await savePdfSidecar(source.value, pdfRaw.value)
  else await saveEpubSidecar(source.value, epubRaw.value)
  notifySidecarChanged(source.value)
  // The raw JSON buffer (files.content) loaded when this tab opened — keep it
  // fresh so a later Raw toggle doesn't show a stale document.
  await files.reloadIfClean(sidecar.value)
}

async function setColor(it: Item, color: string): Promise<void> {
  if (it.style !== 'highlight' || it.color.toLowerCase() === color.toLowerCase()) return
  if (kind.value === 'pdf') {
    const raw = pdfRaw.value.find((r) => r.annotation.id === it.id)
    if (!raw) return
    raw.annotation.strokeColor = color
    if (raw.annotation.color !== undefined) raw.annotation.color = color
    // Fresh id so a live PdfDocument syncs this as delete+add: same-id changes
    // aren't re-imported, and id reuse crashes EmbedPDF's async delete-commit.
    raw.annotation.id = crypto.randomUUID()
  } else {
    const a = epubRaw.value.find((x) => x.cfi === it.id)
    if (!a) return
    a.color = color
  }
  await persist()
}

const editingId = ref<string | null>(null)
const draft = ref('')

function beginNote(it: Item): void {
  editingId.value = it.id
  draft.value = it.note
}

async function saveNote(it: Item): Promise<void> {
  const text = draft.value.trim()
  if (kind.value === 'pdf') {
    const raw = pdfRaw.value.find((r) => r.annotation.id === it.id)
    if (!raw) return
    const custom = { ...(raw.annotation.custom ?? {}) }
    if (text) custom.note = text
    else delete custom.note
    raw.annotation.custom = custom
  } else {
    const a = epubRaw.value.find((x) => x.cfi === it.id)
    if (!a) return
    if (text) a.note = text
    else delete a.note
  }
  editingId.value = null
  await persist()
}

async function remove(it: Item): Promise<void> {
  if (kind.value === 'pdf') pdfRaw.value = pdfRaw.value.filter((r) => r.annotation.id !== it.id)
  else epubRaw.value = epubRaw.value.filter((x) => x.cfi !== it.id)
  await persist()
}

/** Focus the note textarea when it mounts (no-op on later patches). */
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
      <div class="flex items-center gap-3 text-xs text-fg-3 mb-6">
        <span>{{ total }} 条标注</span>
        <button
          v-if="sourceExists"
          class="text-accent hover:underline"
          @click="openSource"
        >
          <span class="codicon codicon-sm codicon-go-to-file align-text-bottom" /> 打开原书
        </button>
        <span v-else class="text-yellow-500">原书文件不存在,无法跳转</span>
      </div>

      <div v-if="!total" class="text-center text-fg-3 py-16">
        <span class="codicon codicon-lg codicon-bookmark block mb-2" />
        这本书还没有标注 — 在阅读器里选中文字即可高亮
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
          :title="sourceExists ? '点击跳转到原文位置' : ''"
          @click="jump(it)"
        >
          <!-- color bar -->
          <span
            class="absolute left-0 top-0 bottom-0 w-1"
            :style="{ backgroundColor: it.color }"
          />
          <div class="pl-4 pr-3 py-3">
            <blockquote
              class="text-sm leading-relaxed text-fg-1 whitespace-pre-line"
              :class="it.style === 'underline' ? 'underline decoration-2 underline-offset-4' : ''"
              :style="it.style === 'underline' ? { textDecorationColor: it.color } : undefined"
            >{{ it.text || '(无摘录文本)' }}</blockquote>

            <!-- note: display / inline edit -->
            <div v-if="editingId === it.id" class="mt-2" @click.stop>
              <textarea
                v-model="draft"
                :ref="focusEl"
                rows="3"
                class="w-full text-sm bg-bg-2 rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-accent resize-y"
                placeholder="写点想法…(⌘↵ 保存,Esc 取消)"
                @keydown.enter.meta.prevent="saveNote(it)"
                @keydown.esc.stop="editingId = null"
              />
              <div class="flex gap-2 mt-1">
                <button class="btn-primary text-xs" @click="saveNote(it)">保存</button>
                <button class="btn text-xs" @click="editingId = null">取消</button>
              </div>
            </div>
            <div
              v-else-if="it.note"
              class="mt-2 flex items-start gap-1.5 text-sm text-fg-2"
              title="点击编辑笔记"
              @click.stop="beginNote(it)"
            >
              <span class="codicon codicon-sm codicon-note mt-0.5 text-fg-3 shrink-0" />
              <span class="whitespace-pre-line">{{ it.note }}</span>
            </div>

            <!-- meta + hover actions -->
            <div class="mt-2 flex items-center gap-2 text-[11px] text-fg-3">
              <span v-if="it.createdAt">{{ it.createdAt.slice(0, 10) }}</span>
              <span v-if="it.style === 'underline'">下划线</span>
              <span class="flex-1" />
              <div
                class="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                @click.stop
              >
                <button
                  v-if="editingId !== it.id && !it.note"
                  class="btn text-xs"
                  title="添加笔记"
                  @click="beginNote(it)"
                >
                  <span class="codicon codicon-sm codicon-comment-add" />
                </button>
                <template v-if="it.style === 'highlight'">
                  <button
                    v-for="c in HIGHLIGHT_COLORS"
                    :key="c.value"
                    class="w-4 h-4 rounded-full border transition-transform hover:scale-110"
                    :class="
                      it.color.toLowerCase() === c.value.toLowerCase()
                        ? 'border-fg-1'
                        : 'border-border'
                    "
                    :style="{ backgroundColor: c.value }"
                    :title="`改为 ${c.name}`"
                    @click="setColor(it, c.value)"
                  />
                </template>
                <button
                  class="btn text-xs hover:!text-removed"
                  title="删除标注"
                  @click="remove(it)"
                >
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
