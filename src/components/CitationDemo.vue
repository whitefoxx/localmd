<script setup lang="ts">
/**
 * The citation round trip, drawn rather than screenshotted: a note with two
 * citations, and the source page beside it holding the passage each one
 * points to. Clicking a citation moves the highlight.
 *
 * Drawn, so it follows the reader's theme instead of shipping a light and a
 * dark screenshot that have to be reshot whenever the interface moves.
 * Nothing ever appears or disappears — both panes stay whole and only the lit
 * passage changes — so the picture can never be mistaken for a pane loading.
 *
 * It demonstrates itself: a cursor walks to a citation and clicks it on a
 * loop, which is what the animated screenshots used to do. The first real
 * click stops that for good. A demo still performing while someone is trying
 * it is a demo fighting them.
 *
 * The text is illustrative, written for this drawing rather than quoted.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

/** The note, as the agent writes one: a claim, then the citation behind it. */
const note = [
  { n: 1, text: 'Loss falls as a power law in compute' },
  { n: 2, text: 'Data, not parameters, was the binding constraint' },
]

/** The source page. `cite` is the citation that lands here, 0 for none — a
 *  passage nobody cited is what makes the highlight mean something. */
const blocks = [
  {
    cite: 0,
    text: 'We study how language model performance scales with model size, dataset size and the compute used in training.',
  },
  {
    cite: 1,
    text: 'Test loss follows a power law in compute across more than six orders of magnitude, with no sign of saturation at the scales we examine.',
  },
  {
    cite: 2,
    text: 'For a fixed compute budget the optimal model is smaller than previously assumed: training tokens should grow at the same rate as parameters.',
  },
]

/** Which citation is lit. */
const active = ref(1)
/** Where the demo cursor is standing, or null once a real click took over. */
const pointer = ref<number | null>(1)
/** Which citation is rippling, and a counter that restarts its animation. */
const flash = ref(0)
const beat = ref(0)

/** The cursor arrives, then presses. `CLICK_MS` is where the press keyframe
 *  falls inside `STEP_MS`, so the highlight moves as the cursor dips rather
 *  than before it. Two numbers, one timing — keep them in step. */
const STEP_MS = 3400
const CLICK_MS = 900
let step: number | undefined
let land: number | undefined

function stop(): void {
  if (step) clearInterval(step)
  if (land) clearTimeout(land)
  step = land = undefined
  pointer.value = null
}

/** A real click ends the performance, permanently. */
function pick(n: number): void {
  stop()
  flash.value = 0
  active.value = n
}

onMounted(() => {
  // Reduced motion gets the still picture. The demo is decoration; the panes
  // it decorates are fully readable and fully clickable without it.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    pointer.value = null
    return
  }
  step = window.setInterval(() => {
    const next = active.value === 1 ? 2 : 1
    pointer.value = next
    land = window.setTimeout(() => {
      active.value = next
      flash.value = next
      beat.value += 1
    }, CLICK_MS)
  }, STEP_MS)
})
onBeforeUnmount(stop)
</script>

<template>
  <div class="grid items-stretch gap-6 lg:grid-cols-[1fr_auto_1fr]">
    <figure class="flex flex-col">
      <div class="app-frame flex h-full flex-col text-[13px] leading-relaxed">
        <div
          class="flex items-center justify-between border-b border-border px-4 py-2 font-mono text-[11px] text-fg-3"
        >
          <span>wiki/scaling-laws.md</span>
          <span>preview</span>
        </div>
        <div class="px-5 py-4 text-fg-1">
          <div class="mb-2 font-semibold text-fg-0">Scaling laws, in short</div>
          <p v-for="line in note" :key="line.n" class="mb-2">
            {{ line.text }}
            <!-- The wrapper is what the cursor and the ripple are positioned
                 against, so it has to hug the marker exactly. -->
            <span class="cite-slot"
              ><button
                type="button"
                class="cite-mark"
                :class="{ 'is-active': active === line.n }"
                :aria-pressed="active === line.n"
                @click="pick(line.n)"
              >
                [{{ line.n }}]</button
              ><svg
                v-if="pointer === line.n"
                class="cite-cursor"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path
                  d="M3 1l13 8.5-5.6 1 3.2 6-2.6 1.2-3.1-6L3 15z"
                  fill="rgb(var(--c-accent))"
                  stroke="rgb(var(--c-bg-1))"
                  stroke-width="1"
                /></svg
              ><span
                v-if="flash === line.n"
                :key="beat"
                class="cite-ripple"
                aria-hidden="true" /></span
            >.
          </p>
          <p class="mt-3 font-mono text-[11px] text-fg-3">Sources: raw/papers/scaling.pdf</p>
        </div>
      </div>
      <figcaption class="mt-3 font-mono text-xs leading-relaxed text-fg-3">
        {{ $t('about.showCapNote') }}
      </figcaption>
    </figure>

    <!-- The arrow belongs to the two frames, not to the column: centring it
         on the whole grid row would drop it by half a caption. `mb-9` is that
         caption plus its gap, taken back. -->
    <div class="flex items-center justify-center text-added lg:mb-9" aria-hidden="true">
      <span class="codicon codicon-arrow-right rotate-90 text-2xl lg:rotate-0" />
    </div>

    <figure class="flex flex-col">
      <div class="app-frame flex h-full flex-col text-[13px] leading-relaxed">
        <div
          class="flex items-center justify-between border-b border-border px-4 py-2 font-mono text-[11px] text-fg-3"
        >
          <span>raw/papers/scaling.pdf</span>
          <span>p. 4</span>
        </div>
        <div class="px-5 py-4 text-fg-2">
          <p
            v-for="b in blocks"
            :key="b.text"
            class="cite-block"
            :class="{ 'is-active': b.cite !== 0 && b.cite === active }"
          >
            {{ b.text }}
          </p>
        </div>
      </div>
      <figcaption class="mt-3 font-mono text-xs leading-relaxed text-fg-3">
        {{ $t('about.showCapPdf') }}
      </figcaption>
    </figure>
  </div>
</template>
