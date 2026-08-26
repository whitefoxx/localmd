<script setup lang="ts">
/**
 * The landing page's pricing section.
 *
 * Extracted from LandingAbout for the same reason the Licence pane was
 * extracted from Settings: an edition with nothing to sell should not carry the
 * markup for a price. The landing page renders whatever the edition gives it
 * here, and says nothing about money when that is nothing.
 */
import { useUiStore } from '@/stores/ui'
import { PRICE_USD } from '@/lib/pricing'
import { vReveal } from '@/composables/useReveal'

const ui = useUiStore()
</script>

<template>
  <!-- Sits after "what we don't do" and before the closing call to action:
       someone who has read this far is deciding, and "what will this cost me"
       is the last question before they do. -->
  <section class="border-t border-border">
    <div class="landing-wrap py-24">
      <div v-reveal class="mb-3 font-mono text-xs uppercase tracking-wider text-fg-3">
        [[ {{ $t('pricing.label') }} ]]
      </div>
      <h2 v-reveal="1" class="font-display mb-5 text-[1.7rem] leading-tight text-fg-0 sm:text-[2.1rem]">
        {{ $t('pricing.title') }}
      </h2>
      <p v-reveal="2" class="mb-9 max-w-[44rem] leading-relaxed text-fg-2">{{ $t('pricing.line') }}</p>
      <div class="grid gap-5 sm:grid-cols-2">
        <div v-reveal="2" class="rounded-lg border border-border p-6">
          <div class="font-display mb-2 text-lg text-fg-0">{{ $t('pricing.freeTitle') }}</div>
          <p class="text-[0.95rem] leading-relaxed text-fg-2">{{ $t('pricing.freeBody') }}</p>
        </div>
        <div v-reveal="3" class="rounded-lg border border-accent/40 bg-accent/[0.04] p-6">
          <div class="mb-2 flex items-baseline gap-2.5">
            <span class="font-display text-lg text-fg-0">{{ $t('pricing.paidTitle') }}</span>
            <span class="font-mono text-sm text-accent">{{ $t('pricing.price', { n: PRICE_USD }) }}</span>
          </div>
          <p class="text-[0.95rem] leading-relaxed text-fg-2">{{ $t('pricing.paidBody') }}</p>
        </div>
      </div>
      <p v-reveal class="mt-6 max-w-[44rem] text-sm leading-relaxed text-fg-3">
        {{ $t('pricing.notLive') }}
      </p>
      <button v-reveal class="btn mt-4 px-4 py-1.5 text-sm" @click="ui.pricingOpen = true">
        {{ $t('pricing.cta') }}
      </button>
    </div>
  </section>
</template>
