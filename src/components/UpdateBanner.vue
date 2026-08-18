<script setup lang="ts">
/**
 * Offers the waiting build (see stores/update). Mounted at the root rather
 * than inside the workspace: it is only ever shown with a KB open today, but
 * the decision of *when* to offer belongs to main.ts, not to where this hangs.
 *
 * Bottom-right, clear of the read-aloud bar (bottom-centre) and of the
 * activity bar, so it can never sit on top of a control the user is reaching
 * for. Dismissible, and it does not come back this session — a prompt that
 * cannot be got rid of is a reload with extra steps.
 */
import { useUpdateStore } from '@/stores/update'

const update = useUpdateStore()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="update.ready"
      role="status"
      class="fixed bottom-4 right-4 z-50 w-[19rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-bg-1 p-3 shadow-xl"
    >
      <div class="flex items-start gap-2">
        <span class="codicon codicon-sm codicon-cloud-download mt-0.5 text-accent" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-fg-1">{{ $t('update.title') }}</div>
          <div class="mt-1 text-xs leading-relaxed text-fg-3">{{ $t('update.body') }}</div>
          <div class="mt-3 flex items-center gap-2">
            <button class="btn btn-primary text-xs" :disabled="update.applying" @click="update.applyNow()">
              {{ update.applying ? $t('update.applying') : $t('update.apply') }}
            </button>
            <!-- Never disabled, deliberately: this is the way out if the
                 reload itself goes nowhere. -->
            <button class="btn text-xs" @click="update.dismiss()">
              {{ $t('update.later') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
