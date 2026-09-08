<script setup lang="ts">
/**
 * The KB health section's illustration: the report, drawn.
 *
 * The four headings are read from the `health` catalog rather than typed out
 * here, so this is a picture of the real panel in the reader's own language,
 * and it cannot drift from what the panel actually calls things. The counts
 * are illustrative: a folder someone has been using and has not tidied.
 *
 * HTML rather than SVG, unlike the other two drawings on this page. Those are
 * diagrams with lines to draw; this is a list, and a list in SVG is a list
 * with hand-computed line breaks that a longer translation would overflow.
 */
import { computed } from 'vue'
import { t } from '@/i18n'

const findings = computed(() => [
  { n: 3, label: t('health.brokenHeading') },
  { n: 2, label: t('health.orphansHeading') },
  { n: 12, label: t('health.unreadHeading') },
  { n: 1, label: t('health.staleHeading') },
])
</script>

<template>
  <div class="app-frame text-[13px] leading-relaxed">
    <div
      class="flex items-center justify-between border-b border-border px-4 py-2 font-mono text-[11px] text-fg-3"
    >
      <span>{{ $t('health.title') }}</span>
      <span>214 files</span>
    </div>
    <ul class="px-5 py-4">
      <li v-for="f in findings" :key="f.label" class="flex items-baseline gap-3 py-1">
        <span class="w-6 shrink-0 text-right font-mono text-accent">{{ f.n }}</span>
        <span class="text-fg-2">{{ f.label }}</span>
      </li>
    </ul>
    <div class="border-t border-border px-4 py-2 font-mono text-[11px] text-fg-3">
      {{ $t('about.healthCap') }}
    </div>
  </div>
</template>
