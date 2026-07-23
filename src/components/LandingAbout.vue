<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'

defineEmits<{ open: [] }>()

const diffs = computed(() => [
  { title: t('about.diff1Title'), body: t('about.diff1Body') },
  { title: t('about.diff2Title'), body: t('about.diff2Body') },
  { title: t('about.diff3Title'), body: t('about.diff3Body') },
  { title: t('about.diff4Title'), body: t('about.diff4Body') },
  { title: t('about.diff5Title'), body: t('about.diff5Body') },
])

const believes = computed(() => [
  { title: t('about.believe1Title'), body: t('about.believe1Body') },
  { title: t('about.believe2Title'), body: t('about.believe2Body') },
  { title: t('about.believe3Title'), body: t('about.believe3Body') },
  { title: t('about.believe4Title'), body: t('about.believe4Body') },
])

const does = computed(() => [
  t('about.does1'),
  t('about.does2'),
  t('about.does3'),
  t('about.does4'),
  t('about.does5'),
  t('about.does6'),
  t('about.does7'),
])

const donts = computed(() => [
  t('about.dont1'),
  t('about.dont2'),
  t('about.dont3'),
  t('about.dont4'),
  t('about.dont5'),
  t('about.dont6'),
])
</script>

<template>
  <div class="border-t border-border">
    <div class="mx-auto max-w-2xl px-6 py-24 space-y-24">
      <!-- Why this exists -->
      <section>
        <div class="text-xs uppercase tracking-wide text-fg-3 mb-3">{{ $t('about.whyLabel') }}</div>
        <h2 class="text-2xl font-bold text-fg-0 leading-snug mb-5">{{ $t('about.whyTitle') }}</h2>
        <p class="text-fg-2 leading-relaxed mb-4">{{ $t('about.whyBody1') }}</p>
        <p class="text-fg-2 leading-relaxed">{{ $t('about.whyBody2') }}</p>
      </section>

      <!-- What makes it different -->
      <section>
        <div class="text-xs uppercase tracking-wide text-fg-3 mb-5">{{ $t('about.diffLabel') }}</div>
        <div class="space-y-6">
          <div v-for="d in diffs" :key="d.title">
            <div class="text-fg-0 font-semibold">{{ d.title }}</div>
            <p class="text-fg-2 leading-relaxed mt-1">{{ d.body }}</p>
          </div>
        </div>
      </section>

      <!-- What we believe -->
      <section>
        <div class="text-xs uppercase tracking-wide text-fg-3 mb-5">{{ $t('about.believeLabel') }}</div>
        <div class="space-y-6">
          <div v-for="b in believes" :key="b.title">
            <div class="text-fg-0 font-semibold">{{ b.title }}</div>
            <p class="text-fg-2 leading-relaxed mt-1">{{ b.body }}</p>
          </div>
        </div>
      </section>

      <!-- What it does -->
      <section>
        <div class="text-xs uppercase tracking-wide text-fg-3 mb-5">{{ $t('about.doesLabel') }}</div>
        <ul class="space-y-3">
          <li v-for="(f, i) in does" :key="i" class="flex gap-3 text-fg-1">
            <span class="codicon codicon-check text-accent mt-0.5 shrink-0" />
            <span class="leading-relaxed">{{ f }}</span>
          </li>
        </ul>
      </section>

      <!-- What we don't do -->
      <section>
        <div class="text-xs uppercase tracking-wide text-fg-3 mb-5">{{ $t('about.dontLabel') }}</div>
        <ul class="space-y-3">
          <li v-for="(f, i) in donts" :key="i" class="flex gap-3 text-fg-2">
            <span class="codicon codicon-close text-fg-3 mt-0.5 shrink-0" />
            <span class="leading-relaxed">{{ f }}</span>
          </li>
        </ul>
      </section>

      <!-- Closing -->
      <section class="text-center pt-4">
        <h2 class="text-2xl font-bold text-fg-0 mb-6">{{ $t('about.closingTitle') }}</h2>
        <button class="btn-primary px-6 py-2 text-base" @click="$emit('open')">
          <span class="codicon codicon-folder-opened mr-2" />{{ $t('openKb.openFolder') }}
        </button>
        <div class="mt-12 text-xs text-fg-3">{{ $t('about.footer') }}</div>
      </section>
    </div>
  </div>
</template>
