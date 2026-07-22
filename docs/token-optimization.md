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
