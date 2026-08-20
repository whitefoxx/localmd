# PDFs are slow on localmd.app but not in dev (fixed)

> 2026-08-20. Reported as "线上 PDF 半天加载不出来" with a console warning
> about `unload` — which was a red herring. The fix is confirmed on the
> deployed site; what remains unverified is named at the end.

## Symptom

On https://localmd.app a PDF opens to a blank viewport with the toolbar already
rendered, for a long time, and eventually paints. The rest of the app is
instant. In dev, and on the same machine with a proxy switched on, it is fine.
`docs/pdf-slow-first-open.md` had declared PDF slowness fixed three commits
earlier — and it was, for what it measured.

## What it was not

- **The `unload` Permissions-policy violation** in the console. That is epub.js
  registering a deprecated listener; the listener is ignored and nothing else
  happens. It is not on the PDF path at all.
- **A jsDelivr CDN fallback.** The bundle does contain
  `cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.14.4/dist/pdfium.wasm`, which would
  be a bad dependency from mainland China — but it is embedpdf's own default
  constant and dead on our path: `PdfDocument.vue` imports
  `@embedpdf/pdfium/pdfium.wasm?url` and passes it as `wasmUrl`.
- **A stale service worker.** `registerType: 'prompt'` does hold a new build in
  `waiting`, so it was worth ruling out; `getRegistrations()` showed no waiting
  or installing worker, and `curl` outside the browser returned the same build
  the page had. The deployment really was old — a separate problem.
- **The download being slow.** Timed from the page: 4.6MB in 1.5s from the
  origin. That measurement was taken with the reporter's proxy already on, so
  it says nothing about the failing condition — see Lessons.

## What it was

The service worker precached 201 files and left out exactly two:

| asset | size | in precache |
|---|---|---|
| `assets/pdfium-*.wasm` | 4.42 MiB | **no** |
| `assets/pdf.worker.min-*.mjs` | 1.20 MiB | **no** |

They are the two largest assets in the app and the only ones a PDF needs, so
every visit re-fetched 5.6MB over the network before a page could render while
the other ~200 files came off disk. That is the whole asymmetry: an app that
feels local and a reader that does not.

The cause is a glob. `globPatterns: ['**/*.{js,css,html,svg,jpg,woff,woff2,ttf}']`
covers neither extension — `*.js` does not match `.mjs`, and `wasm` was never
listed. The config's own comment said the opposite ("pdf.js worker and
CodeMirror language chunks are large but should still be precached"), and
`maximumFileSizeToCacheInBytes` had been raised to 6MB *for* those files. The
limit was doing its job on a pattern that never matched them.

Proof, from the live site rather than from reading the config:

```js
const c = await caches.open((await caches.keys())[0])
;(await c.keys()).map(r => r.url).filter(u => /wasm|\.mjs/.test(u))   // → []
```

## Fix

- `mjs` and `wasm` added to `globPatterns`; the size limit raised to 8MB so the
  wasm has room to grow.
- `assertEnginePrecached()` — a build plugin that reads the generated `sw.js`
  and fails the build if any emitted `.wasm`/`.mjs` is missing from the
  precache manifest. The defect only exists in the built artifact, so a unit
  test has no seam on it; and the next version of this mistake (a newer engine
  outgrowing the size limit) would be just as silent.

Precache goes from ~9.1MB to ~14.7MB. That cost is paid once, in the
background, instead of 5.6MB before every PDF.

## Confirmed live

After the deploy, on localmd.app, with the new service worker activated:

```js
const c = await caches.open((await caches.keys())[0])
;(await c.keys()).map(r => r.url).filter(u => /wasm|\.mjs/.test(u))
// → ['…/assets/pdfium-RAgkpwfK.wasm', '…/assets/pdf.worker.min-DEtVeC4l.mjs']
```

`registration.active.state === 'activated'`, nothing left `waiting`, and
`caches.match()` hits the wasm — so the precache route serves both off disk.

Getting there produced one more trap worth writing down. Immediately after the
deploy the snippet still returned `[]`, which looked like the fix had failed. It
had not: **a hard reload bypasses the service worker for the page's own requests
but does not update the registration.** The browser had fetched the new bundle
straight from the network while the old worker — and its old precache — stayed
exactly as they were, and no update check had run because the tab never
navigated normally. `await registration.update()` installed the new worker, the
cache went 201 → 234 entries mid-install, and the app's own update prompt
appeared. Accepting it activated the new worker and settled at 203.

Still unverified, and only the reporter can do it: opening a PDF with the proxy
off — the condition that produced the original report — and opening one offline.

Note what this does not fix either way: the *first ever* visit still has to
fetch the engine once. It removes the repeat cost and makes the reader work
offline.

## Lessons

- **A measurement taken under different network conditions than the report is
  not evidence about the report.** The 1.5s wasm timing looked like it refuted
  the whole hypothesis; it had been taken after the reporter enabled a proxy.
  Ask what changed between the report and the measurement.
- **Worker-initiated fetches are invisible to main-thread resource timing.**
  `performance.getEntriesByType('resource')` showed no wasm even while the
  engine was loading one. Cache Storage was the observable that settled it —
  when timing is hard to see, ask a question about *state* instead.
- **"Fixed" in a doc means fixed for what was measured.** The earlier
  investigation ran entirely against the dev server, where every asset is a
  localhost round trip, so an asset-delivery bug could not appear in it. A
  performance finding should record the environment it was measured in.
- A config comment describing intent is not evidence the intent is met. This
  one was wrong for months and read as reassuring.
- **A hard reload is not a service-worker update.** It bypasses the worker for
  the page's requests, so the new bundle arrives while the old worker and its
  old cache stay put — which reads exactly like "the fix did not ship". Check
  `getRegistrations()` before believing a cache is stale.
