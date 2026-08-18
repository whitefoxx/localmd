# Read-aloud speaks with two voices (open)

**Status: unfixed. The feature is hidden** behind `READ_ALOUD_ENABLED` in
`src/lib/tts.ts` (2026-08-18). Everything below is what is known so far, so the
next attempt does not start from zero.

## Symptom

Select some text in a file — markdown, PDF or EPUB — and press read-aloud. Two
voices read it, over each other, a few seconds apart. Reported against the
deployed app on a mainland-China connection; still reproduces there after the
changes in "What was changed" below.

## What was measured

`window.speechSynthesis.speak/cancel` were wrapped in the running app and every
utterance's `start` / `end` / `error` recorded with timestamps. Reading one
paragraph, before any change:

```
34087  cancel()                     speaking=false        ← speak() clearing the queue
34170  speak(#1, "Google US English")                     ← never starts, never errors
38364  cancel()                     speaking=true         ← the 4s watchdog gave up
38364  speak(#2, "Samantha")                              ← local fallback
38365  error(#1) = "interrupted"
38382  speak(#3, "Samantha")                              ← queued ahead from #2's onstart
38383  start(#2)   …   46764 end(#2)   46770 start(#3)
```

So the shape is:

1. `pickVoice` prefers Google voices — they are network voices, synthesised by
   Google's servers.
2. Where Google is unreachable, the utterance is accepted (`speechSynthesis`
   even reports `speaking === true`) and then hangs: no `start`, no `error`.
3. The watchdog in `stores/tts.ts` calls `cancel()` and re-queues with a local
   voice.
4. **`cancel()` does not reliably silence a network utterance.** The engine
   fires `error: interrupted` for it immediately, but audio that was already on
   its way can still play — over the local voice we just started.

Step 4 is the one that cannot be observed from JS: nothing distinguishes "the
engine dropped it" from "the engine will play it in two seconds". On the
development machine (Intel Mac, Google voices unreachable too) utterance #1
never produced audio at all, which is why this could not be closed locally.

## What was changed (kept, insufficient)

In `src/stores/tts.ts`:

- **The fallback is session-sticky** (`networkDead`). It used to reset on every
  `speak()`, so a machine that can never reach Google re-ran the whole hang →
  cancel → talk-over dance on *every single read*. Now the first failure sends
  every later read straight to a local voice. Verified in the browser: the
  second read starts on a local voice in 11ms and never touches Google.
- **The first network attempt gets 1.5s instead of 4s** (`FIRST_TRY_MS`), so the
  window in which the engine can still start the utterance we are cancelling is
  much shorter. A network voice that has actually spoken once keeps the old 4s
  leash (`PROVEN_MS`) — a slow start is not a dead network.
- **250ms between `cancel()` and the replacement** (`CANCEL_SETTLE_MS`), to give
  the engine a chance to actually stop before a second voice starts.

Together these make it rarer — one possible overlap per session instead of one
per read — but the user still hears two voices, so the report stands.

## What has been ruled out

- **Two `speak()` calls from the UI.** Each `speak()` bumps `gen` and the queued
  callbacks are generation-guarded; the instrumentation shows one call per
  click.
- **A second TTS engine.** `SpeechSynthesisUtterance` / `speechSynthesis` appear
  nowhere outside `stores/tts.ts`.
- **The queue-ahead design** (the engine always holds the playing utterance plus
  the next one). If concurrent playback came from that, whole-document reads —
  many chunks — would double up worse than a two-sentence selection does, and
  they do not.

## What to try next

- **Stop choosing network voices by default.** `pickVoice` prefers `Google *`
  when the user has not picked a voice. Preferring local voices removes the hang
  path entirely for the default experience; a Google voice would then be
  something the user opts into in the bar. This is a product call (Google voices
  sound better and are consistent across platforms) rather than a bug fix, which
  is why it was not made unilaterally.
- **Probe before speaking.** A first utterance of a single space, with a very
  short watchdog, would decide "can this engine reach the network" without any
  audible text to talk over.
- **Check whether `pause()` before `cancel()`** silences a hung network
  utterance where `cancel()` alone does not. Untested; needs a machine where the
  hung utterance actually produces audio.

## Re-enabling

Flip `READ_ALOUD_ENABLED` to `true` in `src/lib/tts.ts`. Nothing was deleted:
the controller, the playback bar, the voice picker, the highlight-follow in
every viewer and their tests are all still in place — only the ways in are
hidden (toolbar buttons, selection popups, the note dialog's read button, and
the PDF's three `bm:read-aloud` toolbar/popup entries).
