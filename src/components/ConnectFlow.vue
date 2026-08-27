<script setup lang="ts">
/**
 * The Connect section's diagram: three logged-in tabs stream, in the same
 * green "addition" language as WikiGrowth, into a note inside your folder.
 * Only the streams move; the chips hold still.
 * Schematic chips, not imitated browser chrome. Decorative — the body text
 * says it in words; the parent hides it from assistive tech.
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
  w: Math.round(label.length * 7.2) + 40,
})

/** The tabs — sites from the ready-made-actions set. `brand` picks the tiny
 *  hand-drawn mark; brand colors are literal facts, not theme tokens. */
const tabs = [
  { ...chip(10, 24, 'arxiv.org'), brand: 'arxiv' },
  { ...chip(10, 113, 'news.ycombinator.com'), brand: 'hn' },
  { ...chip(10, 202, 'youtube.com'), brand: 'yt' },
]

/** Where what they yield lands. */
const folder = { x: 292, y: 78, w: 182, h: 104 }
const file = chip(folder.x + 10, folder.y + 46, 'wiki/scaling-debate.md')
file.w = folder.w - 20

const flows = tabs.map((t) => ({
  a: [t.x + t.w + 6, t.y + H / 2] as const,
  b: [folder.x - 6, folder.y + folder.h / 2] as const,
}))
</script>

<template>
  <svg viewBox="0 0 484 260" fill="none" class="h-auto w-full max-w-[484px]">
    <line
      v-for="(f, i) in flows"
      :key="i"
      class="cf-flow"
      :x1="f.a[0]"
      :y1="f.a[1]"
      :x2="f.b[0]"
      :y2="f.b[1]"
      stroke="rgb(var(--c-added) / 0.6)"
      stroke-width="1.5"
      stroke-dasharray="5 9"
    />

    <g v-for="t in tabs" :key="t.label">
      <rect :x="t.x" :y="t.y" :width="t.w" :height="H" rx="8" fill="rgb(var(--c-bg-2))" stroke="rgb(var(--c-border))" />
      <!-- tiny hand-drawn site marks; 14px is enough to recognise them -->
      <g v-if="t.brand === 'arxiv'">
        <rect :x="t.x + 10" :y="t.y + 10" width="14" height="14" rx="3" fill="#b31b1b" />
        <text :x="t.x + 17" :y="t.y + 21" text-anchor="middle" fill="#fff" font-size="10" font-weight="700">X</text>
      </g>
      <g v-else-if="t.brand === 'hn'">
        <rect :x="t.x + 10" :y="t.y + 10" width="14" height="14" rx="3" fill="#ff6600" />
        <text :x="t.x + 17" :y="t.y + 21" text-anchor="middle" fill="#fff" font-size="10" font-weight="700">Y</text>
      </g>
      <g v-else-if="t.brand === 'yt'">
        <rect :x="t.x + 10" :y="t.y + 9" width="15" height="15" rx="4.5" fill="#ff0000" />
        <path :d="`M ${t.x + 15} ${t.y + 13} l 6 3.5 l -6 3.5 z`" fill="#fff" />
      </g>
      <text :x="t.x + 31" :y="t.y + 22" fill="rgb(var(--c-fg-2))" font-size="11.5" class="font-mono">
        {{ t.label }}
      </text>
    </g>

    <!-- the folder -->
    <rect :x="folder.x" :y="folder.y" :width="folder.w" :height="folder.h" rx="10" fill="rgb(var(--c-bg-1))" stroke="rgb(var(--c-border))" />
    <text :x="folder.x + 14" :y="folder.y + 26" fill="rgb(var(--c-fg-3))" font-size="11.5" class="font-mono">
      ~/your-folder
    </text>
    <g>
      <rect :x="file.x" :y="file.y" :width="file.w" :height="H" rx="8" fill="rgb(var(--c-added) / 0.12)" stroke="rgb(var(--c-added) / 0.6)" />
      <text :x="file.x + file.w / 2" :y="file.y + 22" text-anchor="middle" fill="rgb(var(--c-added))" font-size="11.5" class="font-mono">
        {{ file.label }}
      </text>
    </g>
  </svg>
</template>
