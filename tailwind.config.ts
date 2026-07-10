import type { Config } from 'tailwindcss'

/** All colors resolve through CSS variables (RGB triplets set per-theme in
 *  main.css) so light/dark theming swaps palettes without touching classes.
 *  `<alpha-value>` keeps Tailwind opacity modifiers like `bg-accent/15` working. */
const v = (name: string): string => `rgb(var(${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['Menlo', 'Monaco', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg: {
          0: v('--c-bg-0'),
          1: v('--c-bg-1'),
          2: v('--c-bg-2'),
          3: v('--c-bg-3'),
        },
        fg: {
          0: v('--c-fg-0'),
          1: v('--c-fg-1'),
          2: v('--c-fg-2'),
          3: v('--c-fg-3'),
        },
        accent: v('--c-accent'),
        border: v('--c-border'),
        added: v('--c-added'),
        removed: v('--c-removed'),
      },
    },
  },
  plugins: [],
} satisfies Config
