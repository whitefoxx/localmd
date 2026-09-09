<script setup lang="ts">
/**
 * The local-first section's diagram: a folder of ordinary files, and beside
 * it the thing there is not: a dashed, grey database with a cross through
 * it. Grey rather than red, and the same weight as the cylinder — this is a
 * fact about what is absent, not a warning about something that went wrong.
 * Decorative — the prose says it in words; the parent hides it from
 * assistive tech.
 */

/** One folder, the way a terminal would list it. Pages the agent wrote are
 *  green, the same "addition" colour WikiGrowth and the diff card use; the
 *  sources and the `.git` directory are just files. */
const tree: { text: string; kind: 'root' | 'page' | 'file' }[] = [
  { text: '~/your-folder', kind: 'root' },
  { text: '├─ wiki/', kind: 'file' },
  { text: '│  ├─ index.md', kind: 'page' },
  { text: '│  └─ scaling-laws.md', kind: 'page' },
  { text: '├─ raw/papers/attention.pdf', kind: 'file' },
  { text: '├─ notes/reading-log.md', kind: 'file' },
  { text: '└─ .git/', kind: 'file' },
]

const fill = (k: (typeof tree)[number]['kind']): string =>
  k === 'root' ? 'rgb(var(--c-fg-3))' : k === 'page' ? 'rgb(var(--c-added))' : 'rgb(var(--c-fg-2))'

/** The database: two ellipses and the wall between them, as one dashed path. */
const cyl = { cx: 392, cy: 96, rx: 40, ry: 11, h: 68 }
const cylPath = [
  `M ${cyl.cx - cyl.rx} ${cyl.cy}`,
  `a ${cyl.rx} ${cyl.ry} 0 0 0 ${cyl.rx * 2} 0`,
  `a ${cyl.rx} ${cyl.ry} 0 0 0 ${-cyl.rx * 2} 0`,
  `v ${cyl.h}`,
  `a ${cyl.rx} ${cyl.ry} 0 0 0 ${cyl.rx * 2} 0`,
  `v ${-cyl.h}`,
].join(' ')
</script>

<template>
  <svg viewBox="0 0 484 260" fill="none" class="h-auto w-full max-w-[484px]">
    <!-- the folder -->
    <rect x="10" y="26" width="290" height="208" rx="10" fill="rgb(var(--c-bg-1))" stroke="rgb(var(--c-border))" />
    <text
      v-for="(line, i) in tree"
      :key="line.text"
      x="30"
      :y="58 + i * 25"
      :fill="fill(line.kind)"
      font-size="12.5"
      class="font-mono"
      xml:space="preserve"
    >{{ line.text }}</text>

    <!-- the database, absent -->
    <path
      :d="cylPath"
      stroke="rgb(var(--c-fg-3) / 0.55)"
      stroke-width="1.5"
      stroke-dasharray="4 6"
      stroke-linecap="round"
    />
    <!-- the cross, sized to the body of the cylinder rather than over it:
         a mark on the thing, not a stamp across the drawing -->
    <g stroke="rgb(var(--c-fg-3) / 0.85)" stroke-width="2" stroke-linecap="round">
      <line :x1="cyl.cx - 18" :y1="cyl.cy + 16" :x2="cyl.cx + 18" :y2="cyl.cy + cyl.h - 16" />
      <line :x1="cyl.cx + 18" :y1="cyl.cy + 16" :x2="cyl.cx - 18" :y2="cyl.cy + cyl.h - 16" />
    </g>
    <text
      :x="cyl.cx"
      :y="cyl.cy + cyl.h + 42"
      text-anchor="middle"
      fill="rgb(var(--c-fg-3) / 0.8)"
      font-size="12.5"
      class="font-mono"
    >
      database
    </text>
  </svg>
</template>
