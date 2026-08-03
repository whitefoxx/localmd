<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '@/stores/ui'
import {
  PRICE_USD,
  EARLY_SLOTS_TOTAL,
  EARLY_SLOT_DAYS,
  slotsLeft,
  contactHref,
  earlyAccessOpen,
} from '@/lib/pricing'

const ui = useUiStore()

/** Hidden entirely when no contact is configured, rather than shown with a
 *  dead button: an offer you cannot accept is worse than no offer. */
const slotsOpen = computed(() => earlyAccessOpen())
const href = computed(() => contactHref())
const left = computed(() => slotsLeft())
</script>

<template>
  <Teleport to="body">
    <div
      v-if="ui.pricingOpen"
      class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-6"
      @click.self="ui.pricingOpen = false"
    >
      <div class="w-[560px] max-w-full max-h-[86vh] overflow-y-auto rounded-lg border border-border bg-bg-1">
        <div class="flex items-center gap-2 px-5 h-12 border-b border-border sticky top-0 bg-bg-1">
          <span class="font-semibold text-fg-0">{{ $t('pricing.dialogTitle') }}</span>
          <button
            class="ml-auto text-fg-3 hover:text-fg-0"
            :title="$t('pricing.close')"
            @click="ui.pricingOpen = false"
          >
            <span class="codicon codicon-close" />
          </button>
        </div>

        <div class="px-5 py-5 space-y-5">
          <div>
            <div class="text-2xl font-bold text-fg-0">{{ $t('pricing.price', { n: PRICE_USD }) }}</div>
            <p class="text-sm text-fg-2 leading-relaxed mt-1">{{ $t('pricing.priceNote') }}</p>
          </div>

          <p class="text-sm text-fg-2 leading-relaxed">{{ $t('pricing.paidBody') }}</p>

          <div class="rounded border border-border bg-bg-2 px-4 py-3">
            <p class="text-sm text-fg-2 leading-relaxed">{{ $t('pricing.dialogNotLive') }}</p>
          </div>

          <div v-if="slotsOpen" class="border-t border-border pt-5 space-y-3">
            <div class="text-fg-0 font-semibold">{{ $t('pricing.slotsTitle') }}</div>
            <p class="text-sm text-fg-2 leading-relaxed">
              {{ $t('pricing.slotsBody', { left, total: EARLY_SLOTS_TOTAL, days: EARLY_SLOT_DAYS }) }}
            </p>
            <p class="text-xs text-fg-3 leading-relaxed">
              {{ $t('pricing.slotsNote', { days: EARLY_SLOT_DAYS }) }}
            </p>
            <a
              v-if="href"
              class="btn-primary inline-flex px-4 py-2 text-sm"
              :href="href"
              target="_blank"
              rel="noopener"
            >{{ $t('pricing.slotsCta') }}</a>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
