<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import { SELECTABLE_PROVIDERS } from '@/lib/providers'
import { CONNECT_SOURCE_URL, CONNECT_STORE_URL, FEEDBACK_URL, LLM_WIKI_URL, SOURCE_URL } from '@/lib/links'
import CitationDemo from '@/components/CitationDemo.vue'
import ConnectFlow from '@/components/ConnectFlow.vue'
import HealthReport from '@/components/HealthReport.vue'
import LocalFirst from '@/components/LocalFirst.vue'
import { vReveal } from '@/composables/useReveal'

defineEmits<{ open: [] }>()

/**
 * The approval story, three lines. Each one names a mechanism that exists —
 * the diff review, ask-first mode, git — not a promise about intent.
 */
const reviews = computed(() => [
  { icon: 'codicon-diff', text: t('about.review1') },
  { icon: 'codicon-comment', text: t('about.review2') },
  { icon: 'codicon-git-commit', text: t('about.review3') },
])

/**
 * The provider chips, read off the real table rather than typed out again —
 * a name list kept in two places is a name list that will disagree. `custom`
 * is dropped because "Custom" is not the name of anything; the catch-all it
 * stands for is spelled out as the last chip instead.
 */
const CHIP_RENAME: Record<string, string> = { 'Google Gemini': 'Gemini', 'Zhipu GLM': 'GLM' }
const CHIP_DROP = new Set(['Groq', 'MiniMax'])
const providerNames = SELECTABLE_PROVIDERS.filter((p) => p.id !== 'custom')
  // Labels carry a parenthetical for the picker ("Anthropic (Claude)"); a chip
  // wants the bare name — and the chip row is a taste, not the full table, so
  // a couple of long tails are dropped and two names shortened for rhythm.
  .map((p) => p.label.replace(/\s*\(.*\)\s*$/, ''))
  .filter((label) => !CHIP_DROP.has(label))
  .map((label) => CHIP_RENAME[label] ?? label)
  .concat('+ any OpenAI-compatible')

/**
 * The three cards. Everything else on the page traces back to one of these —
 * the citation round trip is not among them because it opens the page with
 * its own screenshots, and the agent-in-your-files claim is the hero's job
 * now. One claim, one place.
 */
const pillars = computed(() => [
  {
    title: t('about.diff1Title'),
    body: t('about.diff1Body'),
    chips: [] as string[],
    urlbar: true,
    span: 'md:col-span-12',
    free: false,
  },
  {
    title: t('about.adaptTitle'),
    body: t('about.adaptBody'),
    urlbar: false,
    span: 'md:col-span-6',
    free: false,
    // Named directories rather than the idea of them: "it adapts to your
    // folders" is abstract until you see one you recognise as your own.
    chips: ['~/Zotero/storage/', '~/Calibre Library/', '~/Downloads/*.pdf', '~/Documents/', '~/obsidian-vault/'],
  },
  {
    title: t('about.diff5Title'),
    body: t('about.diff5Body'),
    chips: providerNames,
    urlbar: false,
    span: 'md:col-span-6',
    free: true,
  },
])

/** The capability nouns, split for rendering as checked chips. */
const caps = computed(() => t('about.caps').split('\u00b7').map((c) => c.trim()))

/**
 * The account of where this came from. The one place on the page that says
 * "I" — see the note on `whyLabel` in the catalog for why it is one place and
 * not the page's voice. Two paragraphs carry a link and are assembled in the
 * template from their split parts, so they are not in this list.
 */
const whyPlain = computed(() => ({ one: t('about.why1'), three: t('about.why3') }))
</script>

<template>
  <div class="border-t border-border">
    <!-- ── 1 · Local-first ─────────────────────────────────────────────
         Where your things are and where they go, said once and first: it is
         the promise every other section leans on. The drawing beside it is
         the folder as a terminal would list it, and the database there is
         not. The data-flow list follows the prose as the checkable version
         of it. The root div already draws the top rule, so this section does
         not. -->
    <section>
      <div class="landing-wrap grid items-center gap-x-16 gap-y-12 py-24 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div v-reveal class="mb-3 font-mono text-xs uppercase tracking-wider text-fg-3">
            [[ {{ $t('about.localLabel') }} ]]
          </div>
          <h2
            v-reveal="1"
            class="font-display mb-6 max-w-[24ch] text-[1.7rem] leading-[1.15] text-fg-0 sm:text-[2.1rem]"
          >
            {{ $t('about.localTitle') }}
          </h2>
          <p v-reveal="2" class="max-w-[38rem] leading-relaxed text-fg-2">
            {{ $t('about.localBody') }}
          </p>
          <div v-reveal="3" class="mt-8 max-w-[38rem] border-t border-border pt-4">
            <div class="mb-3 font-mono text-xs uppercase tracking-wider text-fg-3">
              [[ {{ $t('about.flowLabel') }} ]]
            </div>
            <ul class="space-y-2 text-[0.95rem] leading-relaxed text-fg-2">
              <li>{{ $t('about.flow1') }}</li>
              <li>{{ $t('about.flow2') }}</li>
              <li>{{ $t('about.flow3') }}</li>
            </ul>
          </div>
        </div>

        <div v-reveal="2" class="w-[460px] max-w-full justify-self-center" aria-hidden="true">
          <LocalFirst />
        </div>
      </div>
    </section>

    <!-- ── 2 · The citation round trip, shown rather than described ──────
         Show first, explain never: the one claim on this page a picture can
         settle opens it. The chip in your own Markdown, and the paragraph it
         opens in the source. -->
    <section class="landing-grain relative border-t border-border bg-bg-1">
      <div class="landing-wrap py-24">
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

        <!-- The round trip, drawn: click a chip in the note and the block it
             points to lights up in the source. Drawn rather than screenshotted
             so it follows the theme; interactive rather than animated so
             nothing appears or disappears. The reader does the clicking. -->
        <CitationDemo />
      </div>
    </section>

    <!-- ── 3 · The three cards ──────────────────────────────────────────── -->
    <section class="landing-wrap py-24">
      <div v-reveal class="mb-3 font-mono text-xs uppercase tracking-wider text-fg-3">
        [[ {{ $t('about.diffLabel') }} ]]
      </div>
      <h2
        v-reveal="1"
        class="font-display mb-12 max-w-[24ch] text-[1.7rem] leading-[1.15] text-fg-0 sm:text-[2.1rem]"
      >
        {{ $t('about.basicsTitle') }}
      </h2>
      <div class="grid gap-x-10 gap-y-10 md:grid-cols-12">
        <div
          v-for="(c, i) in pillars"
          :key="c.title"
          v-reveal="i"
          :class="[c.span, 'rounded-lg border border-border p-6 transition-colors duration-200 hover:border-accent/40 hover:bg-bg-1']"
        >
          <div class="mb-4 font-mono text-sm text-accent">{{ String(i + 1).padStart(2, '0') }}</div>
          <div :class="c.urlbar ? 'md:flex md:items-end md:justify-between md:gap-12' : ''">
            <div :class="c.urlbar ? 'md:max-w-[32rem]' : ''">
              <h3 class="font-display mb-3 text-xl leading-snug text-fg-0">{{ c.title }}</h3>
              <p class="text-[0.95rem] leading-relaxed text-fg-2">{{ c.body }}</p>
            </div>
            <!-- The whole install, set as type — no drawn address bar; the
                 words carry it. -->
            <div v-if="c.urlbar" class="relative mt-6 shrink-0 md:mt-0 md:text-right" aria-hidden="true">
              <!-- The artifacts you do NOT need, struck out above the one
                   thing you do. Grey rather than red, and no ✗: these are not
                   errors or warnings, they are simply absent — a red cross
                   makes an ordinary fact look like something went wrong. -->
              <div class="mb-2.5 flex items-center gap-3 font-mono text-sm text-fg-3/70 md:justify-end">
                <span class="line-through decoration-fg-3/60 decoration-2">localmd-setup.dmg</span>
                <span class="line-through decoration-fg-3/60 decoration-2">install.exe</span>
              </div>
              <p class="font-mono text-2xl">
                <span class="lm-url text-accent underline decoration-accent/50 underline-offset-4">localmd.app</span
                ><span class="ml-1 inline-block h-5 w-[8px] animate-pulse bg-accent/80 align-[-3px]" />
              </p>
              <p class="mt-1.5 font-mono text-[11px] text-fg-3">{{ $t('about.installCap') }}</p>
              <span class="lm-click" />
              <svg class="lm-cursor" viewBox="0 0 20 20">
                <path
                  d="M3 1l13 8.5-5.6 1 3.2 6-2.6 1.2-3.1-6L3 15z"
                  fill="rgb(var(--c-accent))"
                  stroke="rgb(var(--c-bg-0))"
                  stroke-width="1"
                />
              </svg>
            </div>
          </div>
          <div v-if="c.chips.length" class="mt-5 flex flex-wrap gap-2">
            <code
              v-for="chip in c.chips"
              :key="chip"
              class="rounded border border-border bg-bg-1 px-2 py-1 font-mono text-xs text-fg-2"
            >
              {{ chip }}
            </code>
          </div>
          <div v-if="c.free" class="mt-5 flex items-start gap-2.5 border-t border-border pt-4 text-[0.95rem] text-fg-1">
            <span class="codicon codicon-key mt-0.5 shrink-0 text-fg-3" />
            <p class="leading-relaxed">{{ $t('about.freeLine') }}</p>
          </div>
        </div>
      </div>

      <!-- The feature list, reduced to its nouns — each one checked off. -->
      <div v-reveal class="mt-12 flex flex-wrap gap-x-6 gap-y-2.5 border-b border-border pb-6">
        <span v-for="c in caps" :key="c" class="inline-flex items-center gap-1.5 font-mono text-xs text-fg-2">
          <span class="codicon codicon-sm codicon-check text-added" />{{ c }}
        </span>
      </div>

      <!-- The browser note lives with the cards it qualifies. -->
      <details v-reveal class="mt-10">
        <summary
          class="inline-flex cursor-pointer list-none items-center gap-1.5 text-fg-2 transition-colors hover:text-fg-0 [&::-webkit-details-marker]:hidden"
        >
          <span class="codicon codicon-sm codicon-question" />{{ $t('openKb.whyChrome') }}
        </summary>
        <p class="mt-3 max-w-[44rem] text-[0.95rem] leading-relaxed text-fg-3">
          {{ $t('openKb.whyChromeBody') }}
        </p>
      </details>
    </section>

    <!-- ── 4 · Who decides ──────────────────────────────────────────────
         The fear-killer, shown as the thing itself: a diff card, additions
         green, originals untouched, the decision buttons waiting. Decorative
         (icons only, no strings to translate) — the lines on the left say it
         in words. -->
    <section class="landing-grain relative border-y border-border bg-bg-1">
      <div class="landing-wrap grid items-center gap-x-16 gap-y-12 py-24 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div v-reveal class="mb-3 font-mono text-xs uppercase tracking-wider text-fg-3">
            [[ {{ $t('about.reviewLabel') }} ]]
          </div>
          <h2
            v-reveal="1"
            class="font-display mb-10 text-[1.9rem] leading-[1.15] text-fg-0 sm:text-[2.4rem]"
          >
            {{ $t('about.reviewTitle') }}
          </h2>
          <ul v-reveal="2" class="max-w-[36rem] space-y-5">
            <li v-for="(r, i) in reviews" :key="i" class="flex gap-3.5 text-fg-1">
              <span :class="['codicon', r.icon, 'mt-1 shrink-0 text-accent']" />
              <span class="leading-relaxed">{{ r.text }}</span>
            </li>
          </ul>
        </div>

        <!-- A typographic frame — top rule, filename, bottom rule — not a
             drawn window: the reader's own screen already supplies chrome. -->
        <div v-reveal="2" class="w-[24rem] max-w-full justify-self-center font-mono text-[12.5px] leading-[1.9]" aria-hidden="true">
          <div class="flex items-baseline justify-between border-t border-border pt-2.5 text-fg-3">
            <span>wiki/attention.md</span>
            <span><span class="text-added">+3</span> −0</span>
          </div>
          <div class="py-3">
            <div class="text-fg-3">@@ new page @@</div>
            <div class="bg-added/10 px-1.5 text-added">+ ## Chain-of-thought, in short</div>
            <div class="bg-added/10 px-1.5 text-added">+ Emergent past ~10B params [[1:b14-3]]</div>
            <div class="bg-added/10 px-1.5 text-added">+ Sources: [[pdf1:raw/papers/attention.pdf]]</div>
            <div class="mt-2 text-fg-3">raw/papers/attention.pdf · untouched</div>
          </div>
          <div class="flex items-center gap-2.5 border-b border-border pb-3">
            <span class="inline-flex items-center rounded border border-added/50 bg-added/15 px-2.5 py-1 text-added">
              <span class="codicon codicon-sm codicon-check" />
            </span>
            <span class="inline-flex items-center rounded border border-border px-2.5 py-1 text-fg-3">
              <span class="codicon codicon-sm codicon-close" />
            </span>
            <span class="ml-auto h-4 w-1.5 animate-pulse bg-accent/70" />
          </div>
        </div>
      </div>
    </section>

    <!-- ── 5 · KB health ────────────────────────────────────────────────
         The pair to the section above: that one is every change, one at a
         time; this one is the whole folder at once. The drawing beside it is
         the report, built from the panel's own headings rather than retyped,
         so it says what the panel says. -->
    <section class="border-t border-border">
      <div
        class="landing-wrap grid items-center gap-x-16 gap-y-12 py-24 lg:grid-cols-[minmax(0,1fr)_auto]"
      >
        <div>
          <div v-reveal class="mb-3 font-mono text-xs uppercase tracking-wider text-fg-3">
            [[ {{ $t('about.healthLabel') }} ]]
          </div>
          <h2
            v-reveal="1"
            class="font-display mb-6 max-w-[24ch] text-[1.7rem] leading-[1.15] text-fg-0 sm:text-[2.1rem]"
          >
            {{ $t('about.healthTitle') }}
          </h2>
          <div class="max-w-[38rem] space-y-5 leading-relaxed text-fg-2">
            <p v-reveal="2">{{ $t('about.healthBody') }}</p>
            <p v-reveal="2">{{ $t('about.healthNote') }}</p>
          </div>
        </div>

        <div v-reveal="2" class="w-[400px] max-w-full justify-self-center" aria-hidden="true">
          <HealthReport />
        </div>
      </div>
    </section>

    <!-- ── 6 · The browser ─────────────────────────────────────────────
         The second source, and the one that is not on disk. Write actions
         ask first, and the copy keeps saying so. -->
    <section class="landing-grain relative border-t border-border bg-bg-1">
      <div class="landing-wrap grid items-center gap-x-16 gap-y-12 py-24 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div v-reveal class="mb-3 font-mono text-xs uppercase tracking-wider text-fg-3">
            [[ {{ $t('about.connectLabel') }} ]]
          </div>
          <h2
            v-reveal="1"
            class="font-display mb-6 max-w-[24ch] text-[1.7rem] leading-[1.15] text-fg-0 sm:text-[2.1rem]"
          >
            {{ $t('about.connectTitle') }}
          </h2>
          <p v-reveal="2" class="max-w-[38rem] leading-relaxed text-fg-2">
            {{ $t('about.connectBody') }}
          </p>
          <p v-reveal="2" class="mt-4 max-w-[38rem] leading-relaxed text-fg-2">
            {{ $t('about.connectApps') }}
          </p>
          <a
            v-reveal="3"
            :href="CONNECT_STORE_URL"
            target="_blank"
            rel="noopener"
            class="mt-5 inline-flex items-center gap-1.5 text-[0.95rem] text-accent hover:underline"
          >
            <span class="codicon codicon-sm codicon-extensions" />{{ $t('about.connectLink') }}
          </a>
        </div>

        <div v-reveal="2" class="w-[460px] max-w-full justify-self-center" aria-hidden="true">
          <ConnectFlow />
        </div>
      </div>
    </section>

    <!-- ── 7 · Why I built this ────────────────────────────────────────
         Set narrow and plain on purpose: this section earns its place by
         being someone's account, and any styling that makes it look
         art-directed makes it look written by a committee instead. The
         kicker is pulled out because it is the load-bearing sentence. Two
         paragraphs carry a link and are written on one line each so the
         template's whitespace handling cannot eat the space around it. -->
    <section class="border-t border-border">
      <div class="landing-wrap py-24">
        <div v-reveal class="mb-3 font-mono text-xs uppercase tracking-wider text-fg-3">
          [[ {{ $t('about.whyLabel') }} ]]
        </div>
        <h2
          v-reveal="1"
          class="font-display mb-8 max-w-[26ch] text-[1.7rem] leading-[1.15] text-fg-0 sm:text-[2.1rem]"
        >
          {{ $t('about.whyTitle') }}
        </h2>
        <div class="max-w-[42rem] space-y-5 leading-relaxed text-fg-2">
          <p v-reveal="2">{{ whyPlain.one }}</p>
          <p v-reveal="2">{{ $t('about.why2a') }}<a :href="LLM_WIKI_URL" target="_blank" rel="noopener" class="text-accent hover:underline">{{ $t('about.why2Link') }}</a>{{ $t('about.why2b') }}</p>
          <p v-reveal="2">{{ whyPlain.three }}</p>
          <p v-reveal="2">{{ $t('about.why4a') }}<a :href="CONNECT_STORE_URL" target="_blank" rel="noopener" class="text-accent hover:underline">{{ $t('about.why4Link') }}</a>{{ $t('about.why4b') }}</p>
        </div>
        <p
          v-reveal="3"
          class="mt-9 max-w-[42rem] border-l-2 border-accent/60 pl-5 leading-relaxed text-fg-1"
        >
          {{ $t('about.whyKicker') }}
        </p>
      </div>
    </section>

    <!-- ── 8 · Free and open ───────────────────────────────────────────
         Both repositories are linked here and nowhere else on the page: the
         extension is the half that can drive a signed-in browser, so it is
         the half most worth being able to read, and a page that vouched for
         only the app would be vouching for the wrong one. -->
    <section class="landing-grain relative border-t border-border bg-bg-1">
      <div class="landing-wrap py-24">
        <div v-reveal class="mb-3 font-mono text-xs uppercase tracking-wider text-fg-3">
          [[ {{ $t('about.freeLabel') }} ]]
        </div>
        <h2
          v-reveal="1"
          class="font-display mb-6 max-w-[24ch] text-[1.7rem] leading-[1.15] text-fg-0 sm:text-[2.1rem]"
        >
          {{ $t('about.freeTitle') }}
        </h2>
        <div class="max-w-[42rem] space-y-5 leading-relaxed text-fg-2">
          <p v-reveal="2">{{ $t('about.free1') }}</p>
          <p v-reveal="2">{{ $t('about.free2') }}</p>
        </div>
        <div v-reveal="3" class="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          <a
            :href="SOURCE_URL"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-1.5 text-[0.95rem] text-accent hover:underline"
          >
            <span class="codicon codicon-sm codicon-github" />{{ $t('about.sourceLink') }}
          </a>
          <a
            :href="CONNECT_SOURCE_URL"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-1.5 text-[0.95rem] text-accent hover:underline"
          >
            <span class="codicon codicon-sm codicon-github" />{{ $t('about.connectSource') }}
          </a>
        </div>
      </div>
    </section>

    <!-- ── 9 · Phones ──────────────────────────────────────────────────
         The only forward-looking claim on the page, so it is given the
         quietest treatment on the page: no illustration, no button, and
         nothing to sign up for. -->
    <section class="border-t border-border">
      <div class="landing-wrap py-24">
        <div v-reveal class="mb-3 font-mono text-xs uppercase tracking-wider text-fg-3">
          [[ {{ $t('about.mobileLabel') }} ]]
        </div>
        <h2
          v-reveal="1"
          class="font-display mb-6 max-w-[24ch] text-[1.7rem] leading-[1.15] text-fg-0 sm:text-[2.1rem]"
        >
          {{ $t('about.mobileTitle') }}
        </h2>
        <p v-reveal="2" class="max-w-[42rem] leading-relaxed text-fg-2">
          {{ $t('about.mobileBody') }}
        </p>
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
