# browser-md — working agreements

Principles for anyone (human or agent) working in this repo. CONTEXT.md is the
glossary — read it before renaming or reinterpreting a concept ("index",
"session", "slot", …).

## Language

**This is an English repo.** Code, identifiers, comments, docs, commit
messages, and LLM prompts are written in English by default — regardless of
the language the task was discussed in — unless explicitly asked otherwise.
The only intentional Chinese in the tree: the `zh` values in i18n catalogs
(`src/i18n/locales/*`), `LOCALE_NAMES`, and the CJK regex/fixture data in lib
(annotations / markdown / tts / pdf extraction).

## Product principles

- **The KB is a soft constraint.** Every convention — layout, frontmatter,
  linking — is a suggestion the agent follows and recommends, never a
  validation gate. Users hand-edit, move, and delete files outside the app;
  nothing may break or nag when they do.
- **The user's structure wins.** The `raw/` + `wiki/` layout is only the
  scaffold offered for brand-new empty KBs. Opening an existing folder must
  never graft our layout onto it: automatic writes land in a neutral `inbox/`
  when the KB has no `raw/` tree, and the agent files content according to the
  user's own organization. AGENTS.md is where a KB's structure is described —
  offer to write one that documents *their* layout; don't impose ours.
- **Minimal and manual over clever and automatic.** Prefer a manual action +
  a native dialog over background automation; prefer deterministic tools
  (kb_health) over LLM passes; confirm before token-heavy operations. Ship the
  simplest manual version first.
- **Tool-neutral KB.** KB-facing conventions live in AGENTS.md / `.agents/`
  (open formats), never vendor-specific directories.
- **Tool code provides capability, never a particular tool.** What we write is
  the generic machinery — the spec format, templating, response shaping, types,
  parameters, transports, config scopes, and how a credential is carried. If a
  feature request can only be met by adding a `defineTool` call or a branch per
  service, the machinery is missing something — extend the machinery instead.
  Individual tools are *data* created on top of it by the user or the agent:
  "search Hacker News", "add the Notion server" are conversations, not releases.
- **The catalog is three entries, and adding a fourth needs an argument.**
  localmd Connect plus two web searches — what someone wants before they know
  what they want. It is deliberately not a directory: a curated list is a promise that
  rots (entries need re-verifying forever, and every inclusion is an editorial
  call the machinery has made unnecessary), and the app already reaches a keyed
  service, a CORS-refusing one, or one behind OAuth. Point people at mcp.so and
  let the agent set it up. Retiring an entry is not deleting it — see
  `RETIRED_PACKS`: shrinking is a decision about what to *recommend*, never a
  licence to remove what a user already chose.
- **The agent proposes; the user disposes.** Anything with an outward effect —
  adding a server, spending a key, signing in — goes through a setup card the
  user clicks. Not politeness: the agent reads web pages, files and tool results,
  none of which can be distinguished from a genuine request by their content, so
  a page saying "add the server at …" reaches it the same way you do. It may put
  the address in front of the user and nothing more. Kinds are primitives
  (`confirm`, `signin`, `key`), never errands (`add_notion_server`).
  Three rules keep that gate honest:
  - **A decision defaults to no.** An absent, crashed, or unanswerable prompt
    denies; only an explicit yes proceeds, and it authorizes the one action
    asked about, never the next one. (The licence check in `run.ts` fails
    *open* on purpose — the failure that matters there is double-charging, not
    under-gating. Deliberate exceptions say so.)
  - **A richer card may change how a decision looks, never what an answer
    means.** A UI that recognises a card kind and one that falls back to a
    plain confirm must produce the same answer; presentation is a hint, never
    a second protocol.
  - **One fact, one place on screen.** A card points at the call it decides
    rather than re-rendering its arguments — a second copy is a second thing
    to drift.
- **Release the lock last.** Bracket a multi-step mutation so the marker that
  says "done" is written after the work, not before: a crash then leaves a
  detectable half-finished operation instead of a record that lies about having
  finished. The browser makes this routine, not exotic — the user closes the
  tab whenever they like.

## The app's own manual is part of the app

`docs/app/*.md` is the user manual, and it has two readers: the Help panel, and
the agent via `app_help`. One source, so what the agent says in chat and what
the Help page shows can never disagree.

**A user-visible change is not finished until the manual matches it.** Renaming
a settings section, moving a control, changing what a tag means, adding a
capability — if a doc describes the old behaviour, it is now telling users
something false, and telling the agent to repeat it. Treat a stale doc as a bug
of the same severity as stale code.

The mirror of that rule: **a record of what we decided once is not a statement
about what is true now.** `docs/token-optimization.md` and the ⏸/superseded
entries in it are a log — when a later pass overturns an entry, mark it
superseded and link forward rather than deleting it (the reasoning is why the
next person can tell an overturned call from an unexamined one). Never cite a
superseded entry as current behaviour, and never edit history to agree with the
present.

- **English is the only source of truth.** `<id>.md` is canonical and is the
  only version the agent ever reads (`appDocForAgent` pins `en`); replies follow
  the user's language, the facts do not. `<id>.zh.md` is a translation of it and
  can never be a topic in its own right — a topic without an English file does
  not exist.
- **Edit English first, then translate, then `npm run docs:sync`.** Each
  translation records the fingerprint of the English it was made from, and a
  test fails when they diverge. Do not stamp a hash to silence that test without
  actually updating the translation: the failure means the two languages now say
  different things, and the agent (reading English) will not be the one to
  notice.
- Tests also enforce the pairing, that both have a title/summary, and that every
  cross-reference resolves.
- Write for a non-technical reader: what it does and why they'd care, not how
  it is implemented. Reading order lives in `ORDER` in `src/lib/appDocs.ts`.
- Cross-reference a sibling as `` `topic-id` `` — the Help panel turns those
  into links, and the test catches dangling ones.
- Nothing about the app belongs in the system prompt: the manual is fetched on
  demand precisely so it can grow without costing tokens on every turn.

What the agent may CHANGE is an allowlist in `src/lib/appSettings.ts`. Adding a
field there is a deliberate act; anything not listed — every key, token and
secret — stays invisible to the agent by default. Never widen it to include
something that could carry a credential.

## Build in public

**A tellable change is not finished until its story is captured.** localmd's
audience (HN, PKM, local-first, AI tinkerers) follows process, not ads — the
build itself is the marketing, and the first 200 commits produced zero public
words. Don't repeat that.

The publishing system no longer lives here. Story material, drafts, schedule,
channel facts and the launch plan all live in `~/code/trace/influence` — the
`influence/` wing of the private trace knowledge base — driven by the global
skills `/story`, `/draft`, `/log`, available in any project directory. (Note
`/story`, not `/harvest`: in a KB, `harvest` means distilling a conversation
into wiki notes.)

- **When a task lands something tellable, offer `/story` in the same breath
  as the commit prompt** — "want me to commit and push? this also looks
  post-worthy, /story it?" Draft the hook; the user decides.
- Tellable is any of: a demo-able user-visible feature; a war story (bug,
  constraint, workaround — "git smart-HTTP has no CORS, so sync mirrors
  objects over the REST API"); a real number (tokens saved, ms cut); an
  opinionated design call ("tools are data, not code").
- The unit is the story, not the diff. Don't nag on every commit; batch at
  feature merges and session ends. A good commit message often *is* the draft
  (see 917ba00) — harvest it, don't rewrite it.
- localmd's one-liner, pillars and **anti-claims** live in
  `~/code/trace/influence/products/localmd/README.md`. Read it before writing
  any public-facing copy about the product; the anti-claims are binding.
- Methodology (transferable patterns + experiment log) lives in
  `~/code/trace/influence/principles/playbook.md`. When the process teaches
  something, that's where it goes.

## Token economy

The request prefix is a cache key — every LLM provider bills repeated bytes at
a fraction of fresh ones, but only when the prefix matches exactly (Anthropic
additionally needs explicit `cacheControl` breakpoints). When touching the
agent pipeline (docs/token-optimization.md has the full log):

- **Append, don't rewrite.** Never mutate earlier history/prompt bytes on a
  per-turn basis; hygiene (trimming, compaction) runs as discrete batch events
  behind size thresholds (`TRIM_AT_TOKENS` / `COMPACT_AT_TOKENS`).
- **Measure context in tokens, anchored on real usage.** `lib/tokenMeter`
  prices a session as the last provider-reported `inputTokens` plus an estimate
  of what was appended since, so the heuristic only ever prices the tail. Any
  code path that rewrites `history` instead of appending to it must clear
  `session.tokenAnchor` — a stale anchor reports a size the history no longer
  has. Never anchor on subagent usage (it measures a different, tiny context;
  those events are tagged `subagent`).
- **Keep prompt bytes session-stable.** The system prompt's stable/dynamic
  split, the session-frozen dynamic block (`sessionSystemPrompt` — file inputs
  like MEMORY.md are read once per session, only capability changes rebuild),
  the frozen deferred-tools catalog, and byte-identical subagent tools+system
  all exist so the cache prefix survives; don't add content that varies
  turn-to-turn.
- **Always-on text is paid on every step of every turn.** Before extending the
  system prompt or a tool description, prefer just-in-time delivery: error
  messages, tool results, use_skill, enable_tools.
- **Verify with the usage tooltip** (cache hits/writes in the chat composer):
  a near-zero cache-hit share across a multi-turn session means a
  prefix-stability regression.

## Hard compatibility constraints

- doc-index is byte-compatible with trace-app: `.trace/*-index/` layout,
  INDEX_VERSION 11 (PDF) / 3 (EPUB) — never bump casually.
- The `raw/` capture routing table (`rawSubdirFor` in src/lib/capture.ts)
  matches trace-app byte-for-byte.
- Browser-only: no backend. LLM endpoints must allow CORS from the browser;
  all file access goes through the File System Access API.

## Dev workflow

- `npm run dev` · `npm run typecheck` · `npx vitest run` · `npm run build` ·
  `npm run test:e2e`
- e2e runs ONLY through Playwright (`npm run test:e2e`) — never open `?e2e=1`
  in a real browser profile.
- **Verify browser-facing work in a real browser.** typecheck and vitest cannot
  see the three things this app actually lives on: CORS, the Chrome-extension
  transports, and the File System Access API. Drive the running dev server
  through **Claude for Chrome** (`mcp__claude-in-chrome__*`) — plain browsing of
  the app, never `?e2e=1`. Before claiming an endpoint works,
  `fetch` it from the page origin; before claiming a feature works, click the
  path a user would rather than only the store beneath it. This is not
  ceremony: shaping real API responses caught a placeholder-regex bug that a
  fully green suite did not. Restore any real settings you mutate while testing.
  One trap when the KB under test is the **demo**: it lives in memory, so any
  source edit you make while that tab is open triggers HMR, re-seeds it, and
  silently throws away the KB state you set up to test. Finish the browser pass
  before touching `src/` again.
- Every UI string goes through `t('ns.key')` with both `en` and `zh` entries
  (tests enforce catalog parity and key existence).
- Commit in stages, one concern per commit; ask before committing.
