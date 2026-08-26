<script setup lang="ts">
/**
 * The Licence pane in Settings: paste a key, read what it says, reach the price.
 *
 * A whole component the edition hands to SettingsModal rather than another
 * branch inside it, because every line here is about something to buy. An
 * edition with no paid tier has no pane at all — not an empty one, and not a
 * nav entry leading nowhere.
 */
import { computed } from 'vue'
import { useLicenceStore } from '@/stores/licence'
import { useUiStore } from '@/stores/ui'
import { ENFORCE_LICENCE } from '@/lib/licence'
import { t } from '@/i18n'

const licence = useLicenceStore()
const ui = useUiStore()

/** One line saying where the reader stands. Every branch of the verdict gets
 *  its own sentence — an expired key and an invalid one are not the same news,
 *  and "we couldn't check" must never read as "yours is fake". */
const licenceStatus = computed<{ text: string; tone: 'ok' | 'warn' | 'muted' }>(() => {
  const v = licence.verdict
  // "Locked" would be a lie while enforcement is off — nothing refuses yet.
  if (!v) {
    return {
      text: t(ENFORCE_LICENCE ? 'settings.licenceNone' : 'settings.licenceNoneYet'),
      tone: 'muted',
    }
  }
  switch (v.status) {
    case 'valid': {
      const days = licence.remainingDays
      if (days === null) return { text: t('settings.licenceValid'), tone: 'ok' }
      if (days === 0) return { text: t('settings.licenceLastDay'), tone: 'warn' }
      return { text: t('settings.licenceValidUntil', { days }), tone: 'ok' }
    }
    case 'expired':
      return { text: t('settings.licenceExpired', { date: v.licence.expires ?? '' }), tone: 'warn' }
    case 'bad-signature':
      return { text: t('settings.licenceBad'), tone: 'warn' }
    case 'malformed':
      return { text: t('settings.licenceBad'), tone: 'warn' }
    case 'unverifiable':
      return { text: t('settings.licenceUnverifiable', { reason: v.reason }), tone: 'warn' }
  }
})

/** The name inside the key. Shown for expired keys too — "licensed to you,
 *  ran out" is a friendlier fact than either half alone. */
const licenceHolder = computed<string | null>(() => {
  const v = licence.verdict
  if (!v || (v.status !== 'valid' && v.status !== 'expired')) return null
  return v.licence.to ?? null
})
</script>

<template>
  <div class="space-y-4 max-w-md">
    <div>
      <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">{{ $t('settings.licenceKeyLabel') }}</label>
      <textarea
        v-model="licence.key"
        rows="3"
        class="input font-mono text-xs leading-relaxed"
        :placeholder="$t('settings.licencePlaceholder')"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <div class="flex items-center gap-2">
      <span
        class="text-xs"
        :class="{
          'text-green-500': licenceStatus.tone === 'ok',
          'text-amber-500': licenceStatus.tone === 'warn',
          'text-fg-3': licenceStatus.tone === 'muted',
        }"
      >{{ licenceStatus.text }}</span>
      <button v-if="licence.key" class="btn text-xs ml-auto" @click="licence.clear()">
        {{ $t('settings.licenceRemove') }}
      </button>
    </div>
    <p v-if="licenceHolder" class="text-xs text-fg-3">
      {{ $t('settings.licenceHolder', { to: licenceHolder }) }}
    </p>
    <p class="text-xs text-fg-3 leading-relaxed">{{ $t('settings.licenceCovers') }}</p>
    <p class="text-xs text-fg-3 leading-relaxed">{{ $t('settings.licenceOffline') }}</p>
    <button class="btn text-xs" @click="ui.pricingOpen = true">
      {{ $t('pricing.cta') }}
    </button>
  </div>
</template>
