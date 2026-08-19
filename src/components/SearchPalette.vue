<script setup lang="ts">
/**
 * The palette (⌘K / ⌘P). One input, four things behind it, chosen by a prefix:
 *
 *   (none)  files and content — filenames fuzzy-ranked, content substring
 *   >       commands (see composables/useCommands)
 *   @       agent conversations, by title
 *   ⇧Enter  hand whatever is typed to the agent
 *
 * The last one has no prefix on purpose. Prefixes have to be learned, and the
 * moment someone wants the agent is usually the moment a search came back
 * empty — so the offer sits at the bottom of the results instead, where it is
 * read rather than remembered. It fills the composer rather than sending:
 * seeing what is about to be asked, and being able to add to it, is the same
 * bargain the rest of the app makes (see ChatPanel's pendingPrompt).
 */
import { ref, computed, watch, nextTick } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useFilesStore } from '@/stores/files'
import { useKbIndexStore, type SearchHit } from '@/stores/kbIndex'
import { useCitationsStore } from '@/stores/citations'
import { useChatStore, type SessionSummary } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useCommands, type Command } from '@/composables/useCommands'
import { fuzzyRank, termPositions, queryTerms } from '@/lib/fuzzy'
import { activeBindings, formatBinding, HOTKEY_BY_ID } from '@/lib/hotkeys'
import { baseName } from '@/lib/wiki'
import { typeColor } from '@/lib/typeColor'
import { t } from '@/i18n'

const ui = useUiStore()
const files = useFilesStore()
const index = useKbIndexStore()
const citations = useCitationsStore()
const chat = useChatStore()
const settings = useSettingsStore()
const commands = useCommands()

const query = ref('')
const selected = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

type Mode = 'search' | 'command' | 'session'

interface Row {
  kind: 'file' | 'hit' | 'doc' | 'command' | 'session' | 'ask'
  /** Primary text; for files this is the path. */
  label: string
  /** Characters of `label` the query matched, for underlining. */
  positions?: number[]
  path?: string
  line?: number
  /** Matching line from a note or an indexed document. */
  text?: string
  /** Characters of `text` the query matched. */
  textPositions?: number[]
  blockId?: string | null
  type?: string | null
  icon: string
  /** Right-aligned hint: a key binding, a date, a concept type. */
  hint?: string
  command?: Command
  sessionId?: string
}

// `type:foo` (or `type:"foo bar"`) filters results to that OKF concept type;
// the rest of the query is the usual filename/content search.
const TYPE_RE = /\btype:(?:"([^"]*)"|(\S+))/i

const mode = computed<Mode>(() =>
  query.value.startsWith('>') ? 'command' : query.value.startsWith('@') ? 'session' : 'search',
)
/** The query with any mode prefix removed. */
const term = computed(() =>
  mode.value === 'search' ? query.value : query.value.slice(1).trimStart(),
)

const parsed = computed(() => {
  const m = term.value.match(TYPE_RE)
  return {
    typeFilter: m ? (m[1] ?? m[2]).toLowerCase() : '',
    text: term.value.replace(TYPE_RE, '').trim(),
  }
})

function bindingHint(cmd: Command): string | undefined {
  if (!cmd.hotkey) return undefined
  const def = HOTKEY_BY_ID[cmd.hotkey]
  return formatBinding(activeBindings(def, settings.state.hotkeys)[0])
}

const commandRows = computed<Row[]>(() =>
  fuzzyRank(
    term.value.trim().toLowerCase(),
    commands.filter((c) => !c.when || c.when()),
    (c) => t(c.label).toLowerCase(),
  ).map(
    ({ item, positions }): Row => ({
      kind: 'command',
      label: t(item.label),
      positions,
      icon: item.icon,
      hint: bindingHint(item),
      command: item,
    }),
  ),
)

const sessionRows = computed<Row[]>(() => {
  const q = term.value.trim().toLowerCase()
  // Favourites first, then most recently touched — the same order the history
  // panel uses, so the two never disagree about what "recent" means.
  const ordered = [...chat.sessions].sort(
    (a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt,
  )
  return fuzzyRank(q, ordered, (s: SessionSummary) => s.title.toLowerCase()).map(
    ({ item, positions }): Row => ({
      kind: 'session',
      label: item.title,
      positions,
      icon: item.favorite ? 'codicon-star-full' : 'codicon-comment-discussion',
      hint: relativeDay(item.updatedAt),
      sessionId: item.id,
    }),
  )
})

function relativeDay(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days <= 0) return t('search.today')
  if (days === 1) return t('search.yesterday')
  return t('search.daysAgo', { n: days })
}

const searchRows = computed<Row[]>(() => {
  const { typeFilter, text } = parsed.value
  let fileMatches: Array<{ path: string; positions: number[] }>
  let hits: SearchHit[]
  if (typeFilter) {
    const inType = (p: string): boolean =>
      (index.types.get(p) ?? '').toLowerCase().includes(typeFilter)
    if (text) {
      const r = index.search(text)
      fileMatches = r.files.filter((f) => inType(f.path))
      hits = r.hits.filter((h) => inType(h.path))
    } else {
      // Type filter alone → list every page of that type.
      fileMatches = [...index.types.keys()]
        .filter(inType)
        .sort()
        .map((path) => ({ path, positions: [] }))
      hits = []
    }
  } else {
    const r = index.search(text)
    fileMatches = r.files
    hits = r.hits
  }
  return [
    ...fileMatches.map(
      ({ path, positions }): Row => ({
        kind: 'file',
        label: path,
        positions,
        path,
        icon: 'codicon-markdown',
        type: index.types.get(path) ?? null,
      }),
    ),
    ...hits.map(
      (h): Row => ({
        kind: h.doc ? 'doc' : 'hit',
        label: h.path,
        path: h.path,
        line: h.line,
        text: h.text,
        textPositions: termPositions(h.text, queryTerms(text)),
        blockId: h.blockId,
        icon: h.doc ? 'codicon-book' : 'codicon-search',
        type: index.types.get(h.path) ?? null,
      }),
    ),
  ].slice(0, 60)
})

const rows = computed<Row[]>(() => {
  if (mode.value === 'command') return commandRows.value
  if (mode.value === 'session') return sessionRows.value
  const found = searchRows.value
  // The offer to ask instead of search — only with something to ask about,
  // and FIRST. Search results are unbounded: put the offer after them and it
  // sits below a scroll, which is exactly where someone whose search is not
  // finding it has already stopped looking. Being first must NOT make it the
  // default action, though — see `defaultRow`, which keeps Enter meaning "open
  // the top hit".
  if (!parsed.value.text) return found
  return [
    { kind: 'ask', label: parsed.value.text, icon: 'codicon-sparkle', hint: '⇧↵' },
    ...found,
  ]
})

const placeholder = computed(() =>
  mode.value === 'command'
    ? t('search.commandPlaceholder')
    : mode.value === 'session'
      ? t('search.sessionPlaceholder')
      : t('search.placeholder'),
)

/** Split text into matched / unmatched runs so the matched characters can be
 *  marked up — a hit whose reason is invisible looks arbitrary, whether the
 *  match was fuzzy (a file name) or a plain substring (a line of prose). */
function segments(text: string, positions?: number[]): Array<{ text: string; hit: boolean }> {
  const pos = new Set(positions ?? [])
  if (!pos.size) return [{ text, hit: false }]
  const out: Array<{ text: string; hit: boolean }> = []
  for (let i = 0; i < text.length; i++) {
    const hit = pos.has(i)
    const last = out[out.length - 1]
    if (last && last.hit === hit) last.text += text[i]
    else out.push({ text: text[i], hit })
  }
  return out
}

/** Where the highlight lands on a fresh result set: the first real result,
 *  not the "ask the agent" offer that now sits above them. Enter is search's
 *  key and must keep opening the top hit; asking has ⇧↵ and a click. With
 *  nothing found, the offer is the only row and rightly takes the highlight —
 *  which is the moment it is the answer. */
const defaultRow = computed(() => {
  const i = rows.value.findIndex((r) => r.kind !== 'ask')
  return i === -1 ? 0 : i
})

watch(rows, () => (selected.value = defaultRow.value))

watch(
  () => ui.searchOpen,
  async (open) => {
    if (open) {
      query.value = ''
      void index.refresh()
      await nextTick()
      inputEl.value?.focus()
    }
  },
)

/** Hand the typed text to the agent as an editable draft. */
function askAgent(text: string): void {
  if (!text.trim()) return
  ui.searchOpen = false
  ui.agentOpen = true
  ui.pendingPrompt = text.trim()
}

async function pick(row: Row | undefined): Promise<void> {
  if (!row) return
  if (row.kind === 'ask') {
    askAgent(row.label)
    return
  }
  if (row.kind === 'command') {
    ui.searchOpen = false
    row.command?.run()
    return
  }
  if (row.kind === 'session') {
    ui.searchOpen = false
    ui.agentOpen = true
    if (row.sessionId) await chat.openSession(row.sessionId)
    return
  }
  ui.searchOpen = false
  ui.graphOpen = false
  if (row.kind === 'doc') {
    // Jump straight to the matched passage inside the PDF/EPUB.
    await citations.openCitation(row.path!, row.blockId ?? null)
    return
  }
  await files.openFile(row.path!)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    ui.searchOpen = false
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    selected.value = Math.min(selected.value + 1, rows.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selected.value = Math.max(selected.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    // ⇧Enter always means "ask", whatever is selected — including in the
    // command and session modes, where the prefix is not part of the question.
    if (e.shiftKey) askAgent(term.value)
    else void pick(rows.value[selected.value])
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="ui.searchOpen"
      class="fixed inset-0 z-50 bg-black/50 flex justify-center pt-[12vh]"
      @click.self="ui.searchOpen = false"
    >
      <!-- data-palette marks the panel: the same file names appear in the tree,
           so tests (and anything else looking for a result) need to say which. -->
      <div
        data-palette
        class="w-[560px] max-w-[90vw] h-fit max-h-[70vh] rounded-lg border border-border bg-bg-1 flex flex-col overflow-hidden"
      >
        <input
          ref="inputEl"
          v-model="query"
          class="px-4 py-3 bg-transparent text-fg-0 placeholder-fg-3 focus:outline-none border-b border-border"
          :placeholder="placeholder"
          @keydown="onKeydown"
        />
        <div class="panel-scroll">
          <!-- Keyed by position: a document's sections all carry the same
               source path, and two of them matching at the same line number
               made path+line collide. Vue then reused those rows' DOM and the
               results stopped tracking the query. Rows hold no state of their
               own and the whole list is rebuilt per keystroke, so the index is
               both unique and correct here. -->
          <button
            v-for="(row, i) in rows"
            :key="`${i}:${row.kind}:${row.label}`"
            :data-kind="row.kind"
            class="w-full text-left px-4 py-1.5 flex items-center gap-2 text-sm"
            :class="i === selected ? 'bg-bg-2' : 'hover:bg-bg-2/50'"
            @click="pick(row)"
            @mousemove="selected = i"
          >
            <span class="codicon codicon-sm shrink-0 text-fg-3" :class="row.icon" />
            <template v-if="row.kind === 'hit' || row.kind === 'doc'">
              <span
                v-if="row.kind === 'doc'"
                class="shrink-0 max-w-[140px] truncate text-fg-3 text-xs"
              >
                {{ baseName(row.path!) }}
              </span>
              <span v-else class="shrink-0 text-fg-3 font-mono text-xs">
                {{ row.path }}:{{ row.line }}
              </span>
              <span class="truncate text-fg-2">
                <span
                  v-for="(seg, s) in segments(row.text ?? '', row.textPositions)"
                  :key="s"
                  :class="seg.hit ? 'fz-hit' : ''"
                  >{{ seg.text }}</span
                >
              </span>
            </template>
            <template v-else-if="row.kind === 'ask'">
              <span class="shrink-0 text-fg-3">{{ $t('search.askAgent') }}</span>
              <span class="truncate text-fg-2">{{ row.label }}</span>
            </template>
            <template v-else>
              <span class="truncate text-fg-0">
                <span
                  v-for="(seg, s) in segments(row.label, row.positions)"
                  :key="s"
                  :class="seg.hit ? 'fz-hit' : ''"
                  >{{ seg.text }}</span
                >
              </span>
            </template>
            <span
              v-if="row.hint"
              class="ml-auto shrink-0 text-fg-3 text-xs font-mono whitespace-nowrap"
            >
              {{ row.hint }}
            </span>
            <span
              v-else-if="row.type"
              class="ml-auto shrink-0 max-w-[110px] truncate rounded border px-1 text-[10px] leading-[1.4]"
              :style="{ color: typeColor(row.type), borderColor: typeColor(row.type) }"
            >
              {{ row.type }}
            </span>
          </button>
          <div v-if="query && !rows.length" class="px-4 py-3 text-sm text-fg-3">
            {{ $t('search.noResults') }}
          </div>
          <div
            v-if="!query"
            class="px-4 py-2 text-xs text-fg-3 border-t border-border flex flex-wrap gap-x-4 gap-y-1"
          >
            <span><span class="font-mono text-fg-2">&gt;</span> {{ $t('search.hintCommands') }}</span>
            <span><span class="font-mono text-fg-2">@</span> {{ $t('search.hintSessions') }}</span>
            <span><span class="font-mono text-fg-2">⇧↵</span> {{ $t('search.hintAsk') }}</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.fz-hit {
  color: rgb(var(--c-accent));
  font-weight: 600;
}
</style>
