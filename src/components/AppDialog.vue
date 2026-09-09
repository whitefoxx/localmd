<script setup lang="ts">
/**
 * The app's own dialogs, in one place: a notice, a yes/no, a line of text, and
 * a list you can edit before it happens.
 *
 * One component for four kinds rather than four components, because what makes
 * these trustworthy is that they look and behave the same everywhere — the same
 * place on screen, the same way out, the same meaning for Escape. Four files
 * would be four chances for one of them to answer Escape differently.
 *
 * `lib/dialog` explains why they exist at all and why an unanswerable question
 * has to count as a refusal.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fuzzyRank } from '@/lib/fuzzy'
import {
  pendingDialog,
  registerDialogHost,
  settleDialog,
  type DialogChoice,
  type DialogRow,
} from '@/lib/dialog'

let unregister: (() => void) | null = null
onMounted(() => (unregister = registerDialogHost()))
onBeforeUnmount(() => unregister?.())

const req = computed(() => pendingDialog.value)
const danger = computed(() =>
  req.value && (req.value.kind === 'confirm' || req.value.kind === 'pick')
    ? !!req.value.danger
    : false,
)

/* ── kind: text ──────────────────────────────────────────────────────────── */
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)

/**
 * Answers on offer under the field, ranked by what has been typed.
 *
 * `fuzzyRank` is the ⌘P matcher, which is deliberate: a folder should be found
 * here the way it is found there. An exact hit is dropped — offering what is
 * already in the field is a row that can only waste a keystroke — and the list
 * is capped, because a suggestion you have to scroll to is one you would have
 * been quicker typing.
 */
const SUGGEST_MAX = 8
/**
 * Nobody has typed yet — the field still holds what it opened with.
 *
 * That value is usually where the files already are, which is both the safest
 * thing for Enter to mean on open (a no-op) and the worst thing to filter the
 * list by: it matches exactly one candidate, itself, which is then dropped as
 * an exact hit. The list came up empty every time. So while it is untouched
 * the list is unfiltered, and typing is what narrows it.
 */
const pristine = computed(() => req.value?.kind === 'text' && draft.value === req.value.value)
const suggestions = computed<DialogChoice[]>(() => {
  const r = req.value
  if (r?.kind !== 'text' || !r.suggest?.length) return []
  // Untouched, the caller's own order stands: it put them in the order it
  // wants them read, and ranking an empty query only re-sorts them by name
  // length, which buries whichever one was meant to lead.
  if (pristine.value) return r.suggest.slice(0, SUGGEST_MAX)
  const q = draft.value.trim()
  return fuzzyRank(q, r.suggest, (c) => c.label ?? c.value)
    .filter((m) => m.item.value !== q)
    .slice(0, SUGGEST_MAX)
    .map((m) => m.item)
})
/** Which suggestion the arrow keys are on; -1 is "none, Enter means the text
 *  I typed". Typing anything puts it back there. */
const highlighted = ref(-1)
watch(draft, () => (highlighted.value = -1))

function take(choice: DialogChoice): void {
  draft.value = choice.value
  highlighted.value = -1
  void nextTick(() => input.value?.focus())
}

/** ↑/↓ walk the list; the field itself is position -1, so arrowing up from the
 *  first row returns to what was typed rather than wrapping to the bottom. */
function moveHighlight(delta: number): void {
  const max = suggestions.value.length - 1
  if (max < 0) return
  highlighted.value = Math.min(max, Math.max(-1, highlighted.value + delta))
}

/* ── kind: pick ──────────────────────────────────────────────────────────── */
const ticked = ref(new Set<string>())
const rows = computed<DialogRow[]>(() => (req.value?.kind === 'pick' ? req.value.rows : []))
const chosen = computed(() => rows.value.filter((r) => ticked.value.has(r.id)))

function toggle(id: string): void {
  const next = new Set(ticked.value)
  if (!next.delete(id)) next.add(id)
  ticked.value = next
}

/**
 * The panel takes focus when a question opens — or the field does, for a text
 * one.
 *
 * Escape is handled on the panel, and a keydown only reaches it if the focus is
 * inside: a modal whose Escape depends on the user having clicked something
 * first is a modal with no way out. Everywhere else the focus lands on the
 * panel rather than on a button, so the space bar and Enter arrive at nothing
 * and a destructive answer stays something you have to aim at.
 */
const panel = ref<HTMLElement | null>(null)
watch(
  req,
  (r) => {
    if (!r) return
    draft.value = r.kind === 'text' ? r.value : ''
    ticked.value = new Set(r.kind === 'pick' ? r.rows.map((x) => x.id) : [])
    void nextTick(() => {
      if (r.kind === 'text') input.value?.select()
      else panel.value?.focus()
    })
  },
  { immediate: true },
)

/** What the confirm button says, and whether it can be pressed at all. */
const confirmLabel = computed(() => {
  const r = req.value
  if (!r) return ''
  if (r.kind === 'pick') return r.confirmLabel(chosen.value.length)
  if (r.kind === 'notice') return ''
  return r.confirmLabel ?? ''
})
const canConfirm = computed(() => req.value?.kind !== 'pick' || chosen.value.length > 0)

function cancel(): void {
  const r = req.value
  settleDialog(r?.kind === 'confirm' ? false : r?.kind === 'text' ? null : r?.kind === 'pick' ? [] : undefined)
}

function accept(): void {
  const r = req.value
  if (!r) return
  if (r.kind === 'notice') return settleDialog(undefined)
  if (r.kind === 'confirm') return settleDialog(true)
  if (r.kind === 'text') return settleDialog(draft.value.trim())
  if (chosen.value.length) settleDialog(chosen.value)
}

/**
 * Escape always cancels. Enter confirms only where confirming is the reflex it
 * ought to be — a notice, and a text field you just finished typing in. Never
 * on anything marked dangerous, and never on a `pick`: the whole point of a
 * list you can edit is that the user looked at it.
 */
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    cancel()
    return
  }
  const r = req.value
  if (!r) return
  if (r.kind === 'text' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault()
    moveHighlight(e.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (e.key !== 'Enter') return
  // A highlighted suggestion is taken into the field, not acted on: filling and
  // confirming in one press would make Enter mean different things depending on
  // a list the user may not have looked at. The next Enter confirms.
  if (r.kind === 'text' && highlighted.value >= 0) {
    e.preventDefault()
    const pick = suggestions.value[highlighted.value]
    if (pick) take(pick)
    return
  }
  if (r.kind === 'notice' || (r.kind === 'text' && !danger.value)) {
    e.preventDefault()
    accept()
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="req"
      class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      @click.self="cancel"
      @keydown="onKey"
    >
      <div
        ref="panel"
        data-dialog
        tabindex="-1"
        class="relative flex max-h-[80vh] w-[520px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-border bg-bg-1 shadow-2xl outline-none"
      >
        <div class="flex items-center gap-2 border-b border-border px-4 py-3">
          <span
            class="codicon codicon-sm"
            :class="
              danger
                ? 'codicon-trash text-removed'
                : req.kind === 'text'
                  ? 'codicon-edit text-fg-3'
                  : 'codicon-info text-fg-3'
            "
          />
          <span class="text-sm font-medium text-fg-1">{{ req.title }}</span>
          <button
            class="ml-auto flex h-6 w-6 items-center justify-center rounded text-fg-3 hover:bg-bg-2 hover:text-fg-1"
            :title="$t('common.close')"
            @click="cancel"
          >
            <span class="codicon codicon-sm codicon-close" />
          </button>
        </div>

        <p v-if="req.body" class="whitespace-pre-line break-words px-4 pt-3 text-sm text-fg-2">
          {{ req.body }}
        </p>

        <div v-if="req.kind === 'text'" class="min-h-0 flex flex-col px-4 pt-3">
          <label v-if="req.label" class="mb-1 block text-xs text-fg-3">{{ req.label }}</label>
          <input
            ref="input"
            v-model="draft"
            type="text"
            class="input shrink-0"
            :placeholder="req.placeholder"
          />
          <div
            v-if="suggestions.length"
            class="mt-2 min-h-0 divide-y divide-border overflow-y-auto rounded-lg border border-border"
          >
            <button
              v-for="(c, i) in suggestions"
              :key="c.value"
              class="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors"
              :class="i === highlighted ? 'bg-accent/15' : 'hover:bg-bg-2'"
              @click="take(c)"
              @mousemove="highlighted = i"
            >
              <span class="codicon codicon-sm codicon-folder shrink-0 text-fg-3" />
              <span class="flex-1 break-all font-mono text-xs text-fg-1">{{
                c.label ?? c.value
              }}</span>
            </button>
          </div>
        </div>

        <!-- A list scrolls rather than truncating: a batch of forty is exactly
             the batch whose contents you most need to be able to read. -->
        <div v-else-if="req.kind === 'pick'" class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <label
            v-for="r in rows"
            :key="r.id"
            class="flex cursor-pointer select-none items-center gap-2.5 rounded px-2 py-1.5 hover:bg-bg-2"
          >
            <input
              type="checkbox"
              class="h-4 w-4 shrink-0"
              :class="danger ? 'accent-[rgb(var(--c-removed))]' : 'accent-[rgb(var(--c-accent))]'"
              :checked="ticked.has(r.id)"
              @change="toggle(r.id)"
            />
            <span
              v-if="r.icon"
              class="codicon codicon-sm shrink-0"
              :class="[
                `codicon-${r.icon}`,
                r.loud && danger ? 'text-removed' : r.loud ? 'text-accent' : 'text-fg-3',
              ]"
            />
            <span class="min-w-0 flex-1 truncate text-sm" :title="r.prefix ? r.prefix + r.label : r.label">
              <span v-if="r.prefix" class="text-fg-3">{{ r.prefix }}</span>
              <span :class="r.loud ? 'font-medium text-fg-0' : 'text-fg-1'">{{ r.label }}</span>
            </span>
            <span
              v-if="r.badge"
              class="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium"
              :class="
                r.loud && danger
                  ? 'bg-removed/15 text-removed'
                  : r.loud
                    ? 'bg-accent/15 text-accent'
                    : 'bg-bg-2 text-fg-3'
              "
            >
              {{ r.badge }}
            </span>
          </label>
        </div>

        <div class="border-t border-border px-4 py-3" :class="{ 'mt-3': req.kind !== 'pick' }">
          <p v-if="req.kind === 'pick'" class="text-xs text-fg-3">{{ req.summary(chosen) }}</p>
          <div class="flex justify-end gap-2" :class="{ 'mt-2.5': req.kind === 'pick' }">
            <button
              v-if="req.kind !== 'notice'"
              data-dialog-cancel
              class="btn text-sm"
              @click="cancel"
            >
              {{ $t('common.cancel') }}
            </button>
            <button
              data-dialog-accept
              class="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              :class="danger ? 'bg-removed text-bg-0' : 'bg-accent text-bg-0'"
              :disabled="!canConfirm"
              @click="accept"
            >
              {{ confirmLabel || $t('common.ok') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
