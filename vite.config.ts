import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'browser-md',
        short_name: 'browser-md',
        description: 'Local-first AI knowledge base — your markdown files, in your browser.',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,ttf}'],
        // pdf.js worker and CodeMirror language chunks are large but should
        // still be precached for offline use.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // MarkdownEditor pulls in @codemirror/language-data, which *dynamically*
    // imports individual @codemirror/lang-* packages the first time a file of
    // that type is opened. In dev, Vite's pre-bundler would optimize that lazy
    // package on its own and give it a second copy of @codemirror/state — then
    // `instanceof` checks fail with "Unrecognized extension value ... multiple
    // instances of @codemirror/state" and the editor's mounted hook throws.
    // Forcing a single instance of state (and view) keeps every extension on the
    // same class. (Prod builds are unaffected — Rollup bundles them together.)
    dedupe: ['@codemirror/state', '@codemirror/view'],
  },
})
