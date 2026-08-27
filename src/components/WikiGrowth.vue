<script setup lang="ts">
/**
 * The one-liner, performed as a 12-second loop around an index-centred hub.
 * Act one (once, on entry): the folder's files fade in; two wiki pages exist
 * and both link into [[wiki/index]]. Act two (looping): a request is typed,
 * the send button is clicked and turns into a spinner — a new page appears
 * as a marching dashed outline while FOUR sources stream into it (three
 * files and an existing wiki page: old knowledge feeds new). On completion
 * the outline solidifies, a check pops, the streams harden into permanent
 * links, and the index reaches out to the new page. Reset, repeat.
 *
 * Decorative; the parent hides it from assistive tech. Chip widths derive
 * from the label (12.5px mono ≈ 7.6px/char); links clip at chip borders.
 * Timing lives in main.css (`wg-*` entrance, `wgd-*` loop); reduced motion
 * shows the completed scene.
 */
interface Chip {
  x: number
  y: number
  w: number
  label: string
}

const H = 34
const chip = (x: number, y: number, label: string): Chip => ({
  x,
  y,
  label,
  w: Math.round(label.length * 7.6) + 30,
})

/** Already there — the user's own files, untouched grey. */
const files: Chip[] = [
  chip(24, 40, 'raw/papers/attention.pdf'),
  chip(12, 330, 'raw/papers/scaling.pdf'),
  chip(320, 356, 'raw/papers/chinchilla.pdf'),
  chip(36, 476, 'notes/reading-log.md'),
  chip(324, 30, 'raw/books/three-body.epub'),
]

/** Already grown — each page links its source, and every page links the index. */
const wikis: Chip[] = [
  chip(46, 158, '[[wiki/attention]]'),
  chip(350, 148, '[[wiki/three-body]]'),
  chip(216, 250, '[[wiki/index]]'),
]

/** The page the loop distills out of the scaling papers. */
const draft = chip(230, 430, '[[wiki/scaling-laws]]')

const center = (c: Chip): [number, number] => [c.x + c.w / 2, c.y + H / 2]

/** Point on `c`'s border along the ray toward `to`, pushed out by `gap`. */
function edge(c: Chip, to: Chip, gap = 5): [number, number] {
  const [cx, cy] = center(c)
  const [tx, ty] = center(to)
  const dx = tx - cx
  const dy = ty - cy
  const t = Math.min(
    dx !== 0 ? c.w / 2 / Math.abs(dx) : Infinity,
    dy !== 0 ? H / 2 / Math.abs(dy) : Infinity,
  )
  const len = Math.hypot(dx, dy) || 1
  const push = t + gap / len
  return [cx + dx * push, cy + dy * push]
}

const seg = (a: Chip, b: Chip) => ({ a: edge(a, b), b: edge(b, a) })

/** Standing links, drawn once on entry: page → its source, page → index. */
const links = [
  seg(wikis[0], files[0]),
  seg(wikis[1], files[4]),
  seg(wikis[0], wikis[2]),
  seg(wikis[1], wikis[2]),
  // The index also keeps the reading log at hand — so the only chips with no
  // link at rest are the two papers the typed request names. Linking them IS
  // the loop's story.
  seg(wikis[2], files[3]),
]

/** What streams into the draft: three files and one existing wiki page. */
const flows = [seg(files[1], draft), seg(files[2], draft), seg(files[3], draft), seg(wikis[0], draft)]

/** What remains once it is done: the streams, hardened, plus the index. */
const newLinks = [...flows, seg(wikis[2], draft)]
</script>

<template>
  <div class="w-full max-w-[560px]">
    <svg viewBox="0 0 560 540" fill="none" class="h-auto w-full">
      <line
        v-for="(l, i) in links"
        :key="'l' + i"
        class="wg-link"
        :style="{ '--wg': i }"
        :x1="l.a[0]"
        :y1="l.a[1]"
        :x2="l.b[0]"
        :y2="l.b[1]"
        pathLength="1"
        stroke="rgb(var(--c-added) / 0.4)"
        stroke-width="1.5"
      />

      <!-- information streaming into the draft, then its permanent links -->
      <line
        v-for="(f, i) in flows"
        :key="'f' + i"
        class="wgd-flow"
        :x1="f.a[0]"
        :y1="f.a[1]"
        :x2="f.b[0]"
        :y2="f.b[1]"
        stroke="rgb(var(--c-added) / 0.75)"
        stroke-width="1.5"
        stroke-dasharray="5 9"
      />
      <line
        v-for="(n, i) in newLinks"
        :key="'n' + i"
        class="wgd-newlink"
        :x1="n.a[0]"
        :y1="n.a[1]"
        :x2="n.b[0]"
        :y2="n.b[1]"
        pathLength="1"
        stroke="rgb(var(--c-added) / 0.4)"
        stroke-width="1.5"
      />

      <g v-for="(f, i) in files" :key="f.label" class="wg-file" :style="{ '--wg': i }">
        <rect :x="f.x" :y="f.y" :width="f.w" :height="H" rx="8" fill="rgb(var(--c-bg-2))" stroke="rgb(var(--c-border))" />
        <text :x="f.x + f.w / 2" :y="f.y + 22" text-anchor="middle" fill="rgb(var(--c-fg-2))" font-size="12.5" class="font-mono">
          {{ f.label }}
        </text>
      </g>

      <g v-for="(w, i) in wikis" :key="w.label" class="wg-wiki" :style="{ '--wg': i }">
        <rect :x="w.x" :y="w.y" :width="w.w" :height="H" rx="8" fill="rgb(var(--c-added) / 0.12)" stroke="rgb(var(--c-added) / 0.6)" />
        <text :x="w.x + w.w / 2" :y="w.y + 22" text-anchor="middle" fill="rgb(var(--c-added))" font-size="12.5" class="font-mono">
          {{ w.label }}
        </text>
      </g>

      <!-- the draft: dashed while generating, solid when done -->
      <rect
        class="wgd-dash"
        :x="draft.x"
        :y="draft.y"
        :width="draft.w"
        :height="H"
        rx="8"
        fill="rgb(var(--c-added) / 0.08)"
        stroke="rgb(var(--c-added) / 0.65)"
        stroke-dasharray="7 6"
      />
      <rect
        class="wgd-solid"
        :x="draft.x"
        :y="draft.y"
        :width="draft.w"
        :height="H"
        rx="8"
        fill="rgb(var(--c-added) / 0.12)"
        stroke="rgb(var(--c-added) / 0.6)"
      />
      <text
        class="wgd-label font-mono"
        :x="draft.x + draft.w / 2"
        :y="draft.y + 22"
        text-anchor="middle"
        fill="rgb(var(--c-added))"
        font-size="12.5"
      >
        {{ draft.label }}
      </text>
      <g class="wgd-check">
        <circle :cx="draft.x + draft.w - 1" :cy="draft.y + 1" r="9" fill="rgb(var(--c-bg-0))" stroke="rgb(var(--c-added))" stroke-width="1.5" />
        <path
          :d="`M ${draft.x + draft.w - 5.5} ${draft.y + 1} l 3 3.5 l 5.5 -7`"
          stroke="rgb(var(--c-added))"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </g>
    </svg>

    <!-- The agent's composer: request typed, send clicked, spinner while the
         page generates. The placeholder is the real one — one fact, one
         place. -->
    <div class="wgd-input relative mt-5 flex items-center rounded-lg border border-border bg-bg-1 py-2 pl-4 pr-2 font-mono text-[13px]">
      <span class="wgd-ph absolute left-[27px] right-14 truncate text-fg-3">{{ $t('chat.inputPlaceholder') }}</span>
      <span class="wgd-type overflow-hidden whitespace-nowrap text-fg-1">distill the scaling papers</span>
      <span class="wg-caret ml-0.5 inline-block h-4 w-[7px] shrink-0 bg-accent/80" />
      <span class="wgd-send relative ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md">
        <span class="wgd-send-ring absolute -inset-0.5 rounded-md border-2 border-accent/70" />
        <span class="wgd-send-arrow codicon codicon-arrow-up" />
        <span class="wgd-spin absolute h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent" />
      </span>
    </div>
  </div>
</template>
