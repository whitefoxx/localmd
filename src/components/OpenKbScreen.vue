<script setup lang="ts">
import { computed } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useSkillsStore } from '@/stores/skillsStore'
import { isSupported } from '@/lib/fs'
import { scaffoldKb } from '@/lib/scaffold'
import { t } from '@/i18n'
import LandingAbout from '@/components/LandingAbout.vue'
import type { RecentKb } from '@/lib/idb'

const kb = useKbStore()
const files = useFilesStore()
const supported = computed(() => isSupported())

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

/** Pick a folder and lay down the starter KB layout (existing files are kept). */
async function newKb(): Promise<void> {
  if (await kb.pickAndOpen()) {
    await scaffoldKb()
    await files.refreshTree()
    await useSkillsStore().refresh()
    await files.restoreTabs()
    await files.openFile('wiki/index.md')
  }
}

async function openRecent(entry: RecentKb): Promise<void> {
  if (await kb.openRecent(entry)) {
    await files.refreshTree()
    await files.restoreTabs()
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <!-- Hero: fills the first screen -->
    <section class="relative min-h-full flex items-center justify-center px-6 py-16">
      <div class="w-[440px] max-w-full">
        <div class="flex items-center gap-2.5 mb-1">
          <svg
            class="w-8 h-8 text-accent"
            viewBox="0 0 128 128"
            fill="none"
            stroke="currentColor"
            stroke-width="10"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M24 90V40l22 26 22-26v50" />
            <path d="M100 40v46m0 0-14-14m14 14 14-14" />
          </svg>
          <h1 class="text-3xl font-bold text-fg-0">local<span class="text-accent">md</span></h1>
        </div>
        <p class="text-fg-2 mb-6">
          {{ $t('openKb.tagline') }}
        </p>

        <template v-if="supported">
          <button class="btn-primary w-full py-2 text-base" @click="open">
            <span class="codicon codicon-folder-opened mr-2" />{{ $t('openKb.openFolder') }}
          </button>

          <button
            class="mt-2 w-full py-1.5 text-sm text-fg-2 hover:text-fg-0 hover:bg-bg-2 rounded transition-colors flex items-center justify-center gap-1.5"
            @click="newKb"
          >
            <span class="codicon codicon-sm codicon-add" />{{ $t('openKb.newKb') }}
          </button>

          <div v-if="kb.error" class="mt-3 text-sm text-removed">{{ kb.error }}</div>

          <!-- Returning users: jump straight back into a recent folder. -->
          <div v-if="kb.recents.length" class="mt-8">
            <div class="text-xs uppercase tracking-wide text-fg-3 mb-2">{{ $t('openKb.recent') }}</div>
            <button
              v-for="r in kb.recents"
              :key="r.name"
              class="w-full text-left px-3 py-2 rounded hover:bg-bg-2 text-fg-1 flex items-center gap-2"
              @click="openRecent(r)"
            >
              <span class="codicon codicon-folder text-fg-3" />
              <span class="flex-1 truncate">{{ r.name }}</span>
              <span class="text-xs text-fg-3">{{ new Date(r.lastOpened).toLocaleDateString() }}</span>
            </button>
          </div>

          <!-- First-time visitors: what this is and how it works. -->
          <template v-else>
            <div class="mt-9">
              <div class="text-xs uppercase tracking-wide text-fg-3 mb-3">
                {{ $t('openKb.howItWorks') }}
              </div>
              <div class="space-y-3.5">
                <div v-for="(s, i) in steps" :key="i" class="flex gap-3">
                  <div
                    class="shrink-0 w-6 h-6 rounded-full bg-bg-2 text-fg-2 text-xs font-medium flex items-center justify-center"
                  >
                    {{ i + 1 }}
                  </div>
                  <div>
                    <div class="text-sm font-medium text-fg-1">{{ s.title }}</div>
                    <div class="text-sm text-fg-3">{{ s.body }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-8 flex items-center gap-2 text-xs text-fg-3">
              <span class="codicon codicon-sm codicon-lock" />
              {{ $t('openKb.privacy') }}
            </div>
          </template>
        </template>

        <div v-else class="p-4 rounded border border-border bg-bg-1 text-sm text-fg-2">
          {{ $t('openKb.unsupported') }}
        </div>
      </div>

      <!-- Scroll affordance to the about sections. -->
      <span
        class="codicon codicon-chevron-down absolute bottom-5 left-1/2 -translate-x-1/2 text-fg-3 animate-bounce"
      />
    </section>

    <!-- Below the fold: what localmd is, why it exists, what it does. -->
    <LandingAbout @open="open" />
  </div>
</template>
