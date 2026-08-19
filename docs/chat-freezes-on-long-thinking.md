# A long thinking phase froze the whole app (fixed)

**Status: fixed** — the transcript's messages moved into a `MessageRow`
component (`src/components/chat/MessageRow.vue`), plus three whole-conversation
computations off the per-delta path; `tests-e2e/perf-stream.spec.ts` pins the
property that broke (2026-08-19). Kept because the symptom named the wrong
subsystem, and the measuring route is reusable for any "the UI locks up"
report.

## Symptom

While the agent was thinking for a long stretch, the whole page stopped
responding — nothing in the app could be clicked, not just the chat panel. It
recovered once the turn finished.

## Root cause

Every message in the transcript was rendered by ChatPanel's own render
function. A streamed delta mutates one part of one message, and Vue re-runs
whichever render function read it — so each delta re-rendered the ENTIRE
conversation. Deltas arrive tens of times a second, and reasoning models emit
thousands per turn, so the cost per delta was proportional to how long the
conversation already was.

Three more computations sat on that same path and each walked the whole
session on every delta:

- the auto-follow watcher's source mapped over every message and joined the
  result into a string,
- `sessionCiteSources` joined the text of every message and re-parsed it,
- `annotateAssistant`'s cache signature was built from the full text of the
  message being checked — for every message on screen.

And once a second, the throttled mid-stream `persist` called
`idb.listSessions`, which fetches and deserializes every stored session in the
KB.

None of these was a single long freeze. Together they filled the main thread
with continuous 10–40 ms tasks, which is what "nothing responds" actually
feels like.

## Numbers

The same thought (~18 KB, 2,300 deltas, one per macrotask) streamed into
sessions of different lengths, before the fix:

| open transcript | wall time | 1 s timer starved by |
| --- | --- | --- |
| empty | 11.5 s | 23 ms |
| 40 turns (~120 KB) | 13 s | 49 ms |
| 150 turns (~450 KB) | 43.6 s | 283 ms |

A CPU profile of the 100-turn case (30 stored sessions) found **1.4 % idle**
across 21 seconds: 2.8 s in Vue's reactive `get`, 1.3 s creating vnodes,
0.8 s in the auto-follow watcher, 0.4 s in `annotateAssistant`, 0.3 s in
`idb`'s `getAll`. After the fix, the same run was 8.4 s wall at **56 % idle**,
and the app's own frames had dropped out of the profile's top entries
entirely.

## Why it was so hard to see

- **The obvious probe stayed green.** Streaming a long thought into an *empty*
  session produced zero long tasks and a 2 ms worst-case input delay. The bug
  is a product of two variables (delta rate × conversation length) and one of
  them has to be large before anything shows.
- **"Nothing is clickable" reads as a modal overlay or a disabled control.**
  Auditing full-screen `inset-0` layers and `:disabled="chat.running"`
  bindings came up empty; the freeze was occupancy, not blocking.
- **There is no single long task to find.** Total blocking time was tens of
  milliseconds even while the page was visibly unusable, because the work was
  spread across thousands of tasks that individually cleared the 50 ms bar.
  What showed it was starving a fixed-rate `setInterval` — 283 ms between
  ticks of a 50 ms timer — not the long-task observer.

## Fix

`MessageRow.vue` puts a component boundary around each message, so a delta
re-renders one row. That only holds while nothing in a row reads session-wide
reactive state that a delta changes, which is why the row takes `citeSources`,
`kbPaths`, `version` and `last` as props the panel derives once, and why the
1 s clock is imported from `chat/shared.ts` rather than passed down (a prop is
read by the LIST's render function, so a tick would rebuild every row).

Alongside it:

- the auto-follow watcher measures only the newest message, since only it
  grows, and the scroll it triggers is coalesced into one per animation frame
  (reading `scrollHeight` right after a DOM patch forces a layout);
- `sessionCiteSources` parses per message with a memo keyed on text length,
  merges, and returns an identity-stable Map — a fresh Map each delta would
  invalidate every row's rendered HTML and put the whole cost straight back;
- `annotateAssistant`'s hand-rolled cache became a plain `computed` inside the
  row, which does the same memoizing for free;
- mid-stream `persist` skips the session-list re-read (`persist(session,
  false)`); the turn-end persist restores it.

## Lessons

- **A "the UI is frozen" report is a main-thread occupancy question, and the
  measurement comes before the theory.** The productive instruments were a
  starved fixed-rate timer, real `pointerdown` → handler delay, and a CDP
  sampling profile — in that order. Reading code to build a theory first would
  have pointed at the markdown renderer, which turned out to cost nothing.
- **Long-task counts can stay near zero while the app is unusable.** Many
  sub-50 ms tasks back to back are indistinguishable from a freeze to the
  person clicking, and invisible to `PerformanceObserver({entryTypes:
  ['longtask']})`.
- **Reproduce along the axis that scales, not the one in the report.** The
  report said "long thinking"; the variable that made it visible was
  conversation length. Seeding a session straight into IndexedDB turned a
  many-minute setup into a millisecond one and made the axis sweepable.
- **A performance regression test should assert a ratio, not a duration.**
  Absolute timings say more about the machine than the code. "A long session
  costs no more per delta than a short one" is the property that broke, it is
  stable across machines, and it went red at 3.7× on the old code and green at
  1.6× on the new.
- In Vue, a component boundary is a performance boundary. Splitting a big
  template is not only about readability — it is how you tell the framework
  what may be re-rendered independently.
