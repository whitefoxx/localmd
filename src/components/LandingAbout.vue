<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import { useUiStore } from '@/stores/ui'
import { PRICE_USD } from '@/lib/pricing'
import { SELECTABLE_PROVIDERS } from '@/lib/providers'
import { FEEDBACK_URL } from '@/lib/links'
import { vReveal } from '@/composables/useReveal'
import { useThemeStore } from '@/stores/theme'
import citeNoteLight from '@/assets/landing-cite-note.jpg'
import citeNoteDark from '@/assets/landing-cite-note-dark.jpg'
import citePdfShot from '@/assets/landing-cite-pdf.jpg'
import scatterLight from '@/assets/landing-scatter.png'
import scatterDark from '@/assets/landing-scatter-dark.png'

defineEmits<{ open: [] }>()

const ui = useUiStore()
const theme = useThemeStore()

/** Both detail shots arrive already cropped to the window they are shown in —
 *  see `scripts/shoot-landing.mjs`, which owns those coordinates. The PDF one
 *  has no dark twin because the crop is all PDF page, and a page is white paper
 *  in either theme. */
const citeNoteShot = computed(() => (theme.isDark ? citeNoteDark : citeNoteLight))

/** The drawing beside "your knowledge is scattered". Authored as a standalone
 *  page — `scripts/diagram-scatter.html`, rendered by `npm run shoot:diagram`
 *  — so it can be opened in a browser and adjusted directly. */
const scatterShot = computed(() => (theme.isDark ? scatterDark : scatterLight))

/**
 * The three pillars, in the ink band. These are the claims everything else on
 * the page has to trace back to, so they get the weight — and `diff3` is not
 * among them because it earns a section of its own below, with the two
 * screenshots that prove it. One claim, one place.
 */
const pillars = computed(() => [
  { title: t('about.diff1Title'), body: t('about.diff1Body') },
  { title: t('about.diff2Title'), body: t('about.diff2Body') },
  { title: t('about.diff4Title'), body: t('about.diff4Body') },
])

/**
 * The provider chips, read off the real table rather than typed out again —
 * a name list kept in two places is a name list that will disagree. `custom`
 * is dropped because "Custom" is not the name of anything; the catch-all it
 * stands for is spelled out as the last chip instead.
 */
const providerNames = SELECTABLE_PROVIDERS.filter((p) => p.id !== 'custom')
  // Labels carry a parenthetical for the picker ("Anthropic (Claude)"); a chip
  // wants the bare name.
  .map((p) => p.label.replace(/\s*\(.*\)\s*$/, ''))
  .concat('+ any OpenAI-compatible')

/** The remaining differences, at secondary weight. */
const alsoDiffs = computed(() => [
  { title: t('about.diff5Title'), body: t('about.diff5Body'), chips: providerNames },
  {
    title: t('about.diff6Title'),
    body: t('about.diff6Body'),
    // Named directories rather than the idea of them: "it adapts to your
    // folders" is abstract until you see one you recognise as your own.
    chips: ['~/Zotero/storage/', '~/Calibre Library/', '~/Downloads/*.pdf', '~/obsidian-vault/'],
  },
])

const believes = computed(() => [
  { title: t('about.believe1Title'), body: t('about.believe1Body') },
  { title: t('about.believe2Title'), body: t('about.believe2Body') },
  { title: t('about.believe3Title'), body: t('about.believe3Body') },
  { title: t('about.believe4Title'), body: t('about.believe4Body') },
])

/** Same convention as `donts`: the number in the key is an id, this array is
 *  the order. `does8` follows the agent's own tools, because it is those tools
 *  reaching one step further out. */
const does = computed(() => [
  t('about.does1'),
  t('about.does2'),
  t('about.does3'),
  t('about.does8'),
  t('about.does4'),
  t('about.does5'),
  t('about.does6'),
  t('about.does7'),
])

/** The key number is an id, not a position — this array is the running order.
 *  `dont8` sits next to the lock-in line because they answer the same worry
 *  from opposite ends: what it costs to leave, and what it costs to arrive. */
const donts = computed(() => [
  t('about.dont1'),
  t('about.dont2'),
  t('about.dont3'),
  t('about.dont4'),
  t('about.dont5'),
  t('about.dont8'),
  t('about.dont6'),
  t('about.dont7'),
])
</script>

<template>
  <div class="border-t border-border">
    <!-- ── Why this exists ──────────────────────────────────────────────── -->
    <section class="landing-wrap py-24">
      <div class="grid items-center gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div v-reveal class="mb-3 font-mono text-xs uppercase tracking-wider text-fg-3">
            [[ {{ $t('about.whyLabel') }} ]]
          </div>
          <h2
            v-reveal="1"
            class="font-display mb-7 max-w-[20ch] text-[1.9rem] leading-[1.15] text-fg-0 sm:text-[2.4rem]"
          >
            {{ $t('about.whyTitle') }}
          </h2>
          <div class="max-w-[38rem] space-y-5">
            <p v-reveal="2" class="leading-relaxed text-fg-2">{{ $t('about.whyBody1') }}</p>
            <p v-reveal="3" class="leading-relaxed text-fg-2">{{ $t('about.whyBody2') }}</p>
          </div>
        </div>

        <!-- Decorative: the paragraph beside it already says this in words. -->
        <div v-reveal="2" class="justify-self-center" aria-hidden="true">
          <img
            :src="scatterShot"
            alt=""
            width="460"
            height="416"
            class="w-[460px] max-w-full"
          />
        </div>
      </div>
    </section>

    <!-- ── The three pillars, in ink ────────────────────────────────────── -->
    <section class="ink border-y border-border">
      <div class="landing-wrap py-24">
        <div v-reveal class="mb-12 font-mono text-xs uppercase tracking-wider text-fg-3">
          [[ {{ $t('about.diffLabel') }} ]]
        </div>
        <div class="grid gap-x-10 gap-y-12 md:grid-cols-3">
          <div v-for="(p, i) in pillars" :key="p.title" v-reveal="i">
            <div class="mb-4 font-mono text-sm text-accent">{{ String(i + 1).padStart(2, '0') }}</div>
            <h3 class="font-display mb-3 text-xl leading-snug text-fg-0">{{ p.title }}</h3>
            <p class="text-[0.95rem] leading-relaxed text-fg-2">{{ p.body }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ── The citation round trip, shown rather than described ──────────
         The one claim on this page that a picture can settle: the chip in
         your own Markdown, and the paragraph it opens. -->
    <section class="landing-wrap py-24">
      <div v-reveal class="mb-3 font-mono text-xs uppercase tracking-wider text-fg-3">
        [[ {{ $t('about.showLabel') }} ]]
      </div>
      <h2
        v-reveal="1"
        class="font-display mb-5 max-w-[26ch] text-[1.7rem] leading-[1.15] text-fg-0 sm:text-[2.1rem]"
      >
        {{ $t('about.diff3Title') }}
      </h2>
      <p v-reveal="2" class="mb-12 max-w-[44rem] leading-relaxed text-fg-2">
        {{ $t('about.diff3Body') }}
      </p>

      <div class="grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr]" aria-hidden="true">
        <figure v-reveal="3">
          <div class="app-frame shot-fade-r">
            <!-- object-left so the sliver this loses to its column comes off
                 the right, which is the edge that fades. -->
            <img :src="citeNoteShot" alt="" class="block h-[260px] w-full object-cover object-left" />
          </div>
          <figcaption class="mt-3 font-mono text-xs leading-relaxed text-fg-3">
            {{ $t('about.showCapNote') }}
          </figcaption>
        </figure>

        <div class="flex justify-center text-fg-3">
          <span class="codicon codicon-arrow-right rotate-90 text-2xl lg:rotate-0" />
        </div>

        <figure v-reveal="4">
          <div class="app-frame shot-paper">
            <img :src="citePdfShot" alt="" class="block h-[260px] w-full object-cover" />
          </div>
          <figcaption class="mt-3 font-mono text-xs leading-relaxed text-fg-3">
            {{ $t('about.showCapPdf') }}
          </figcaption>
        </figure>
      </div>
    </section>

    <!-- ── The remaining differences ────────────────────────────────────── -->
    <section class="landing-wrap pb-24">
      <div class="grid gap-10 md:grid-cols-2">
        <div v-for="(d, i) in alsoDiffs" :key="d.title" v-reveal="i" class="rounded-lg border border-border p-6">
          <h3 class="font-display mb-2.5 text-lg leading-snug text-fg-0">{{ d.title }}</h3>
          <p class="text-[0.95rem] leading-relaxed text-fg-2">{{ d.body }}</p>
          <div v-if="d.chips.length" class="mt-5 flex flex-wrap gap-2">
            <code
              v-for="chip in d.chips"
              :key="chip"
              class="rounded border border-border bg-bg-1 px-2 py-1 font-mono text-xs text-fg-2"
            >
              {{ chip }}
            </code>
          </div>
        </div>
      </div>
    </section>

    <!-- ── What we believe ──────────────────────────────────────────────── -->
    <section class="border-t border-border">
      <div class="landing-wrap py-24">
        <div v-reveal class="mb-10 font-mono text-xs uppercase tracking-wider text-fg-3">
          [[ {{ $t('about.believeLabel') }} ]]
        </div>
        <div class="grid gap-x-12 gap-y-9 md:grid-cols-2">
          <div v-for="(b, i) in believes" :key="b.title" v-reveal="i % 2">
            <div class="font-display mb-1.5 text-lg text-fg-0">{{ b.title }}</div>
            <p class="text-[0.95rem] leading-relaxed text-fg-2">{{ b.body }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Does / doesn't, set against each other ───────────────────────── -->
    <section class="border-t border-border">
      <div class="landing-wrap grid gap-x-14 gap-y-14 py-24 md:grid-cols-2">
        <div v-reveal>
          <div class="mb-6 font-mono text-xs uppercase tracking-wider text-fg-3">
            [[ {{ $t('about.doesLabel') }} ]]
          </div>
          <ul class="space-y-3.5">
            <li v-for="(f, i) in does" :key="i" class="flex gap-3 text-[0.95rem] text-fg-1">
              <span class="codicon codicon-check mt-0.5 shrink-0 text-accent" />
              <span class="leading-relaxed">{{ f }}</span>
            </li>
          </ul>
        </div>
        <div v-reveal="1">
          <div class="mb-6 font-mono text-xs uppercase tracking-wider text-fg-3">
            [[ {{ $t('about.dontLabel') }} ]]
          </div>
          <ul class="space-y-3.5">
            <li v-for="(f, i) in donts" :key="i" class="flex gap-3 text-[0.95rem] text-fg-2">
              <span class="codicon codicon-close mt-0.5 shrink-0 text-fg-3" />
              <span class="leading-relaxed">{{ f }}</span>
            </li>
          </ul>
        </div>

        <!-- The browser limit belongs with the rest of what we will not
             pretend about, rather than in front of the button on the first
             screen. Native <details> so it costs no script and opens for a
             keyboard the same way it opens for a mouse. -->
        <details v-reveal class="border-t border-border pt-6 md:col-span-2">
          <summary
            class="inline-flex cursor-pointer list-none items-center gap-1.5 text-fg-2 transition-colors hover:text-fg-0 [&::-webkit-details-marker]:hidden"
          >
            <span class="codicon codicon-sm codicon-question" />{{ $t('openKb.whyChrome') }}
          </summary>
          <p class="mt-3 max-w-[44rem] text-[0.95rem] leading-relaxed text-fg-3">
            {{ $t('openKb.whyChromeBody') }}
          </p>
        </details>
      </div>
    </section>

    <!-- ── Pricing. Sits after "what we don't do" and before the closing call
         to action: someone who has read this far is deciding, and "what will
         this cost me" is the last question before they do. ──────────────── -->
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

    <!-- ── Closing ──────────────────────────────────────────────────────── -->
    <section class="ink border-t border-border">
      <div class="landing-grid relative landing-wrap py-28 text-center">
        <h2 v-reveal class="font-display mb-8 text-[1.9rem] leading-tight text-fg-0 sm:text-[2.4rem]">
          {{ $t('about.closingTitle') }}
        </h2>
        <button v-reveal="1" class="btn-cta text-base" @click="$emit('open')">
          <span class="codicon codicon-folder-opened" />{{ $t('openKb.openFolder') }}
        </button>
        <div class="mt-14 text-xs text-fg-3">
          {{ $t('about.footer') }}
          <span class="mx-1.5 opacity-40">·</span>
          <a
            :href="FEEDBACK_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="underline decoration-fg-3/40 underline-offset-2 hover:text-fg-1"
            >{{ $t('about.feedback') }}</a
          >
        </div>
      </div>
    </section>
  </div>
</template>
