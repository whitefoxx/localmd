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
import {
  pendingDialog,
  registerDialogHost,
  settleDialog,
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
  if (e.key !== 'Enter') return
  const r = req.value
  if (!r) return
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

        <div v-if="req.kind === 'text'" class="px-4 pt-3">
          <label v-if="req.label" class="mb-1 block text-xs text-fg-3">{{ req.label }}</label>
          <input
            ref="input"
            v-model="draft"
            type="text"
            class="input"
            :placeholder="req.placeholder"
          />
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
            <button v-if="req.kind !== 'notice'" class="btn text-sm" @click="cancel">
              {{ $t('common.cancel') }}
            </button>
            <button
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
