# Large PDFs are slow on first open (fixed)

> **Scope note, 2026-08-20.** Everything below was measured against the dev
> server, where every asset is a localhost round trip. It is still accurate for
> what it covers — boot contention and deadlines — but it cannot say anything
> about asset delivery, and a *second*, production-only cause of slow PDFs was
> found the same day: the PDF engine was missing from the service-worker
> precache. See `pdf-blank-on-localmd.md`. Do not read "fixed" here as "PDFs
> are fast everywhere".

**Status: fixed** across three commits (2026-08-20): index deferral + an
extraction loop that yields (1a880bb), lazy mounting of background PDF tabs,
and the size-scaled load deadline. What remains is engine-internal: a
1000+-page book still spends a few seconds laying out after 'loaded' before
the first page paints.

## Symptom

A >1000-page PDF took 15s+ on first open, ending on EmbedPDF's own centred
"Loading document…" spinner — the double-loading glitch the opaque mask exists
to prevent. Closing and reopening was fast; a full page reload was fast too.
The obvious explanation — scripts and wasm cached after the first load — was
plausible and wrong.

## What was measured

`[DEBUG-pdfperf]` console timings around the open path (mount, readBinary,
onReady, engine 'loaded', mask lift, index build), plus a Playwright harness
launching a cold Chrome profile against the running dev server. On the
1208-page / 34MB book behind the report:

- Cold browser profile (no HTTP/V8/wasm caches): click → 'loaded' in 1.08s;
  warm profile 1.02s. Cold caches were not the cause.
- `readBinary` was 0.13–0.34s solo for 34–84MB local files — the disk was not
  the cause either — but stretched to 5.4s during app boot.
- Engine 'loaded' was 2.2–2.7s solo, but 5–15.7s while the app booted: every
  open PDF tab used to mount its own engine at boot, and every step is elastic
  under that contention.
- After 'loaded' the viewer needs seconds more before first paint (pages
  measure themselves, the fit-width zoom recalculates — the same late layout
  `scrollToPoint` already works around). With no index on disk, the
  whole-document text extraction used to start at onReady and race that
  layout: the viewport stayed blank for the length of the build (10–20s
  observed).

The reported screenshot reproduced exactly once during verification: a heavy
boot pushed 'loaded' to 15.7s — 0.7s past the fixed 15s deadline, so the mask
lifted onto the engine's own spinner.

## Fixes

- Auto-indexing waits for docReady plus an idle frame, and the extraction
  loop yields the main thread every ~12ms (1a880bb).
- Background PDF tabs mount on first activation instead of at boot
  (`PdfViewer.vue`) — boot pays for one engine, not one per tab.
- The mask deadline is split in two: a 60s watchdog over the file read (a
  failed read lifts the mask instead of spinning forever), then an engine
  budget that starts when the engine has the bytes and grows with the
  document (15s + 200ms/MB, capped at 60s).

## Lessons

- "Fast after reload" does not prove a browser cache: everything is slower
  under boot contention, and boot is exactly when restored tabs mount. The
  asymmetry the report described (first open slow, everything after fast) was
  contention, not caching.
- The engine's canvases live in closed shadow roots — paint cannot be probed
  from outside; `viewerHasLayout` is the working heuristic.
- 'loaded' is not first paint. Any UI keyed to 'loaded' can still be fronting
  a blank viewport.
