import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

/**
 * Dev-only sink for the demo KB's document index.
 *
 * `/?demo-build=1` regenerates that index with the real (browser-only) pdf.js
 * extractor and has to get the result onto disk. It used to trigger a download,
 * which Chrome blocks when no click preceded it — and blocks silently, so the
 * rebuild looked like it had worked and had not. The dev server can just write
 * the files, which is fewer steps anyway.
 *
 * `apply: 'serve'` keeps it out of every build; nothing here ships.
 */
function demoIndexWriter(): Plugin {
  return {
    name: 'localmd-demo-index-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__demo-index', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          void (async () => {
            try {
              const { unpackIndex, rebuildManifest } = await import('./scripts/build-demo.mjs')
              const written = unpackIndex(JSON.parse(Buffer.concat(chunks).toString('utf8')))
              const listed = rebuildManifest()
              res.setHeader('Content-Type', 'text/plain')
              res.end(`wrote ${written} index files; manifest lists ${listed}`)
            } catch (err) {
              res.statusCode = 500
              res.end(String(err))
            }
          })()
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [
    demoIndexWriter(),
    vue(),
    VitePWA({
      // 'prompt', not 'autoUpdate'. The registration script the plugin injects
      // for autoUpdate ends in `window.location.reload()` the moment a new
      // service worker activates — mid-session, unannounced, and the page has
      // no say in it. That reload took the open KB with it: the directory
      // handle lives only in memory, so a deploy silently threw the user back
      // to the start screen mid-sentence.
      //
      // Under 'prompt' the new worker stays in `waiting` instead: this page
      // keeps being served by the precache it was loaded against (so its lazy
      // chunks — CodeMirror languages, the PDF and EPUB readers — can't 404
      // out from under it), and stores/update decides when to apply it. That
      // also means the plugin no longer forces `workbox.skipWaiting`.
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'localmd',
        short_name: 'localmd',
        description: 'Local-first AI knowledge base — your markdown files, in your browser.',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // `jpg` is here for the landing screenshots, which are part of the
        // first screen an offline visitor sees, and `assets/*.png` for the
        // landing diagram. Bare `**/*.png` would additionally drag in the
        // 350KB og image, which sits at the root and no visitor ever loads —
        // only crawlers fetch it, and never from the service worker.
        globPatterns: ['**/*.{js,css,html,svg,jpg,woff,woff2,ttf}', 'assets/*.png'],
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
