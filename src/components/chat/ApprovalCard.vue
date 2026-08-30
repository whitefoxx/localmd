<script setup lang="ts">
/**
 * An ask-first write, decided where it was proposed: the card sits in the
 * transcript right under the tool call that paused, carrying the diff and the
 * two buttons. The turn hangs until one of them is pressed — there is nothing
 * to miss and nowhere else to look.
 *
 * Once decided (or once the turn dies), the card keeps its place as a
 * read-only record of what was asked and what was answered.
 */
import { computed } from 'vue'
import { t } from '@/i18n'
import { renumberMessage } from '@/lib/renumber'
import { useApprovalsStore } from '@/stores/approvals'
import type { MessagePart } from '@/stores/chat'

const props = defineProps<{ part: Extract<MessagePart, { type: 'approval' }> }>()

const approvals = useApprovalsStore()

const pending = computed(() => !props.part.decision)

/** What is being asked, in one paragraph. Deletions carry their own warning
 *  weight; a plain write is introduced by whether the file exists yet. A
 *  renumber is not a write at all and states its own case — composed by
 *  lib/renumber, the same sentences the viewers show, so the two can never
 *  drift into describing the hazard differently. */
const headline = computed(() => {
  const p = props.part
  if (p.renumber) return renumberMessage(p.renumber)
  if (p.moved) return t('chat.approvalMove')
  if (p.deleted) return t(p.restorable ? 'chat.approvalDelete' : 'chat.approvalDeleteFinal')
  return t(p.removed > 0 ? 'chat.approvalWrite' : 'chat.approvalCreate')
})

/** Whose file this is. Said out loud only for the user's own material —
 *  the assistant's drafts are the unremarkable case, and a line on every
 *  card would be a line nobody reads. Never on a renumber card: what is at
 *  stake there is the notes citing the document, not the document. */
const ownership = computed(() =>
  props.part.mine || props.part.renumber ? null : 'chat.approvalYours',
)

const decisionLabel = computed(() =>
  props.part.decision === 'approved'
    ? 'chat.approvalApproved'
    : props.part.decision === 'rejected'
      ? 'chat.approvalRejected'
      : 'chat.approvalStopped',
)

const decisionIcon = computed(() =>
  props.part.decision === 'approved'
    ? 'codicon-check text-added'
    : props.part.decision === 'rejected'
      ? 'codicon-close text-removed'
      : 'codicon-stop-circle text-fg-3',
)
</script>

<template>
  <div
    class="my-2.5 rounded-xl border px-3 py-2.5"
    :class="pending ? 'border-accent/40 bg-accent/5' : 'border-border bg-bg-1'"
  >
    <div class="flex items-center gap-1.5 min-w-0">
      <span
        class="codicon codicon-sm shrink-0"
        :class="
          part.renumber
            ? 'codicon-warning text-removed'
            : part.deleted
              ? 'codicon-diff-removed text-removed'
              : part.removed > 0
                ? 'codicon-diff-modified text-accent'
                : 'codicon-diff-added text-added'
        "
      />
      <span class="text-sm font-mono text-fg-1 truncate flex-1" :title="part.path">{{ part.path }}</span>
      <span v-if="!part.deleted && !part.renumber" class="shrink-0 text-xs font-mono tabular-nums">
        <span class="text-added">+{{ part.added }}</span>
        <span class="text-removed ml-1.5">−{{ part.removed }}</span>
      </span>
    </div>

    <p
      class="mt-0.5 text-xs leading-relaxed"
      :class="(part.deleted && !part.restorable) || part.renumber ? 'text-removed' : 'text-fg-3'"
    >
      {{ headline }}
    </p>
    <!-- Whose file this is. Only said for the user's own material: the
         assistant's drafts are the unremarkable case, and a line on every
         card is a line nobody reads. -->
    <p v-if="ownership" class="mt-0.5 text-[11px] text-fg-3">{{ $t(ownership) }}</p>

    <div
      v-if="part.diff.length && !part.renumber"
      class="mt-1.5 max-h-64 overflow-auto rounded bg-bg-2 font-mono text-xs leading-5 selectable"
    >
      <template v-for="(line, i) in part.diff" :key="i">
        <div v-if="line.type === 'skip'" class="px-2 py-0.5 text-center text-fg-3 select-none">
          {{ $t('review.unchangedLines', { n: line.count }) }}
        </div>
        <div
          v-else
          class="px-2 whitespace-pre-wrap break-words"
          :class="{
            'bg-added/10 text-added': line.type === 'add',
            'bg-removed/10 text-removed': line.type === 'del',
            'text-fg-2': line.type === 'same',
          }"
        >{{ line.text || ' ' }}</div>
      </template>
      <div v-if="part.truncated" class="px-2 py-0.5 text-center text-fg-3 select-none">
        {{ $t('chat.approvalMoreLines', { n: part.truncated }) }}
      </div>
    </div>

    <!-- Pending: the two buttons the turn is waiting on. -->
    <div v-if="pending" class="mt-2 flex items-center gap-2">
      <button class="btn-primary text-xs" @click="approvals.settle(part.approvalId, 'approved')">
        {{ $t('chat.approvalApprove') }}
      </button>
      <button class="btn text-xs" @click="approvals.settle(part.approvalId, 'rejected')">
        {{ $t('chat.approvalReject') }}
      </button>
      <span class="text-xs text-fg-3">{{ $t('chat.approvalPending') }}</span>
    </div>
    <!-- Decided: a quiet receipt. -->
    <div v-else class="mt-2 flex items-center gap-1.5 text-xs text-fg-3">
      <span class="codicon codicon-sm" :class="decisionIcon" />
      {{ $t(decisionLabel) }}
    </div>
  </div>
</template>
