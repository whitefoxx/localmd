# Build-in-public playbook — the transferable part

This file is the seed of a future shareable skill. localmd is the test bed;
everything here must be written so it works for *any* solo developer's
project — project-specific state stays in the sibling files. Two sections:
**Patterns** (distilled, stable) and **Experiment log** (dated observations,
raw material for future patterns). When the playbook stabilizes, package it
as a skill.

## Patterns

### P1 — Extend "done", don't add a habit
Attach story-capture to a definition-of-done the team already enforces, and
to a prompt that already fires (the commit prompt). A parallel "remember to
post" habit dies; a rider on an existing checkpoint survives. In agent-driven
repos, the agent *is* the reminder: instruct it (CLAUDE.md or a skill) to
offer a story entry with a drafted hook whenever tellable work lands.

### P2 — Tellable = one of four shapes
A demo-able user-visible change; a war story (bug, constraint, workaround);
a real number (cost cut, ms saved); an opinionated design call. If it's none
of these, it's a diff, not a story — don't post it.

### P3 — The unit is the story, not the commit
Batch at feature merges and session ends. Nagging per-commit trains the
builder to ignore the mechanism.

### P4 — Pipeline with one file per concern
`backlog` (material) → `calendar` (schedule) → `drafts/` (one file per post)
→ `posted` (public trail with links). A single ledger file got messy within
one day of real use; drafts especially need their own files. No double
bookkeeping: content moves forward, it is never copied.

### P5 — Retroactive recovery works
Missed the real-time window? Mine git history: war stories and demos don't
expire, only serial suspense does — and the retrospective mega-thread ("N
days, M commits") is itself a proven format. Write narrative commit messages
and the mining is nearly free: a good commit body *is* the draft.

### P6 — Verify channels against primary sources before planning
Platform folklore rots: free tiers disappear, subreddits ban what blogs say
they welcome, your own accounts may be dead. Fetch each platform's live
submit/pricing/rules page (and log the URL) before a channel enters the
plan. Discoveries in one pass here: a "free" directory had gone pay-only, an
AI directory's paid tier hid a free path for free tools, one subreddit
insta-bans first-post promo, and the founder's Reddit account turned out
suspended.

### P7 — Anti-claims before copy
Decide what must NOT be said before writing any post: unverified features,
"open source" in the present tense when it's a plan, absolute privacy claims
with fine print. One overclaim in front of a technical audience costs more
than ten good posts earn.

### P8 — Mark reserved ammunition
Some stories fire once (the meta-thread, the origin story). Tag them
`reserved` with the event they're waiting for, so daily cadence can't
accidentally spend them.

### P9 — One line, byte-identical, everywhere
The positioning one-liner compounds only through exact repetition. Every
draft ends at the same sentence and URL.

### P10 — Record once, reuse everywhere
Media is the expensive part. Identify the flagship demo (the 5-second clip
that proves differentiation), produce it once at high quality, and reuse it
across every channel. Text stories need zero assets — schedule those first.

### P11 — Each launch is one story; don't spend two on one day
Product launch, open-sourcing a component, first paid tier — separate events,
separate weeks, each with its own channels. A wave plan beats a single big
bang.

## Experiment log

Dated observations from the localmd run. Promote to Patterns when they
generalize; strike through when falsified.

- **2026-07-29** — Mined 12 post-worthy stories from 200 commits in one pass;
  the reflective commit style made hooks nearly copy-paste (→ P5). The
  single-file ledger became hard to navigate the same day it gained a drafted
  post (→ P4).
- **2026-07-29** — First X post shipped only after the mechanism existed —
  the reminder-in-workflow theory (P1) held for day one; watch whether the
  cadence survives a busy build week.
- **2026-07-28** — Platform verification pass: BetaList free path gone
  (pay-only tiers), TAAFT free-for-free-tools nuance, r/ObsidianMD
  first-post-promo ban, founder's Reddit account suspended (→ P6). Also:
  fetch rules via the platform's own JSON/old-web endpoints when the main
  site blocks bots; a logged-in browser beats an anonymous fetcher.
- **2026-07-28** — OG/Twitter metadata was missing until a pre-launch audit
  caught it; "share a link with yourself in a chat app" is a cheap smoke test
  every project should run before any posting. Candidate pattern: a Wave-0
  readiness checklist (share metadata, demo GIF, feedback channel, canned
  answers, analytics decision).

## Open questions (need data before they become patterns)

- Does daily posting actually convert to activation for a BYO-key product,
  or do only launch-event spikes matter?
- Which story shape (P2) performs best per channel?
- Minimum viable cadence: does 3×/week lose compounding vs daily?
- Does the zh/en split (same story, different language channels) double reach
  or split attention?
