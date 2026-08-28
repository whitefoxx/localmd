<script setup lang="ts">
import { SOURCE_URL } from '@/lib/links'
import { computed, ref } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { isSupported } from '@/lib/fs'
import { report } from '@/lib/analytics'
import { t } from '@/i18n'
import LandingAbout from '@/components/LandingAbout.vue'
import WikiGrowth from '@/components/WikiGrowth.vue'
import type { RecentKb } from '@/lib/idb'

const kb = useKbStore()
const files = useFilesStore()
const supported = computed(() => isSupported())

/** The product shot follows the theme. A screenshot of a light interface on a
 *  dark page reads as a picture of a different app — the one thing a hero shot
 *  may not do is make someone wonder whether it is really this one.
 *  `scripts/shoot-landing.mjs` regenerates both. */

/** The headline, split at its nbsp so the second phrase owns line two.
 *  The zh headline has no nbsp and renders as one flowing line. */
const h1 = computed(() => {
  const full = t('openKb.headline')
  const i = full.indexOf('\u00A0')
  return i === -1 ? [full] : [full.slice(0, i), full.slice(i + 1)]
})

const steps = computed(() => [
  { title: t('openKb.step1Title'), body: t('openKb.step1Body') },
  { title: t('openKb.step2Title'), body: t('openKb.step2Body') },
  { title: t('openKb.step3Title'), body: t('openKb.step3Body') },
])

async function open(): Promise<void> {
  if (await kb.pickAndOpen()) {
    await files.refreshTree()
    await files.restoreTabs()
  }
}

async function openRecent(entry: RecentKb): Promise<void> {
  if (await kb.openRecent(entry)) {
    await files.refreshTree()
    await files.restoreTabs()
  }
}

const copied = ref(false)

/**
 * Put the app's address on the clipboard, for a visitor who cannot use it on
 * the device they are holding.
 *
 * The obvious alternative — "we'll email you the link" — would be collecting
 * addresses under cover of helping, on the start screen of an app whose first
 * promise is that it has no account. A phone can carry a URL to a desktop by
 * itself.
 */
async function copyAddress(): Promise<void> {
  try {
    await navigator.clipboard.writeText('https://localmd.app')
    copied.value = true
    setTimeout(() => (copied.value = false), 2500)
  } catch {
    // Clipboard denied (insecure context, or a browser that asks). The address
    // is in the URL bar right above; nothing is lost by staying quiet.
  }
}

/** Open the in-memory demo KB — see `enterDemo`, which is the same door the
 *  chat panel offers when no model is configured yet. */
async function openDemo(): Promise<void> {
  report('demo_open')
  const { enterDemo } = await import('@/demo/bootstrap')
  await enterDemo()
}

/** Drop an entry from the recent list — the folder on disk is untouched. */
async function forget(entry: RecentKb): Promise<void> {
  await kb.forgetRecent(entry.name)
}
</script>

<template>
  <div class="landing h-full overflow-y-auto select-text">
    <!-- Hero: fills the first screen. `overflow-hidden` is what lets the
         product shot run off the right edge instead of being shrunk to fit. -->
    <section
      class="landing-grid landing-grain relative flex min-h-full items-center overflow-hidden py-12"
    >
      <div class="landing-aurora inset-0" aria-hidden="true" />
      <div
        class="landing-wrap grid items-center gap-x-14 gap-y-14 lg:grid-cols-[minmax(0,36rem)_1fr]"
      >
        <!-- ── The column that asks for the click ─────────────────────── -->
        <!-- Left-aligned at every width, not centred below lg: the product
             shot underneath runs from the same gutter, and a centred column
             above a left-aligned frame reads as two different pages. -->
        <div class="relative z-10 w-full max-w-[36rem]">
          <div class="rise mb-8 flex items-center gap-3.5">
            <svg
              class="h-12 w-12 shrink-0 text-accent drop-shadow-[0_6px_18px_rgb(var(--c-accent)/0.35)]"
              viewBox="0 0 128 128"
              aria-hidden="true"
            >
              <rect width="128" height="128" rx="28" fill="currentColor" />
              <g fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M50 36H36v56h14" />
                <path d="M78 36h14v56H78" />
              </g>
              <circle cx="64" cy="64" r="6.5" fill="#fff" />
            </svg>
            <span class="font-wordmark text-[2.6rem] font-bold leading-none tracking-tight">
              <span class="text-fg-3/45">[[</span
              ><span class="text-fg-0">local</span><span class="text-accent">md</span
              ><span class="text-fg-3/45">]]</span>
            </span>
            <!-- Quiet, and beside the wordmark rather than among the buttons:
                 it is a fact about what this is, not a third thing to click
                 instead of the two that matter. -->
            <a
              :href="SOURCE_URL"
              target="_blank"
              rel="noopener"
              :title="$t('openKb.sourceTitle')"
              class="ml-auto inline-flex items-center gap-1.5 self-center text-sm text-fg-3 transition-colors hover:text-fg-0"
            >
              <span class="codicon codicon-sm codicon-github" />
              <span class="hidden sm:inline">{{ $t('openKb.source') }}</span>
            </a>
          </div>

          <h1
            class="font-display rise mb-5 text-[1.9rem] leading-[1.14] text-fg-0 sm:text-[2.3rem]"
            style="animation-delay: 70ms"
          >
            {{ h1[0] }}<br v-if="h1[1]" />{{ h1[1] }}
          </h1>
          <p class="rise mb-7 text-[1.05rem] leading-relaxed text-fg-2" style="animation-delay: 140ms">
            {{ $t('openKb.subline') }}
          </p>

          <template v-if="supported">
            <div class="rise flex flex-wrap gap-3" style="animation-delay: 210ms">
              <!-- The lowest-commitment door leads: most first visits are
                   browsing, not moving in, and the demo is the only button a
                   cold visitor can click without deciding anything. Returning
                   users re-enter through the Recent list below, so giving the
                   demo the loud button costs them nothing. -->
              <button class="btn-cta" @click="openDemo">
                <span class="codicon codicon-beaker" />{{ $t('openKb.demo') }}
              </button>
              <button class="btn-ghost" @click="open">
                <span class="codicon codicon-folder-opened" />{{ $t('openKb.openFolder') }}
              </button>
            </div>

            <div v-if="kb.error" class="mt-3 text-sm text-removed">{{ kb.error }}</div>

            <!-- Which of these two belongs here depends on an IndexedDB read.
                 Defaulting to the first-visit copy showed it to returning users
                 for a frame and then swapped it for their folder list; drawing
                 nothing instead only moved the problem, since the block still
                 appeared out of nowhere and shoved the page down. So the space
                 is claimed up front by something the right shape and the wrong
                 detail, and only the detail arrives late. -->
            <!-- Sized and shaped after the two things it stands in for, which
                 happen to come out within a line of each other: a label, then
                 three rows of a marker and a couple of lines. -->
            <div v-if="!kb.recentsKnown" class="mt-12 motion-safe:animate-pulse" aria-hidden="true">
              <div class="mb-4 h-2.5 w-16 rounded bg-fg-3/30" />
              <div class="space-y-7">
                <div
                  v-for="(row, i) in [
                    ['38%', '96%', '64%'],
                    ['32%', '88%', '55%'],
                    ['44%', '92%', '48%'],
                  ]"
                  :key="i"
                  class="flex gap-3.5"
                >
                  <div class="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-fg-3/20" />
                  <div class="flex-1 space-y-3 pt-1">
                    <div class="h-2.5 rounded bg-fg-3/30" :style="{ width: row[0] }" />
                    <div class="h-2.5 rounded bg-fg-3/20" :style="{ width: row[1] }" />
                    <div class="h-2.5 rounded bg-fg-3/20" :style="{ width: row[2] }" />
                  </div>
                </div>
              </div>
            </div>

            <template v-else>
            <!-- Returning users: jump straight back into a recent folder. -->
            <div v-if="kb.recents.length" class="mt-9">
              <div class="mb-2 font-mono text-xs uppercase tracking-wider text-fg-3">
                {{ $t('openKb.recent') }}
              </div>
              <!-- Four rows, then scroll: the list is a doorway for returning
                   users, not an archive, and a long one pushes the privacy
                   line and everything after it off the first screen. -->
              <div class="max-h-[9.75rem] overflow-y-auto overscroll-contain">
              <div v-for="r in kb.recents" :key="r.name" class="group relative rounded hover:bg-bg-2">
                <button
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-1"
                  @click="openRecent(r)"
                >
                  <span class="codicon codicon-folder text-fg-3" />
                  <span class="flex-1 truncate">{{ r.name }}</span>
                  <span class="text-xs text-fg-3 transition-opacity group-hover:opacity-0">
                    {{ new Date(r.lastOpened).toLocaleDateString() }}
                  </span>
                </button>
                <button
                  class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-3 opacity-0 transition hover:bg-bg-3 hover:text-removed group-hover:opacity-100"
                  :title="$t('openKb.forget')"
                  :aria-label="$t('openKb.forget')"
                  @click.stop="forget(r)"
                >
                  <span class="codicon codicon-sm codicon-close" />
                </button>
              </div>
              </div>
            </div>

            <!-- First-time visitors: what this is and how it works. -->
            <template v-else>
              <div class="mt-10">
                <div class="mb-4 font-mono text-xs uppercase tracking-wider text-fg-3">
                  [[ {{ $t('openKb.howItWorks') }} ]]
                </div>
                <div class="space-y-4">
                  <div v-for="(s, i) in steps" :key="i" class="flex gap-3.5">
                    <div
                      class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[11px] text-fg-2"
                    >
                      {{ i + 1 }}
                    </div>
                    <div>
                      <div class="text-sm font-semibold text-fg-1">{{ s.title }}</div>
                      <div class="text-sm leading-relaxed text-fg-3">{{ s.body }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
            </template>

            <div class="mt-8 border-t border-border pt-5 font-mono text-[13px] text-fg-2">
              {{ $t('openKb.privacy') }}
            </div>
          </template>

          <!-- No File System Access here (Firefox, Safari, phones). The demo KB
               lives in memory and needs none of it, so this is a dead end only
               for opening a folder — say so, then offer the door that works. -->
          <div v-else class="rise" style="animation-delay: 210ms">
            <div class="rounded-lg border border-border bg-bg-1 p-4 text-sm leading-relaxed text-fg-2">
              {{ $t('openKb.unsupported') }}
            </div>
            <button class="btn-cta mt-5" @click="openDemo">
              <span class="codicon codicon-beaker" />{{ $t('openKb.demo') }}
            </button>
            <div class="mt-2.5 text-sm text-fg-3">{{ $t('openKb.demoHint') }}</div>

            <!-- Someone here on a phone can see the demo but cannot ever open a
                 folder on this device. Copying the address is the whole of what
                 they need later, and asking for an email to send it would be
                 collecting addresses under cover of helping. -->
            <div class="mt-8 border-t border-border pt-6">
              <div class="mb-2 text-xs text-fg-3">{{ $t('openKb.laterHint') }}</div>
              <button
                class="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
                @click="copyAddress"
              >
                <span class="codicon codicon-sm" :class="copied ? 'codicon-check' : 'codicon-link'" />
                {{ copied ? $t('openKb.copied') : $t('openKb.copyAddress') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Below lg the drawing sits under the text at a smaller size:
             the point survives shrinking in a way a screenshot never did. -->
        <div class="relative lg:hidden" aria-hidden="true">
          <WikiGrowth class="mx-auto" />
        </div>

        <!-- ── The one-liner, performed ───────────────────────────────────
             File chips are already there; wiki chips pop up green; links draw
             themselves. Decorative — the copy on the left says it in words —
             and drawn in SVG, so there is nothing to load and nothing to
             re-shoot when the interface changes. -->
        <div class="relative hidden h-[540px] lg:block" aria-hidden="true">
          <div class="absolute left-0 top-1/2 w-full -translate-y-1/2">
            <div class="rise" style="animation-delay: 300ms">
              <WikiGrowth />
            </div>
          </div>
        </div>
      </div>

    </section>

    <!-- Below the fold: what localmd is, why it exists, what it does. -->
    <LandingAbout @open="open" />
  </div>
</template>
