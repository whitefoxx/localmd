# localmd cold-start launch plan

Working plan for taking localmd (localmd.app) from zero to its first real users,
and sequencing launches against the business roadmap (credits first, then sync).
Channel facts live in `launch-platforms.md`; this doc is the strategy on top.

## Positioning

One-liner (reuse everywhere, keep byte-identical so the message compounds):

> An AI knowledge base that runs in your browser. Your notes, PDFs, and chats
> live in a local folder — no account, no upload.

Three pillars every piece of copy should ladder back to:

1. **Genuinely local-first.** A static page; files via the File System Access
   API; your API key lives in the browser and goes only to the provider you
   chose. There is no server to upload to.
2. **An agent that works in your files.** Reads PDFs/EPUBs with block-level
   citations, writes and links Markdown, edits with your approval — not a chat
   window bolted onto notes.
3. **No lock-in.** Plain Markdown in a folder you picked; built-in git; leave
   whenever you like.

### Audience-specific hooks

| Audience | Hook | Where |
|---|---|---|
| Hacker News | The architecture story: no backend at all — isomorphic-git in the browser, GitHub sync via the REST Git Data API (smart-HTTP has no CORS), LLM calls straight from the page, prompt caching client-side | Show HN + a technical write-up |
| PKM / Obsidian crowd | "An agent for the folder you already have" — opens an existing vault, adapts to its structure, changes nothing without approval. Never frame as an Obsidian killer | Reddit PKM subs, forums |
| Local-first / privacy | No account, no server, keys never leave the browser; the honest version: your text goes only to the model provider you configured | local-first communities, directories |
| AI tinkerers | BYO key, multi-provider via Vercel AI SDK, vision slot for text-only mains | AI directories, X/Twitter |
| Students / researchers | Drop in a paper, ask, click the citation, land on the exact paragraph | demo video, use-case posts |

### Anti-claims — things we must NOT say

- "Works in any browser" — it is Chromium-only (File System Access API).
  Preempt instead of hiding: a one-line "Why Chrome-only?" near the open button.
- "Open source" — the app repo is private today. Honest roadmap answer: the
  agent runtime is planned to be extracted and open-sourced as a separate
  package (see Wave 3).
- "Your data never leaves your machine" unqualified — chat text goes to the
  provider the user configured. Say it precisely; this audience reads fine print.
- "Works with local models (Ollama)" — plausible via the OpenAI-compatible
  custom provider + `OLLAMA_ORIGINS`, but **unverified**. Verify end-to-end
  before this claim appears anywhere; if it works it is a headline feature for
  r/LocalLLaMA, if it doesn't we never said it.

## Launch waves

Sequencing principle: each wave is a distinct news event with its own story.
Don't spend two stories on one launch. One channel at a time early on, so
feedback stays attributable.

### Wave 0 — readiness gate (before any posting)

Blockers, in order:

1. **Share metadata.** `index.html` today has no meta description and no
   OG/Twitter tags — links pasted anywhere render bare. Add description,
   `og:title/description/image`, `twitter:card`. og:image: 1200×630 PNG in
   `public/` (adapt the BetaList feature card).
2. **Demo assets.** One 60–90s screen recording (open folder → drop a PDF →
   ask the agent → click the citation → approve an edit) + a short looping GIF
   for posts. The GIF is the single highest-leverage asset for Reddit/X.
3. **Feedback channel.** Repo is private, so create a public `localmd/feedback`
   issues repo (or equivalent) + a contact address; link both in the app footer
   and on the landing page. Launching without a feedback path wastes the launch.
4. **"Why Chrome-only?" line** on the landing near the open button, and confirm
   the unsupported-browser message reads as friendly, not broken.
5. **Analytics decision.** Zero-analytics is on-brand but leaves every channel
   experiment blind. Recommended compromise: a cookieless, privacy-respecting
   counter (Plausible/GoatCounter) + UTM per channel; state it plainly on the
   privacy page. Owner's call — decide before Wave 1, retrofitting loses data.
6. **Canned answers** drafted for the five questions that will come: privacy /
   what-leaves-the-machine, Firefox/Safari, "why not an Obsidian plugin",
   "is it open source", "how will you make money" (answer: free core forever,
   BYO key stays free; paid zero-setup credits later — saying this early
   preempts rug-pull fear).
7. **Ollama verification** (see anti-claims).

### Wave 1 — soft launch (feedback, not reach)

Goal: 20+ concrete onboarding-friction reports and first testimonials, before
the audiences that only give you one shot.

- 中文首发: V2EX 分享创造 (maker's home turf, high-quality technical feedback),
  then 少数派 long-form if the response warrants it.
- r/SideProject + Indie Hackers: expect toolmaker feedback, not users.
- Low-stakes directory drip (from `launch-platforms.md`): the long-tail free
  directories, a couple per week — they compound SEO and cost nothing.
- Fix what Wave 1 surfaces before Wave 2. The most likely findings: folder-open
  confusion on first visit, key-setup drop-off, Chrome-only bounce.

### Wave 2 — main launch

- **Show HN** (the single most-aligned audience for this product) — title leads
  with the architecture, not the category: browser-only, no backend, files stay
  local. Post Tue–Thu, US morning. Be present for the first 3 hours; every
  top-level comment answered.
- **Product Hunt** within the same week (00:01 PT). PH wants polish: gallery
  reuses the BetaList cards + real screen recording.
- Second-tier launch platforms (Uneed, Peerlist, etc. per `launch-platforms.md`)
  staggered over the following two weeks — each is a small spike plus a backlink.
- BetaList feature lands per its own schedule (already paid/submitted) —
  coordinate so it doesn't collide with the PH day.
- PKM subreddits in the same window, with the community-specific framing (and
  each sub's self-promo rules from `launch-platforms.md` followed to the letter).

### Wave 3 — the second story: open-sourcing the agent runtime

Extract the agent loop (provider profiles/slots, tool loop, tool-spec machinery,
skills/MCP loading, approval hooks, subagent) into a standalone embeddable
package, then launch it as its own event ("a browser-side agent runtime — BYO
key, tools, approvals — embed with one line of JS").

- This is a dev-tools launch: Show HN again, r/programming, awesome lists that
  require OSS become available, JS ecosystem channels (npm, bundlephobia-bait).
- It back-links to localmd ("built for/extracted from") — top-of-funnel forever.
- Shared DNA with WebCLI (skills already open): one runtime, two surfaces —
  your files (localmd) and your browser (WebCLI). Cross-pollinate the repos.

### Wave 4 — first paid offering: credits

Business decision (made): managed model credits before sync.

- Position as **"zero-setup mode"**: the paid path removes the BYO-key wall;
  BYO key remains free forever and says so on the pricing page.
- Architecture: the app stays a static page; credits ride a thin metering proxy
  (separate, optional cloud service). The free path never touches it.
- Announce to existing users in-app (no accounts → no email list; an in-app
  changelog/announcement surface is the channel — worth building in Wave 2).
- The credits launch is also a story ("how we monetize a local-first app
  without touching your files") — good for a write-up and another HN thread.

### Ongoing — content cadence

- One use-case post every 1–2 weeks, alternating audience: "read a paper with
  citations", "turn a chat into permanent notes", "an agent inside your
  existing vault", 中文版发少数派/掘金.
- Every post ends at the same one-liner and URL. No new claims outside the
  message house without updating this doc.

## Channel matrix

Facts and sources in `launch-platforms.md`. Ordered by wave.

| Wave | Channel | Copy angle | Timing | Expected outcome |
|---|---|---|---|---|
| 1 | V2EX 分享创造 | 作品帖:做了什么、为什么纯浏览器、求反馈 | first | technical feedback, zh users |
| 1 | Indie Hackers | building-in-public story | with V2EX | maker feedback |
| 1 | Uneed (free line) | one-liner + GIF | join queue early (auto slot) | small spike + DR75 dofollow |
| 1 | AlternativeTo | listed as alternative to Obsidian/Notion AI | create account NOW (1-week age gate), submit after | durable category SEO |
| 1 | Fazier / Microlaunch / SaaSHub / LaunchingNext / StartupBase / TinyLaunch | same one-liner | 1–2/week drip | backlinks, trickle traffic |
| 2 | **Show HN** | architecture story: no backend, files local, git in browser | Tue–Thu, US morning; all Wave-1 fixes shipped | the launch |
| 2 | **Product Hunt** | polished: cards + demo video | same week as Show HN, 00:01 PT | directory permanence + spike |
| 2 | Peerlist Launchpad | builder-angle post | Monday window, week after PH | secondary spike |
| 2 | 少数派 | 长文:local-first 知识库的取舍与实现 | after Show HN (translate learnings) | zh long-tail |
| 2 | r/SideProject → r/PKMS | walkthrough, not ad (r/PKMS rule 3) | **gated on Reddit account recovery** | niche users |
| 2 | TAAFT (free-tool listing) | AI-tool angle | after main launch | AI-directory long tail |
| 3 | awesome-local-first (+ sibling lists) | PR: browser-based local-first AI KB | any time (no OSS gate; Bangle-io precedent) — batch with SDK launch for the story | credibility + backlink |
| 3 | Show HN #2 + r/programming + DevHunt | "embeddable browser agent runtime" | when SDK ships | dev-tools funnel |
| 3 | r/LocalLLaMA | fully-local stack (needs verified Ollama story + account recovery + 1/10 rule) | after SDK launch | local-AI niche |
| 4 | own channels + HN write-up | "monetizing local-first without touching your files" | credits beta | first revenue |

Standing constraints from verification:
- **Reddit is blocked**: the maker's account is permanently suspended. Either
  appeal or age a new account with genuine participation before any promo;
  never launch-post from a fresh account.
- **r/ObsidianMD is not a launch channel** (instant-ban rule for first-post
  promo); organic participation only.
- Futurepedia is pay-only ($247+) — skip.
- AlternativeTo's 1-week account-age gate → create the account in Wave 0.

## Measurement

- Per-channel UTM + the Wave-0 analytics choice; review weekly during launch
  months.
- Wave 1 success: ≥20 actionable feedback items, onboarding fixes shipped.
- Wave 2 success: a Show HN thread that stays alive past lunch, ≥1k unique
  visitors landing, and — the metric that matters — folder-opens (activation),
  not pageviews.
- Kill criterion for channels: two posts, zero activations → drop it.
