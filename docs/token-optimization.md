# Token optimization — plan & implementation log

> 2026-07-22. Status: everything below marked ✅ is implemented and tested
> (typecheck · 266 vitest · build · 7 e2e all green). Items marked ⏸ are
> deliberately deferred with the reasoning recorded.

## Cost anatomy (measured before the changes)

Every API request re-sends a fixed prefix, and an agent turn makes one request
per step (up to 25):

| Part | Size |
|---|---|
| 24 built-in tool defs | ~8.9k chars of descriptions + schema overhead ≈ 3.5–4k tokens |
| BASE system prompt | 9,250 chars ≈ 2.3k tokens |
| Dynamic prompt parts | 0.5–2k tokens (skills list, deferred catalog, AGENTS.md, MEMORY.md) |

The real lever is not shrinking this prefix — it's making sure repeated bytes
are billed at **cache price** (Anthropic reads 0.1×, DeepSeek ~0.1×, OpenAI
0.25–0.5×, Gemini/Groq/xAI similar). All providers cache by **exact prefix
match**, so the request bytes must be stable; Anthropic additionally requires
**explicit breakpoints** (`cache_control` markers) or nothing is cached at all.

## What was wrong

1. **Anthropic message history had zero caching.** Only the system block
   carried a breakpoint; every step of every turn re-read the whole
   conversation at full price.
2. **Per-turn trimming rewrote history bytes every send** (`trimHistory` on
   each send moved the stub boundary), invalidating every provider's prefix
   cache from the rewrite point.
3. **`estimateChars` counted base64.** One pasted screenshot (200–500k chars of
   base64) blew past `COMPACT_AT_CHARS` and could trigger compaction spuriously.
4. **The deferred-tools catalog shrank on activation**, changing the system
   prompt bytes mid-session.
5. **Subagents couldn't share the cache prefix** (system suffix + missing
   run_subagent tool made their prefix unique).
6. **BASE duplicated just-in-time content** (GitHub token troubleshooting that
   `explainGithubError` already returns at failure time; create_artifact
   requirements repeated in the tool description).

## Implemented

### P0 — cache correctness

- ✅ **Moving breakpoint for Anthropic** (`src/lib/promptCache.ts`, applied in
  `run.ts` `prepareStep`): each step marks the last message with
  `cacheControl`, stripping earlier marks (≤4 breakpoints per request). The
  growing history is written to cache once and re-read at 0.1× on every later
  step and turn. Non-Anthropic providers skip it (they cache by prefix
  automatically).
- ✅ **Two-block system prompt** (`prompt.ts` returns `{stable, dynamic}`;
  `run.ts` sends two system messages, each with its own breakpoint): the
  stable block (BASE) survives KB/session/locale changes; per-KB material only
  invalidates its own block.
- ✅ **Frozen deferred catalog** (`stores/mcp.ts` `deferredCatalog`): the
  system-prompt catalog ignores session activation, so its bytes never change
  mid-session. Activation still gates which schemas are sent.
- ✅ **Media-safe `estimateChars`** (`history.ts`): base64 payloads under
  `image`/`data`/`base64` keys count as a constant marker.
- ✅ **Batch trimming** (`chat.ts` + `TRIM_AT_CHARS = 60k` in `history.ts`):
  history stays append-only until the size threshold, then everything outside
  the keep window is stubbed in one go and persisted. Trims and compaction are
  discrete events; between them the prefix is byte-stable.

### P1 — structural savings

- ✅ **Subagent cache sharing** (`run.ts`): the subagent framing moved from the
  system prompt into the task's user message, and subagents register a
  same-bytes `run_subagent` stub (execute refuses). Tools + system are now
  byte-identical to the main loop, so subagent calls hit the same cache.
- ✅ **Prompt slimming** (`prompt.ts` BASE): the GitHub token-troubleshooting
  paragraph now defers to `explainGithubError`'s at-failure guidance;
  create_artifact requirements live only in the tool description. ~270 words
  cut with no behavioral loss.
- ✅ **Folded list_files** (`src/lib/fileList.ts`): listings over 400 files
  return a per-directory summary (count + 3 example names, root files in
  full); the agent drills down with `dir`. Layout intent survives, bulk doesn't.

### P2 — polish

- ✅ **Reasoning stripped from old turns** (`history.ts` trim): dead
  chain-of-thought is dropped at trim events (official SDKs strip it
  server-side anyway; this protects openai-compatible reasoning models),
  unless the message would end up empty.
- ✅ **Model-facing image downscale** (`vision.ts`): rasters over 1568px on the
  long edge are canvas-downscaled (PNG stays PNG, others → JPEG 0.85) before
  base64; the KB file keeps full resolution. Vision billing scales with pixels.
- ✅ **kb_health per-category cap** (`lint.ts`): 40 entries per list + "+N
  more"; counts stay exact, full lists live in the Health panel.
- ✅ **Cache observability** (`types.ts`/`run.ts`/`chat.ts`/ChatPanel): usage
  events now carry `cacheWrite`; the session token tooltip shows cache
  reads/writes so caching regressions are visible in normal use.

### P3 — pre-activated tool recall (2026-07-26)

A gap the original pass missed: **the tools array sits at the very front of the
cache prefix** (providers render `tools` → `system` → `messages`), so the first
`enable_tools` of a session doesn't just cost its own round trip — it changes
byte 0 and invalidates the *entire* prefix, forcing the frozen catalog, both
system blocks and the whole history to be re-written mid-turn. Everything under
P0 exists to keep those bytes stable, and activation was quietly undoing it.

- ✅ **Recall of used deferred tools** (`lib/mcp.ts` `MAX_RECALLED_TOOLS = 8` +
  `recallTouch`, `stores/mcp.ts` `recalled`/`rememberUse`/`preactivate`,
  seeded from `chat.ts` `addTab`): a deferred tool the agent actually CALLED is
  remembered per KB (localStorage, LRU, capped) and pre-activated when a new
  session opens. The common case loses the enable_tools round trip and keeps a
  byte-stable tool set from request one; the activation breakpoint moves to
  session start, where a cache write was due anyway.
- The cap is the whole safety story: pre-activated schemas ride along with every
  request whether or not the session needs them, which is exactly the cost
  deferral exists to avoid. Only *called* tools earn a slot (enabling one is not
  enough), and the list is capped at 8 — raise it only with usage data.
- The system-prompt catalog is untouched: `deferredCatalog` still ignores
  activation, so pre-activation changes which schemas are sent and not one byte
  of the prompt. Re-attaching a *running* session skips pre-activation — growing
  its tool set mid-turn is the invalidation this exists to avoid.

### P4 — raw bulk stays out of the main history (2026-08-12)

Diagnosed from a real session (an HN-reading session compacted on four
consecutive turns): the `.trace/` recall added in P3's wake (oversized external
results saved to `.trace/tool-results/`, clip note pointing at the file) let a
single turn ingest a whole web page — 40k clipped inline plus the remainder via
`read_file` continuation at up to `MAX_READ_CHARS` = 100k. One turn reached
~216k serialized chars, above `COMPACT_AT_CHARS` on its own. The trim/compact
keep window (`keepTurns` = 2) protected that turn wholesale, so each compaction
summarized only the already-stubbed old prefix, paid a summarizer call plus a
full-prefix cache invalidation, and freed almost nothing — then fired again the
next turn. Note the recall chain itself is append-only and cache-clean; the
damage was the permanent history growth and the pointless compactions it forced.

The fix follows the pattern Claude Code uses (subagents read bulk in throwaway
contexts; "microcompact" clears old tool results before full summarization —
productized server-side as Anthropic's `clear_tool_uses` context editing):

- ✅ **Tool traffic keeps a one-turn window** (`history.ts` `toolKeepTurns` = 1,
  images/reasoning keep `keepTurns` = 2): a turn's tool results are its working
  set and the assistant reply is the digest that survives — after the turn the
  raw results are stubbed at the next trim event. Trims stay batch events;
  nothing here rewrites bytes per-turn.
- ✅ **Store before the stub destroys** (`history.ts` `trimCandidates` +
  `chat.ts` `stashTrimmable` + `toolResults.ts` `recallPathIn`): external
  results the trim is about to stub are written to `.trace/tool-results/`
  first, and the stub names the path — recall is one deterministic `read_file`,
  not a re-call that may re-rank, refuse, or bill. Results already clipped at
  call time reuse the path in their clip note. Built-in results keep the plain
  "call the tool again" stub (deterministic, and file content is already in the
  KB) — `isBuiltinToolName` draws that line.
- ✅ **Clip note steers big remainders to run_subagent** (`toolResults.ts`
  `DELEGATE_REMAINDER_CHARS` = 20k): past that, the note recommends delegating
  "read the file, report what's needed" to a subagent — the raw text burns in
  a discardable context (which shares the cache prefix, see P1) and only the
  digest enters the main history. Just-in-time text on the result; zero prompt
  bytes.
- ✅ **Compaction refuses to run when it cannot help** (`chat.ts`): if
  `split.recent` alone exceeds `COMPACT_AT_CHARS`, summarizing the old prefix
  cannot bring the size under the threshold — skip instead of paying the
  summarizer plus a full-prefix invalidation; the next turn's trim frees the
  window instead.
- ✅ **`COMPACT_AT_CHARS` raised to 250k** (from 150k): the old value was set
  when nothing could reach a turn's tool results. Now that trim does, reaching
  250k takes real conversation, and compaction — the one operation that
  rewrites the cache prefix in full — becomes rare. The trim is what keeps a
  session inside a provider's window; this is only the backstop behind it, so
  it must not be pushed past a model's context. English runs ~70k tokens at
  250k chars, CJK closer to one token per char.

Replaying the diagnosed session against the new rules: the heavy turn's ~210k
of raw page text is stubbed at the next send's trim (its digest — the
assistant's own analysis — survives), the history drops back under
`TRIM_AT_CHARS`, and none of the four compactions fire.

One fact worth recording, found while verifying: `clipWithRecall` sits on the
MCP path only (`toExternalSpec`). Installed HTTP tools apply their own
`maxChars` budget inside the tools store and never reach the clip, so they
neither store to `.trace/` at call time nor get the delegate note. They do
still get stored by the trim, which works off the history and does not care
where a result came from.

### Verified in a real browser (not only vitest)

typecheck and unit tests cannot see the File System Access API or a live
provider, so the whole path was driven through the dev server in Chrome
against a real KB and real sessions:

| Check | Result |
|---|---|
| Real `send()` on an 81k-char session | persisted history 81,318 → 35,208 chars |
| External results stored | 3 files under `.trace/tool-results/<session>/`, one of which did not exist before — proof the send path wrote it |
| Content-addressed writes | re-storing the same result rewrote the same path, no duplicates |
| Stubs | all three carried their recall path |
| Recall round-trip | `read_file` on a stub's path returned exactly 27,654 chars, matching the original result |
| Built-in results | a 27,654-char `read_file` result was correctly *not* stored, and its stub is the generic form |
| Delegate note | deepwiki `read_wiki_contents` for `vuejs/core` returned 523,892 chars; the note fired and the whole result landed on disk |
| Compaction guard, `recent` over threshold | skipped — no banner, no summary |
| Compaction guard, `recent` under threshold | fired — 35,437 → 3,682 chars |

The last two are the same session and the same code with only the threshold
moved, which is what makes them a control: the guard suppresses a useless
compaction without suppressing a useful one.

## Deliberately not done

- ⏸ **Deferring the 9 git tools** — after caching, they cost ~1k tokens at 0.1×;
  deferral risks the model not finding them. Negative ROI.
- ⏸ **Compressing the citation rules** — load-bearing product semantics.
- ⏸ **Injecting the KB tree into the system prompt** — re-sent every turn and
  destabilizes the prefix; the tool-result path is cheaper.
- ⏸ **A "utility" model slot for titles/compaction** — real savings are small
  (titles ≤500 output tokens, compaction is rare) and it adds a Settings knob,
  against the minimal-config principle. Revisit only if usage data shows
  compaction cost mattering.

### P5 — the thresholds were measuring the wrong thing (2026-08-14)

Borrowed from DeepSeek Harness, whose `ctx.tokenMeter` prices a session as the
last real provider usage plus a signed estimate of what changed since. Both of
our thresholds counted serialized **characters**, which is not a unit anyone
bills in, and the fix turned up something larger than the bug it was aimed at.

The known problem was language. 250k characters is ~70k tokens of English and
~250k of Chinese, so one threshold meant two entirely different things: a
Chinese session compacted far later than intended, or blew the context window
before the backstop fired at all.

The unknown problem was the prefix. Measured against a real KB through the dev
server — two turns on the same session, the second one anchored:

| | history estimate | anchored request pressure |
|---|---|---|
| turn 1 (no anchor yet) | 1,085 tok | — |
| turn 2 | 1,154 tok | **21,147 tok** |

The conversation was ~1.2k tokens; the request was 21k. The other ~20k is the
system prompt plus tool schemas — paid on every step of every turn, and
completely invisible to a character count of the history. **The old thresholds
were watching about 5% of actual context pressure.**

- ✅ **`lib/tokenMeter`**: `pressure = anchor.tokens + estimateTokens(appended
  since)`. The anchor is the last main-loop `usage.inputTokens` plus that step's
  `outputTokens` — together they price the history exactly as it then stood,
  prefix included (every provider reports the cached portion *inside* that
  total, not beside it; verified in `@ai-sdk/anthropic`'s
  `convert-anthropic-usage.ts` and `@ai-sdk/openai-compatible`, both of which
  set `inputTokens.total = noCache + cacheRead + cacheWrite`). The heuristic
  only ever prices the tail, so its error cannot compound over a session.
- ✅ **CJK-aware estimate**: ~1 token per CJK/kana/hangul character, ~4
  characters per token otherwise, both rounded against us — the failure that
  matters is running hygiene too late.
- ✅ **The two thresholds now measure different things, deliberately.** Trim is
  decided on `estimateTokens(history)` (20k) because stubbing tool results
  cannot shrink the prompt or the schemas; handing it the anchored total would
  let a 20k constant it cannot reduce fire it on every single send and free
  nothing — the same pathology P4 fixed for compaction. Compaction is decided on
  anchored pressure (90k) because keeping the whole request inside the window is
  exactly its job.
- ✅ **Subagent usage is tagged and never anchored on** (`AgentEvent.usage`
  gains `subagent?: true`): it flows through the same `onEvent` so its cost
  shows up, but it prices a throwaway context of its own. Anchoring on it would
  under-report the main conversation by an order of magnitude, and relying on
  event ordering to avoid that would have been luck rather than a contract.
- ✅ **Anchor invalidation is part of the contract**: compaction, branch
  switching and profile switching all clear `session.tokenAnchor`, and
  `measureTokens` additionally degrades to a pure estimate when the history has
  shrunk below `atLength` — the anchor is set in one place and the history is
  rewritten in several, so a missed clear must read low, never stale-high.
- ✅ **Trim reprices the anchor instead of clearing it** (`anchorAfterShrink`).
  Found while verifying, not while designing: the first version cleared on trim
  like every other rewrite, and the probe showed pressure collapsing 22,776 →
  1,286 the moment it did. Compaction runs immediately after trim and decides on
  that number, so clearing there made the one decision that must see the whole
  request the one decision blind to 20k of it — firing that much late on exactly
  the sends where hygiene was already needed. A trim preserves message count, so
  the provider-measured baseline survives and only the estimated size of what
  was removed is subtracted; the heuristic stays responsible for the delta
  alone. This is the signed-delta half of dsh's meter, which the first pass
  borrowed only the anchor from.

Verified in a real browser by the P4 method — the same session and the same
code with only the thresholds moved, which is what makes it a control:

| Threshold config | `willTrim` | anchor after trim | `willCompact` | banner |
|---|---|---|---|---|
| TRIM 100 / COMPACT 50 | true (1,286 > 100) | survived | false (recent 132 > 50) | none |
| TRIM 100 / COMPACT 5,000 | true (1,363 > 100) | survived, 19,656 | true (recent 141 ≤ 5,000) | shown, history 18 → 6 |

The pair is the point: the guard suppresses a useless compaction without
suppressing a useful one, and in both rows the anchor carried the prefix
through the trim so compaction judged 19,656 rather than 1,363. Trim's own
mechanics (stubbing, `.trace/` stashing, recall paths) were not re-verified
here — this change touches only the trigger and the anchor, and P4 verified the
rest against a real session.
- Runtime-only by choice: an anchor describes one exact `history` array and
  costs a single turn to re-earn, so it stays off the persisted schema and a
  reload simply estimates until the first reply.

Removed with it: `estimateChars`, `TRIM_AT_CHARS`, `COMPACT_AT_CHARS`. Leaving
dead constants named after the old unit would have told the next reader that
characters were still the live threshold.

### P6 — installed tools were exempt from deferral (2026-08-14)

The P5 audit made the prefix's composition measurable, and the second-largest
block turned out to be a policy hole rather than a cost of doing business:
installed HTTP tools — the KB's weread/zhihu/hn bundles, 24 tools, ~3.3k
estimated (~28% of the prefix) — rode in EVERY request. The comment in run.ts
said it outright: "Always active, like the built-ins." Meanwhile the same kind
of thing arriving as an MCP server had deferral: past `DEFER_THRESHOLD` tools,
schemas stay out and a one-line catalog goes in the prompt.

The fix is the policy the MCP registry already had, with the bundle as the
unit — a bundle is this registry's server: one service, installed together,
used together. Ungrouped singletons stay active like small servers' tools do,
and the catalog's own web pack is pinned active (the product's baseline reach).
`enable_tools` now activates across both registries from one catalog; recall
and preactivation mirror the MCP store per KB.

Verified against the live request (a page-level fetch hook, since the model's
own answer proved unreliable — a resumed session happily "listed" tools from
memory that its request did not contain):

| | before | after |
|---|---|---|
| tools in request | 84 | 61 |
| weread/zhihu schemas | 23 | 0 (catalog lines instead) |

Mid-turn activation closes the loop end-to-end: asked to search weread, the
model called enable_tools, then weread_search, and got a real result in the
same turn; the recall store then held `["weread_search"]` for the KB, so the
next session skips even the activation round trip.

## Validating

Watch the session token tooltip (chat composer status line): after the first
turn of a session, `cache hits` should grow roughly in step with `in` on
Anthropic and DeepSeek profiles. A cache-hit share that stays near zero across
a multi-turn session means a prefix-stability regression — check for anything
that rewrites earlier request bytes (system prompt, tool list order, old
messages) between requests.

## The principle going forward

See CLAUDE.md → "Token economy". In short: the request prefix is a cache key.
Append, don't rewrite; make cleanups batch events; anything added to the
system prompt or a tool description is paid on every step of every turn —
prefer just-in-time delivery (error messages, tool results, use_skill).
