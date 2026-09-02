<script setup lang="ts">
/**
 * The palette (⌘K / ⌘P). One input, five things behind it, chosen by a prefix:
 *
 *   (none)  files and content — filenames fuzzy-ranked, content substring
 *   >       commands (see composables/useCommands)
 *   @       agent conversations, by title
 *   :       jot a line into today's capture page — or, alone, open it (lib/daily)
 *   ⇧Enter  hand whatever is typed to the agent
 *
 * `:` earns a prefix where the others earn one: it is a *write*, and the
 * palette is the only surface reachable without leaving what you were doing —
 * which is the whole of why a passing thought gets written down at all.
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
import { useKbIndexStore, type SearchHit } from '@/stores/kbIndex'
import { useCitationsStore } from '@/stores/citations'
import { useChatStore, type SessionSummary } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useFilesStore } from '@/stores/files'
import { useCommands, type Command } from '@/composables/useCommands'
import { fuzzyRank, termPositions, queryTerms } from '@/lib/fuzzy'
import {
  parseKbQuery,
  matchingPaths,
  hasFilters,
  sourceMatches,
  bareFilterKey,
  FILTER_HELP,
} from '@/lib/kbQuery'
import { activeBindings, formatBinding, HOTKEY_BY_ID } from '@/lib/hotkeys'
import { openInEditor, revealEditor } from '@/lib/openInEditor'
import { usesRawLayout } from '@/lib/capture'
import { todayIso, resolveDailyPath } from '@/lib/daily'
import { jotToday, openTodayPage } from '@/lib/jot'
import { baseName } from '@/lib/wiki'
import { typeColor } from '@/lib/typeColor'
import { t } from '@/i18n'

const ui = useUiStore()
const index = useKbIndexStore()
const citations = useCitationsStore()
const chat = useChatStore()
const settings = useSettingsStore()
const files = useFilesStore()
const commands = useCommands()

const query = ref('')
const selected = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

type Mode = 'search' | 'command' | 'session' | 'jot'

interface Row {
  kind: 'file' | 'hit' | 'doc' | 'command' | 'session' | 'ask' | 'value' | 'filter' | 'jot' | 'jotOpen'
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
  /** For `value` and `filter` rows: the filter key being completed. */
  filterKey?: string
}

// Filters plus free text. The grammar is `lib/kbQuery` — the same one a
// `localmd-query` block and the agent's query_kb speak, so something learned
// in one place works in the others. Only the GRAMMAR is shared: matching
// still runs through this panel's cached maps and fuzzy ranking, because
// finding a file and answering a structural question are different jobs.

// A leading `:` is unambiguous: the `type:` / `tag:` filters are word-bounded,
// so a colon never opens a search query.
const mode = computed<Mode>(() =>
  query.value.startsWith('>')
    ? 'command'
    : query.value.startsWith('@')
      ? 'session'
      : query.value.startsWith(':')
        ? 'jot'
        : 'search',
)
/** The query with any mode prefix removed. */
const term = computed(() =>
  mode.value === 'search' ? query.value : query.value.slice(1).trimStart(),
)

/* Parse errors are deliberately silent HERE and nowhere else. A search box is
 * incremental: `age:<` is a half-typed filter on the way to `age:<30d`, not a
 * mistake to report, and a red line appearing under every third keystroke
 * teaches people to stop reading it. A filter that will not parse is simply
 * not applied — and the two places where a query is KEPT rather than typed
 * (the note block, the agent tool) both report the errors in full. */
const parsed = computed(() => parseKbQuery(term.value, Date.now()).query)

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

/**
 * Typing a filter and stopping asks what can go in it. That was always true
 * of `tag:` — it was the only way anyone learnt a tag's name — and there was
 * never a reason for it to be the only key that answers.
 *
 * Where the values are the user's own vocabulary the knowledge base supplies
 * them; where the grammar decides, they are listed; where neither can, the
 * shape of what goes there is still worth showing. Picking fills the query in
 * rather than navigating anywhere.
 */
const valueRows = computed<Row[]>(() => {
  const help = bareFilterKey(term.value)
  if (!help) return []
  const row = (label: string, hint?: string): Row => ({
    kind: 'value',
    label,
    hint,
    icon: help.key === 'tag' ? 'codicon-tag' : 'codicon-filter',
    filterKey: help.key,
  })
  if (help.fromKb) return index.filterValues(help.key).map((v) => row(v.value, String(v.count)))
  if (help.values) return help.values.map((v) => row(v))
  return [row(help.example, t('search.filterShape'))]
})

/**
 * What ⌘K shows before a key is pressed. It used to show nothing at all —
 * an empty result for an empty query — which made it the one surface every
 * user opens every time and no one ever learns anything from.
 *
 * Listing the filters costs nobody anything: the first keystroke replaces
 * them. Picking one inserts the key and the list above answers what can
 * follow it, so the two halves of finding out compose.
 */
const filterRows = computed<Row[]>(() =>
  FILTER_HELP.map(
    (f): Row => ({
      kind: 'filter',
      label: `${f.key}:`,
      hint: f.example,
      icon: 'codicon-filter',
      filterKey: f.key,
    }),
  ),
)

/* Where a jot would land. Resolved when the palette opens rather than after
 * the write, because the target is the one thing about this mode a person
 * cannot guess — and a capture surface that writes somewhere unstated is one
 * you stop trusting with anything you would mind losing. */
const rawLayout = ref(false)
const jotTarget = computed(() => resolveDailyPath(todayIso(), files.allFiles, rawLayout.value))
/** Where the last jot went, shown while the input is empty again — the palette
 *  stays open so several lines can go in one after another. */
const jotted = ref('')

const jotRows = computed<Row[]>(() =>
  term.value.trim()
    ? [{ kind: 'jot', label: term.value.trim(), icon: 'codicon-add', hint: '↵' }]
    // `:` with nothing after it is not an empty search — it is the other half
    // of the mode: open the page itself and write in it.
    : [{ kind: 'jotOpen', label: jotTarget.value, icon: 'codicon-go-to-file', hint: '↵' }],
)

const searchRows = computed<Row[]>(() => {
  const q = parsed.value
  const text = q.text ?? ''
  // The engine answers the filters; the free text stays with this panel's own
  // search, which ranks fuzzily and reaches inside document indexes. Handing
  // the words to both would filter them twice by two different rules. Shaping
  // (sort/limit/columns) is dropped too: the palette has its own order and its
  // own cap, and a `limit:` meant for a note must not silently truncate it.
  const filters = { ...q, text: undefined, sort: undefined, limit: undefined, columns: undefined }
  const pages = hasFilters(q) ? matchingPaths(index.queryPages, filters) : null
  // A document is not a page but it does have tags — the ones the pages citing
  // it declared — so `tag:llm` finds the paper as well as the notes on it, as
  // it always has. `sourceMatches` decides which questions it can be asked.
  const keep = (p: string): boolean =>
    pages!.has(p) || sourceMatches(filters, p, index.tagsFor(p))
  let fileMatches: Array<{ path: string; positions: number[] }>
  let hits: SearchHit[]
  if (pages) {
    if (text) {
      const r = index.search(text)
      fileMatches = r.files.filter((f) => keep(f.path))
      hits = r.hits.filter((h) => keep(h.path))
    } else {
      // A filter alone → list everything it matches, pages and the documents
      // that inherited a tag.
      fileMatches = [...new Set([...pages, ...index.sourceTags.keys()])]
        .filter(keep)
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
  if (mode.value === 'jot') return jotRows.value
  if (bareFilterKey(term.value)) return valueRows.value
  // Nothing typed yet: the filters, rather than the blank the palette used to
  // answer an empty query with.
  if (!term.value.trim()) return filterRows.value
  const found = searchRows.value
  // The offer to ask instead of search — only with something to ask about,
  // and FIRST. Search results are unbounded: put the offer after them and it
  // sits below a scroll, which is exactly where someone whose search is not
  // finding it has already stopped looking. Being first must NOT make it the
  // default action, though — see `defaultRow`, which keeps Enter meaning "open
  // the top hit".
  if (!parsed.value.text) return found
  return [
    { kind: 'ask', label: parsed.value.text ?? '', icon: 'codicon-sparkle', hint: '⇧↵' },
    ...found,
  ]
})

/**
 * One line about the filter the palette is sitting on — hover and arrow keys
 * both land here, because `@mousemove` sets the same `selected` the keyboard
 * moves, so this is help for "the current row" rather than help for the mouse.
 *
 * It sits in the footer beside the mode hints rather than replacing them: the
 * list opens with a row already selected, so a footer that swapped would mean
 * nobody ever saw `>` `@` `:` again.
 */
const selectedFilterHelp = computed(() => {
  const row = rows.value[selected.value]
  if (!row || (row.kind !== 'filter' && row.kind !== 'value') || !row.filterKey) return ''
  return t(`query.filter.${row.filterKey}`)
})

/* Where that line floats: directly above the row it describes.
 *
 * Docked under the list it was technically visible and practically not — on a
 * fifteen-row list the thing being explained and the explanation sat at
 * opposite ends of the panel, so reading it meant looking away from what the
 * mouse was on. Over the row it is where the eye already is.
 *
 * It covers the rows above, which is the trade a tooltip always makes and the
 * reason for `pointer-events-none`: the row underneath still receives the
 * mouse, so moving up the list never gets stuck behind the help for the row
 * you just left.
 *
 * Both dimensions are measured rather than guessed: the box is only as wide as
 * its sentence (`w-max`, capped so a long one wraps instead of running off),
 * so neither width nor height is knowable before it renders. Centring on the
 * row means that varying width grows and shrinks around a fixed point rather
 * than sliding. Dropped below the row when there is no room above it — the
 * first row, a short window. Measurement runs in the same task as the render,
 * so the browser only ever paints the final position. */
const rowEls = ref<(HTMLElement | null)[]>([])
const helpEl = ref<HTMLElement | null>(null)
const helpPos = ref<{ top: number; left: number } | null>(null)
/* Shown once the row is actually being pointed at or stepped onto, and gone
 * the moment the pointer leaves the list. Not simply "there is a selected
 * row": the palette opens with one already selected, and a card that appeared
 * unbidden over a list nobody had touched yet would be something to dismiss
 * rather than something to read. Arrow keys raise it too, so the help is not
 * hidden behind owning a mouse. */
const helpVisible = ref(false)

const HELP_GAP = 8

async function placeHelp(): Promise<void> {
  if (!selectedFilterHelp.value || !helpVisible.value) {
    helpPos.value = null
    return
  }
  await nextTick()
  const row = rowEls.value[selected.value]
  const card = helpEl.value
  if (!row || !card) return
  const r = row.getBoundingClientRect()
  const c = card.getBoundingClientRect()
  const above = r.top - c.height - HELP_GAP
  helpPos.value = {
    // Centred on the row. Every row is the width of the panel, so the centre
    // is the same for all of them: the box holds still horizontally while the
    // mouse runs down the list, and only the height changes.
    left: Math.min(
      Math.max(HELP_GAP, r.left + r.width / 2 - c.width / 2),
      window.innerWidth - c.width - HELP_GAP,
    ),
    top: above >= HELP_GAP ? above : r.bottom + HELP_GAP,
  }
}

watch([selected, rows, helpVisible], () => void placeHelp(), { flush: 'post' })

const placeholder = computed(() =>
  mode.value === 'command'
    ? t('search.commandPlaceholder')
    : mode.value === 'session'
      ? t('search.sessionPlaceholder')
      : mode.value === 'jot'
        ? t('search.jotPlaceholder')
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
      // A prepared query (the graph's tag nodes) survives exactly one open,
      // then the palette is its own again.
      query.value = ui.pendingSearch
      ui.pendingSearch = ''
      jotted.value = ''
      void index.refresh()
      await nextTick()
      inputEl.value?.focus()
      // After the focus: the input is usable on the first frame, and the
      // answer is only needed once something is typed.
      rawLayout.value = await usesRawLayout()
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

/** Append the typed line to today's capture page and stay open for the next
 *  one. Nothing navigates and nothing closes: a jot may not cost you the file
 *  you were reading, or it stops being worth making. */
async function openToday(): Promise<void> {
  ui.searchOpen = false
  ui.graphOpen = false
  await openTodayPage()
}

async function doJot(): Promise<void> {
  const path = await jotToday(term.value)
  if (!path) return
  query.value = ':'
  jotted.value = path
  inputEl.value?.focus()
}

async function pick(row: Row | undefined): Promise<void> {
  if (!row) return
  if (row.kind === 'ask') {
    askAgent(row.label)
    return
  }
  if (row.kind === 'jot') {
    await doJot()
    return
  }
  if (row.kind === 'jotOpen') {
    await openToday()
    return
  }
  if (row.kind === 'filter') {
    // Insert the key and stop: the value list answers what can follow it.
    query.value = `${query.value.trimEnd()}${query.value.trim() ? ' ' : ''}${row.filterKey}:`
    inputEl.value?.focus()
    return
  }
  if (row.kind === 'value') {
    // Complete the filter in place; the results are the next keystroke away,
    // and the palette stays open so a wrong pick costs one backspace.
    const value = /\s/.test(row.label) ? `"${row.label}"` : row.label
    query.value = query.value.replace(
      new RegExp(`${row.filterKey}:$`, 'i'),
      `${row.filterKey}:${value} `,
    )
    inputEl.value?.focus()
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
  // Either way the file is the point, so the agent panel gives the window back
  // if it was filling it — the palette is reachable by keyboard from in there,
  // and a hit that opened behind the panel would look like nothing happened.
  if (row.kind === 'doc') {
    // Jump straight to the matched passage inside the PDF/EPUB.
    if (await citations.openCitation(row.path!, row.blockId ?? null)) revealEditor()
    return
  }
  await openInEditor(row.path!)
}

function onKeydown(e: KeyboardEvent): void {
  // While an IME is composing, these keys are ITS keys: Enter commits the
  // candidate, the arrows move through the list, Escape abandons it. Acting on
  // them here jots half a sentence someone was still writing — which is the
  // one way this mode can lose text. Blink/Gecko set `isComposing`; WebKit has
  // shipped versions that only set the legacy 229, so check both.
  if (e.isComposing || e.keyCode === 229) return
  if (e.key === 'Escape') {
    ui.searchOpen = false
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    selected.value = Math.min(selected.value + 1, rows.value.length - 1)
    helpVisible.value = true
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selected.value = Math.max(selected.value - 1, 0)
    helpVisible.value = true
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
        <div class="panel-scroll flex-1 min-h-0" @mouseleave="helpVisible = false">
          <!-- Keyed by position: a document's sections all carry the same
               source path, and two of them matching at the same line number
               made path+line collide. Vue then reused those rows' DOM and the
               results stopped tracking the query. Rows hold no state of their
               own and the whole list is rebuilt per keystroke, so the index is
               both unique and correct here. -->
          <button
            v-for="(row, i) in rows"
            :key="`${i}:${row.kind}:${row.label}`"
            :ref="(el) => (rowEls[i] = el as HTMLElement | null)"
            :data-kind="row.kind"
            class="w-full text-left px-4 py-1.5 flex items-center gap-2 text-sm"
            :class="i === selected ? 'bg-bg-2' : 'hover:bg-bg-2/50'"
            @click="pick(row)"
            @mousemove="((selected = i), (helpVisible = true))"
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
            <template v-else-if="row.kind === 'jot'">
              <span class="shrink-0 text-fg-3">{{ $t('search.jotPrefix') }}</span>
              <span class="truncate text-fg-2">{{ row.label }}</span>
            </template>
            <template v-else-if="row.kind === 'jotOpen'">
              <span class="shrink-0 text-fg-3">{{ $t('search.jotOpen') }}</span>
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
          <!-- Where the last jot went, while the input is empty again: a
               write with no receipt is one you go and check on. -->
          <div v-if="mode === 'jot' && jotted && !term" class="px-4 py-3 text-sm text-fg-3">
            {{ $t('search.jotSaved', { path: jotted }) }}
          </div>
          <div v-else-if="query && !rows.length" class="px-4 py-3 text-sm text-fg-3">
            {{ $t('search.noResults') }}
          </div>
        </div>
        <!-- A status bar, outside the scroller. It used to be the last item in
             the list, which was invisible until the list grew: with the filters
             above it, it scrolled off the bottom and read as clipped. -->
        <div v-if="!query" class="shrink-0 border-t border-border">
          <div class="px-4 py-2 text-xs text-fg-3 flex flex-wrap gap-x-4 gap-y-1">
            <span><span class="font-mono text-fg-2">&gt;</span> {{ $t('search.hintCommands') }}</span>
            <span><span class="font-mono text-fg-2">@</span> {{ $t('search.hintSessions') }}</span>
            <span><span class="font-mono text-fg-2">:</span> {{ $t('search.hintJot') }}</span>
            <span><span class="font-mono text-fg-2">⇧↵</span> {{ $t('search.hintAsk') }}</span>
          </div>
        </div>
      </div>
      <div
        v-if="selectedFilterHelp && helpVisible"
        ref="helpEl"
        class="fixed z-[60] w-max max-w-[min(360px,90vw)] rounded-lg border border-border bg-bg-1 px-3 py-2 text-xs
               leading-relaxed text-fg-2 shadow-lg pointer-events-none"
        :style="
          helpPos
            ? { top: `${helpPos.top}px`, left: `${helpPos.left}px` }
            : { top: '0px', left: '-9999px' }
        "
      >
        {{ selectedFilterHelp }}
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
