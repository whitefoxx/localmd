# Backlog — story material

Not yet drafted. When a draft is written, the entry's content moves into
`drafts/` and the entry is deleted here. Commit hashes are the substance —
`git show <hash>` for the details.

### GitHub sync with no backend
- **Hook:** "git smart-HTTP doesn't do CORS, so a browser can't `git push`.
  localmd syncs anyway: it mirrors git objects one-by-one over GitHub's REST
  Git Data API — sha-verified, fast-forward-only."
- **Substance:** `20586eb`, `396757d`; isomorphic-git for local status/commit,
  REST mirroring for remote; conflicts punt to the terminal on purpose.
- **Media:** small architecture diagram (browser ↔ .git ↔ REST API).
- **Channel:** X; also the ready answer for "how does sync work?" on Show HN.

### The token-economy series (3–4 posts)
- **Hook:** "Your LLM request prefix is a cache key. Treating it that way cut
  localmd's per-turn cost dramatically."
- **Substance:** trimming `d73c506`, compaction `eb03ce1`, prompt caching
  `a9574f8`, deferred tools `7d04e6f` + self-heal `77a416f`, cache-aligned
  pipeline `b5b13d2`. `docs/token-optimization.md` is 80% of the blog post.
- **Media:** usage-tooltip screenshots, before/after cache-hit share.
- **Channel:** blog/HN long-form + X thread per instalment.

### Click a citation, land on the paragraph  *(scheduled 2026-08-02)*
- **Hook:** "Ask about a paper, click the citation chip, land on the exact
  highlighted paragraph in the PDF."
- **Substance:** `7e6c6af` (structured indexes, `[[1:b14-3]]` tokens),
  `aaf143b` (chips survive file moves); EPUB via CFI, Markdown via block ids.
- **Media:** **the** flagship GIF — record once, reuse everywhere (X, PH
  gallery, Reddit, 少数派, landing, BetaList gallery refresh).
- **Channel:** X first, then everywhere.

### The agent survives a mid-stream reload  *(scheduled 2026-08-01)*
- **Hook:** "Closed the tab mid-answer? localmd's agent picks the conversation
  back up — partial stream persisted, user turn committed early."
- **Substance:** `3542a3e`; IndexedDB persistence choices.
- **Media:** GIF: kill the tab mid-stream, reopen, transcript intact.
- **Channel:** X.

### Stop must cancel the tool  *(scheduled 2026-07-30)*
- **Hook:** "'Stop' that only cancels the model stream is a lie — the tool
  call keeps mutating your files. Getting stop right took an AbortSignal
  audit."
- **Substance:** `36a2264` (untilAborted), `d7f9e82`, `56698a1`.
- **Media:** code-snippet screenshot.
- **Channel:** X.

### Read-aloud that follows along
- **Hook:** "localmd reads your PDFs and EPUBs aloud and highlights each
  sentence as it goes — including CJK, which doesn't split on spaces."
- **Substance:** the 07-20 TTS arc (`3d06187`…`ef653e1`, `2900375`).
- **Media:** GIF of follow-along in an EPUB.
- **Channel:** X; 少数派 zh angle.

### Tools are data, not code
- **Hook:** "In localmd, a new integration isn't a release — it's a
  conversation. Tool *code* provides capability; individual tools are data."
- **Substance:** `3826664`, `6a95aa1`, `260252a`, `5ee901a`; CLAUDE.md
  principle text is the outline.
- **Media:** screenshot of the agent authoring a tool from a prompt.
- **Channel:** X thread / short essay.

### The manual the agent reads
- **Hook:** "localmd's Help panel and its AI agent read the same markdown
  files — the app can never disagree with itself. A test fails if a
  translation falls behind."
- **Substance:** `cc9a714`, `af20693`, `1ed7087`.
- **Media:** side-by-side screenshot.
- **Channel:** X.

### Making pdf.js run where it shouldn't  *(scheduled 2026-07-31)*
- **Hook:** "Your bundler targets modern browsers. Your user's Chrome 109
  disagrees. Shimming pdf.js built-ins until indexing worked on real old
  machines."
- **Substance:** `e1f2612`, `8ea8350`, `d275df7` (incl. stopping EmbedPDF
  phoning out before first paint — privacy detail worth a line).
- **Media:** none needed.
- **Channel:** X.

### One tool loop, every provider
- **Hook:** "Anthropic, OpenAI, DeepSeek, Gemini, xAI, Groq — one streamText
  tool loop, each on its own key hitting its own endpoint."
- **Substance:** `638b7f2`; CORS as the real constraint; vision slot
  (`20d4603`).
- **Media:** settings screenshot.
- **Channel:** X.

### The wikilink logo
- **Hook:** "localmd's logo is `[·]` — a wikilink around a dot: your
  knowledge, linked, in one place."
- **Substance:** `76b7735`, `9424d0b`; name story (local + markdown).
- **Media:** logo card (og.png).
- **Channel:** X.

### The 18-day meta-story  **(RESERVED — Wave 2 only)**
- **Hook:** "18 days, 200 commits: an AI knowledge base that runs entirely in
  your browser. No backend. The log:"
- **Substance:** phase thread (`6141667`…`f4394f5`) + the arcs above as
  replies. **Do not spend early** — it converts best with a launch to land on.
- **Media:** git log screenshot; landing hero.
- **Channel:** X thread, Show HN week. zh 版不用等：少数派回顾长文可先发。
