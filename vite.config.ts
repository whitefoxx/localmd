import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

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

/**
 * Ship pdf.js's image-decoder wasm at a stable URL.
 *
 * pdf.js 6 moved JBIG2 and JPEG 2000 decoding into WebAssembly, and looks the
 * modules up by filename under whatever directory `wasmUrl` names. That rules
 * out the `?url` import used for every other asset here: Rollup would hash the
 * very filenames pdf.js is about to concatenate by hand. So these two are
 * copied through verbatim, and the directory is what gets handed to
 * `getDocument`.
 *
 * They are not optional, and their absence is silent. A scanned page is one
 * big JBIG2 image; with no decoder pdf.js paints nothing, resolves the render
 * promise, and merely *warns* — leaving a sheet of blank white paper that OCR
 * reads as an empty page and a human reads as a bad scan.
 *
 * The `*_nowasm_fallback.js` siblings (600KB of the two) are deliberately left
 * behind: they exist for environments without WebAssembly, and this app opens
 * PDFs with a 4.6MB pdfium.wasm. There is no such environment in which the
 * rest of it works.
 *
 * These two are also kept OUT of the precache (see `globIgnores` below) and
 * cached at first use instead. pdf.js asks for them only when it actually
 * meets a JBIG2 or JPEG 2000 image, and most people never open a scan — a
 * first visit should not pay 357KB for a decoder it will never run.
 */
function pdfjsWasmAssets(): Plugin {
  const DIR = 'pdfjs-wasm'
  const FILES = ['jbig2.wasm', 'openjpeg.wasm']
  const source = (f: string) =>
    readFile(fileURLToPath(new URL(`./node_modules/pdfjs-dist/wasm/${f}`, import.meta.url)))
  let serving = false
  return {
    name: 'localmd-pdfjs-wasm',
    configResolved(config) {
      serving = config.command === 'serve'
    },
    configureServer(server) {
      server.middlewares.use(`/${DIR}`, (req, res, next) => {
        const file = (req.url ?? '').replace(/^\//, '').split('?')[0]
        if (!FILES.includes(file)) return next()
        void source(file).then(
          (bytes) => {
            res.setHeader('Content-Type', 'application/wasm')
            res.end(bytes)
          },
          () => next(),
        )
      })
    },
    async buildStart() {
      if (serving) return
      for (const f of FILES) {
        this.emitFile({ type: 'asset', fileName: `${DIR}/${f}`, source: await source(f) })
      }
    },
  }
}

/**
 * Refuse to finish a build whose service worker does not precache the PDF
 * engine.
 *
 * This guards a bug that shipped and stayed invisible for months: the engine's
 * 4.6MB `pdfium.wasm` and 1.25MB `pdf.worker.min.mjs` were the only large
 * assets missing from the precache, because the glob listed `js` and matches
 * neither extension. Nothing threw — a PDF just re-downloaded 5.9MB on every
 * visit while the rest of the app came from disk, so it looked fine on
 * localhost and terrible on a slow link.
 *
 * A check belongs here rather than in a unit test because the defect only
 * exists in the built artifact: the source is identical either way. It also
 * covers the next version of the same mistake — `maximumFileSizeToCacheInBytes`
 * outgrown by a newer engine would drop the wasm again, just as quietly.
 *
 * It reads `assets/` only, and that is the scope: what has to be precached is
 * the engine every PDF needs. An asset emitted elsewhere is one we decided to
 * fetch on demand (`pdfjs-wasm/`), and this must not drag it back in.
 */
function assertEnginePrecached(): Plugin {
  let outDir = ''
  return {
    name: 'localmd-assert-engine-precached',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const dist = outDir
      let sw: string
      try {
        sw = await readFile(resolve(dist, 'sw.js'), 'utf8')
      } catch {
        return // no service worker in this build (e.g. PWA disabled) — nothing to assert
      }
      const assets = await readdir(resolve(dist, 'assets'))
      const engine = assets.filter((f) => f.endsWith('.wasm') || f.endsWith('.mjs'))
      if (!engine.length) {
        throw new Error(
          'assertEnginePrecached: no .wasm/.mjs emitted — the PDF engine did not make it into the build at all.',
        )
      }
      const missing = engine.filter((f) => !sw.includes(f))
      if (missing.length) {
        throw new Error(
          `assertEnginePrecached: ${missing.join(', ')} emitted but absent from the precache manifest. ` +
            'Every visit will re-download them before a PDF can render. Check workbox.globPatterns ' +
            '(does it cover this extension?) and maximumFileSizeToCacheInBytes (has the file outgrown it?).',
        )
      }
    },
  }
}

export default defineConfig({
  plugins: [
    demoIndexWriter(),
    pdfjsWasmAssets(),
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
        //
        // `mjs` and `wasm` are load-bearing, and their absence was a bug that
        // shipped: the PDF engine is a 4.6MB `pdfium.wasm` plus a 1.25MB
        // `pdf.worker.min.mjs`, and `**/*.{js,…}` matches neither extension —
        // `*.js` does not match `.mjs`. They were the only two large assets in
        // the app left out of the precache, so every visit re-fetched 5.9MB
        // before a PDF could render while the other ~200 files came from disk.
        // Nothing errored; it was just slow, and only on a real network, which
        // is why it never appeared in dev. See docs/pdf-blank-on-localmd.md.
        globPatterns: ['**/*.{js,mjs,wasm,css,html,svg,jpg,woff,woff2,ttf}', 'assets/*.png'],
        // …but not every wasm belongs in the precache. `pdfjs-wasm/` is the
        // JBIG2 / JPEG 2000 image decoders: 357KB that only a scanned PDF ever
        // needs, and `**/*.wasm` above would otherwise make every first visit
        // pay for them before the app is usable. pdf.js already fetches them
        // lazily — only when it meets an image in one of those formats — so the
        // only thing making them eager was this glob.
        globIgnores: ['**/pdfjs-wasm/**'],
        // Kept after first use, so a scanned document opened once still opens
        // offline. CacheFirst because the URL is versioned by the build.
        runtimeCaching: [
          {
            urlPattern: /\/pdfjs-wasm\/.*\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pdfjs-image-decoders',
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Sized for the pdfium wasm (4.6MB today) with room to grow, plus the
        // pdf.js worker and the CodeMirror language chunks. Raising this is not
        // the safeguard — assertEnginePrecached() is; a limit outgrown by the
        // next engine release would silently drop the wasm again.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
    // After VitePWA: it writes sw.js in its own closeBundle, and this reads it.
    assertEnginePrecached(),
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
