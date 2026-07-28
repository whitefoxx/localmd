# Build log — story backlog

Post material harvested per the "Build in public" section of CLAUDE.md.
One entry per tellable story. Statuses: `backlog`, `drafted`, `posted <link>`.
Newest additions on top of each section. The initial batch below was mined
retroactively from the first 200 commits (2026-07-10 → 2026-07-28).

## Backlog

### The 18-day meta-story
- **Hook:** "18 days, 200 commits: an AI knowledge base that runs entirely in
  your browser. No backend — your files never leave your machine. The log:"
- **Substance:** phase-by-phase thread — day-1 skeleton→agent→viewers→PWA
  (`6141667`…`f4394f5`), then the arcs below as replies.
- **Media:** screenshot of `git log --oneline` scrolling; landing hero.
- **Channel:** X thread; 即刻 zh variant. Save for launch week (Wave 2 支援).
- **Status:** backlog

### GitHub sync with no backend
- **Hook:** "git smart-HTTP doesn't do CORS, so a browser can't `git push`.
  localmd syncs anyway: it mirrors git objects one-by-one over GitHub's REST
  Git Data API — sha-verified, fast-forward-only."
- **Substance:** `20586eb`, `396757d`; isomorphic-git for local status/commit,
  REST mirroring for remote; conflicts punt to the terminal on purpose.
- **Media:** small architecture diagram (browser ↔ .git ↔ REST API).
- **Channel:** X; strongest as a Show HN comment when asked "how does sync
  work?" — have it ready.
- **Status:** backlog

### The token-economy series (3–4 posts)
- **Hook:** "Your LLM request prefix is a cache key. Treating it that way cut
  localmd's per-turn cost dramatically. A series on token economy in a
  browser-only agent:"
- **Substance:** history trimming `d73c506`, auto-compaction `eb03ce1`, prompt
  caching `a9574f8`, deferred tool catalogs `7d04e6f` + self-heal `77a416f`,
  cache-aligned pipeline `b5b13d2`. Numbers from the usage tooltip; the full
  log already exists as `docs/token-optimization.md` — the blog post is 80%
  written.
- **Media:** usage-tooltip screenshots, before/after cache-hit share.
- **Channel:** blog/HN long-form + X thread per instalment.
- **Status:** backlog

### Click a citation, land on the paragraph
- **Hook:** "Ask about a paper, click the citation chip, land on the exact
  highlighted paragraph in the PDF. Block-level citations are localmd's
  favorite feature."
- **Substance:** `7e6c6af` (structured indexes, `[[1:b14-3]]` tokens),
  `aaf143b` (chips survive file moves); EPUB via CFI, Markdown via block ids.
- **Media:** **the** flagship GIF — record once, reuse everywhere.
- **Channel:** X, Reddit r/PKMS (post-account-recovery), PH gallery, demo video
  centerpiece.
- **Status:** backlog

### The agent survives a mid-stream reload
- **Hook:** "Closed the tab mid-answer? localmd's agent picks the conversation
  back up — partial stream persisted, user turn committed early."
- **Substance:** `3542a3e`; IndexedDB persistence choices.
- **Media:** GIF: kill the tab mid-stream, reopen, transcript intact.
- **Channel:** X.
- **Status:** backlog

### Stop must cancel the tool
- **Hook:** "'Stop' that only cancels the model stream is a lie — the tool
  call keeps mutating your files. Getting stop right in an agent took three
  commits and an AbortSignal audit."
- **Substance:** `36a2264` (untilAborted), `d7f9e82`, `56698a1`.
- **Media:** none needed; code-snippet screenshot works.
- **Channel:** X; resonates with agent-builder crowd.
- **Status:** backlog

### Read-aloud that follows along
- **Hook:** "localmd reads your PDFs and EPUBs aloud and highlights each
  sentence as it goes — including CJK, which doesn't split on spaces."
- **Substance:** the 07-20 TTS arc (`3d06187`…`ef653e1`, `2900375`): Web
  Speech API, sentence highlight-follow, per-language voices, China-resilient
  voice fallback, next-sentence preload.
- **Media:** GIF of follow-along in an EPUB.
- **Channel:** X; 少数派 zh long-form angle (中文语音阅读细节).
- **Status:** backlog

### Tools are data, not code
- **Hook:** "In localmd, a new integration isn't a release — it's a
  conversation. Tool *code* provides capability; individual tools are data the
  agent (or you) authors on top."
- **Substance:** `3826664`, `6a95aa1`, `260252a`, `5ee901a`; the CLAUDE.md
  principle text is already the essay outline.
- **Media:** screenshot of the agent authoring a tool from a prompt.
- **Channel:** X thread / short blog essay; strong HN comment material.
- **Status:** backlog

### The manual the agent reads
- **Hook:** "localmd's Help panel and its AI agent read the same markdown
  files. One source, so the app can never disagree with itself about how it
  works — and a test fails if a translation falls behind."
- **Substance:** `cc9a714`, `af20693`, `1ed7087`.
- **Media:** side-by-side: Help panel vs agent answering the same question.
- **Channel:** X.
- **Status:** backlog

### Making pdf.js run where it shouldn't
- **Hook:** "Your bundler targets modern browsers. Your user's Chrome 109
  disagrees. A story about shimming pdf.js built-ins until PDF indexing worked
  on real, old machines."
- **Substance:** `e1f2612`, `8ea8350`, `d275df7` (also: stopping EmbedPDF
  phoning home before first paint — a privacy detail worth its own line).
- **Media:** none; war-story text carries it.
- **Channel:** X.
- **Status:** backlog

### One tool loop, every provider
- **Hook:** "Anthropic, OpenAI, DeepSeek, Gemini, xAI, Groq — one streamText
  tool loop, each on its own key hitting its own endpoint. The Vercel AI SDK
  made BYO-key multi-provider boring (good)."
- **Substance:** `638b7f2`; CORS as the real constraint; vision slot for
  text-only mains (`20d4603`).
- **Media:** settings screenshot of provider profiles + slots.
- **Channel:** X.
- **Status:** backlog

### The wikilink logo
- **Hook:** "localmd's logo is `[·]` — a wikilink around a dot: your knowledge,
  linked, in one place. Rebranding a repo called browser-md."
- **Substance:** `76b7735`, `9424d0b`; name story (localmd = local + markdown).
- **Media:** logo + wordmark card (already made for OG image).
- **Channel:** X; light-weight identity post for launch week.
- **Status:** backlog

## Posted

(nothing yet — that's the point of this file)
