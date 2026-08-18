<script setup lang="ts">
import { computed, ref } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { isSupported } from '@/lib/fs'
import { t } from '@/i18n'
import { useThemeStore } from '@/stores/theme'
import LandingAbout from '@/components/LandingAbout.vue'
import noteLight from '@/assets/landing-note.jpg'
import noteDark from '@/assets/landing-note-dark.jpg'
import type { RecentKb } from '@/lib/idb'

const kb = useKbStore()
const files = useFilesStore()
const theme = useThemeStore()
const supported = computed(() => isSupported())

/** The product shot follows the theme. A screenshot of a light interface on a
 *  dark page reads as a picture of a different app — the one thing a hero shot
 *  may not do is make someone wonder whether it is really this one.
 *  `scripts/shoot-landing.mjs` regenerates both. */
const noteShot = computed(() => (theme.isDark ? noteDark : noteLight))

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
      class="landing-grid relative flex min-h-full items-center overflow-hidden py-12"
    >
      <div
        class="landing-wrap grid items-center gap-x-14 gap-y-14 lg:grid-cols-[minmax(0,30rem)_1fr]"
      >
        <!-- ── The column that asks for the click ─────────────────────── -->
        <!-- Left-aligned at every width, not centred below lg: the product
             shot underneath runs from the same gutter, and a centred column
             above a left-aligned frame reads as two different pages. -->
        <div class="relative z-10 w-full max-w-[30rem]">
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
          </div>

          <h1
            class="font-display rise mb-4 text-[1.9rem] leading-[1.15] text-fg-0 sm:text-[2.15rem]"
            style="animation-delay: 70ms"
          >
            {{ $t('openKb.headline') }}
          </h1>
          <p class="rise mb-7 text-[1.05rem] leading-relaxed text-fg-2" style="animation-delay: 140ms">
            {{ $t('openKb.subline') }}
          </p>

          <template v-if="supported">
            <div class="rise flex flex-wrap gap-3" style="animation-delay: 210ms">
              <button class="btn-cta" @click="open">
                <span class="codicon codicon-folder-opened" />{{ $t('openKb.openFolder') }}
              </button>
              <!-- The lowest-commitment door: no folder, no key, nothing kept.
                   It sits beside the primary button rather than below the fold
                   because most first visits are browsing, not moving in. -->
              <button class="btn-ghost" @click="openDemo">
                <span class="codicon codicon-beaker" />{{ $t('openKb.demo') }}
              </button>
            </div>

            <!-- Starting fresh is the same action — pick a folder. Opening one
                 never writes to it; if it turns out to be empty, the app offers
                 the starter layout inside, and only then on the user's word.
                 The rule is on the label alone — spanning the icon and the gap
                 too would draw it as two disconnected dashes. -->
            <button
              class="rise mt-5 inline-flex items-center gap-1.5 text-sm text-fg-2 transition-colors hover:text-fg-0"
              style="animation-delay: 210ms"
              @click="open"
            >
              <span class="codicon codicon-sm codicon-add" />
              <span class="underline decoration-fg-3/40 underline-offset-4">
                {{ $t('openKb.newKb') }}
              </span>
            </button>

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

            <div class="mt-8 flex items-center gap-2 border-t border-border pt-5 text-xs text-fg-3">
              <span class="codicon codicon-sm codicon-lock" />
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

        <!-- Below lg there is no room beside the text, but there is still a
             reason to show the thing: someone on a small screen may not be
             able to open a folder here at all, and what they take away is
             whether it is worth coming back on a desktop. Same frame, no
             bleed — it just runs to the edge of the column. -->
        <div class="relative -mx-6 overflow-hidden sm:-mx-10 lg:hidden" aria-hidden="true">
          <div class="app-frame shot-fade-r ml-6 rounded-r-none border-r-0 sm:ml-10">
            <div class="flex h-9 items-center gap-1.5 border-b border-border bg-bg-2 px-3.5">
              <span class="h-2.5 w-2.5 rounded-full bg-fg-3/35" />
              <span class="h-2.5 w-2.5 rounded-full bg-fg-3/35" />
              <span class="h-2.5 w-2.5 rounded-full bg-fg-3/35" />
              <div
                class="ml-3 flex h-5 w-[200px] items-center rounded border border-border bg-bg-0 px-2 font-mono text-[11px] text-fg-2"
              >
                localmd.app
              </div>
            </div>
            <div class="h-[320px] overflow-hidden bg-bg-0">
              <img :src="noteShot" alt="" class="block w-[1484px] max-w-none" />
            </div>
          </div>
        </div>

        <!-- ── The product, at the size it really is ──────────────────────
             Shown at its own scale and clipped by the viewport rather than
             scaled to fit: a legible corner of the real interface says more
             than an unreadable picture of all of it. Decorative, so it is
             hidden from assistive tech and dropped below lg where there is no
             room for it to say anything. -->
        <div class="relative hidden h-[540px] lg:block" aria-hidden="true">
          <!-- The centering transform and the entrance animation live on
               separate elements on purpose: `rise` ends on `transform: none`,
               which would otherwise cancel the -translate-y-1/2 the moment the
               animation finished and drop the frame half a frame down the page. -->
          <div class="absolute left-0 top-1/2 w-[1180px] -translate-y-1/2">
            <div class="rise" style="animation-delay: 300ms">
              <div class="app-frame">
                <div class="flex h-9 items-center gap-1.5 border-b border-border bg-bg-2 px-3.5">
                  <span class="h-2.5 w-2.5 rounded-full bg-fg-3/35" />
                  <span class="h-2.5 w-2.5 rounded-full bg-fg-3/35" />
                  <span class="h-2.5 w-2.5 rounded-full bg-fg-3/35" />
                  <div
                    class="ml-3 flex h-5 w-[240px] items-center rounded border border-border bg-bg-0 px-2 font-mono text-[11px] text-fg-2"
                  >
                    localmd.app
                  </div>
                </div>
                <!-- Tall enough to clear the first citation chips in the note:
                     they are the thing this picture is here to show. -->
                <div class="h-[470px] overflow-hidden bg-bg-0">
                  <img
                    :src="noteShot"
                    alt=""
                    width="1484"
                    height="812"
                    class="block w-[1484px] max-w-none"
                  />
                </div>
              </div>
              <div class="mt-3.5 pl-1 font-mono text-xs text-fg-3">
                {{ $t('openKb.frameCaption') }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Scroll affordance to the about sections. -->
      <span
        class="codicon codicon-chevron-down absolute bottom-5 left-1/2 -translate-x-1/2 animate-bounce text-fg-3"
      />
    </section>

    <!-- Below the fold: what localmd is, why it exists, what it does. -->
    <LandingAbout @open="open" />
  </div>
</template>
