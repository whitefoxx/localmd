# localmd

A pure-browser knowledge-base and AI-agent app. The user opens a URL,
configures an LLM key, and picks a local
folder; nothing leaves the device. This file is the shared glossary — the canonical
word for each domain concept, and the words to avoid.

## Knowledge base

**KB** (knowledge base):
The local folder the user opens and works in — the whole thing. There is one open KB
at a time.
_Avoid_: vault, workspace, library.

**raw/**:
The intake area inside a KB holding immutable source material — papers, books, images,
saved sessions. Content here is a *source*, not authored notes.
_Avoid_: sources/, inbox/.

**wiki/**:
The area inside a KB holding the authored, interlinked markdown notes the user and the
agent write and maintain. The authoring target.
_Avoid_: notes/, docs/.

**Wikilink**:
The `[[target]]` link syntax between notes. A property of the markdown, distinct from
the `wiki/` directory — do not let the shared word "wiki" blur them.
_Avoid_: internal link, backlink (a backlink is the reverse direction only).

**Log** (synthesis log):
`log.md` — the page holding dated entries for what is *not* a page of its own:
two notes that disagree, a claim still missing a source, a question left open. The
third page kind in the LLM Wiki pattern, after entity pages and concept overviews.
Structural, not content: `isEntryPage` keeps it out of the page-quality checks, and
its `## YYYY-MM-DD` headings are what lets `computeLint` say an entry's pages have
moved on since. Optional in every KB — a folder without one is not missing anything.
_Avoid_: journal, changelog, review queue (we deliberately did not build one — see
docs/llm-wiki-prior-art.md), inbox (that is the neutral landing dir, lib/capture).

## Sessions

**Session** (UI: "chat" / 对话):
One thread of messages between the user and the agent — live and persisted
(`ChatSession`). There can be several open at once. Two names on purpose:
`session` is the code term (types, stores, i18n keys), and every string a user
reads — UI and manual, both languages — says **chat** / 对话. The UI having
exactly one word for it is the point; "conversation" was the second word and is
retired.
_Avoid_: conversation, thread, transcript; "session" in anything user-facing.

**Saved session**:
A session exported to a markdown file under `raw/conversations/` — a *source* like any
other document, citable and distillable into `wiki/` notes. It is a saved session, not
a transcript.
_Avoid_: transcript, export, log. (The identifiers `save_transcript`, `renderTranscript`,
and `renderTranscriptFile` are legacy names for this and are rename candidates.)

**Tab**:
An open session in the UI (`OpenSession`) — session data plus its live running state.
Switching tabs never interrupts a running session. A tab *is* a session; the word only
names its open-in-the-UI aspect.
_Avoid_: window, pane.

## LLM configuration

**Profile**:
One credential set the user configures — provider, API key, base URL, model, max
tokens. A profile is *what* to call, not *when*.
_Avoid_: account, credential, config, endpoint.

**Slot**:
A job role a profile is assigned to: `primary` (the model the agent loop runs on),
`vision` (image understanding), or `image` (image generation). A profile is bound into
a slot; the same profile may fill more than one. "When" a profile is used.
_Avoid_: capability slot (fine in prose, but "slot" is canonical), channel, role.

## Documents, sources & citations

**Doc-index**:
The extracted structure of a single document (PDF/EPUB/DOCX/MD), stored under
`.localmd/<kind>-index/`. The PDF/EPUB on-disk formats are kept stable for the
KBs and citations that already exist. This is the per-document artifact —
never call it just "the index".
_Avoid_: bare "index", parse, extraction.

**Builder** (algorithm revision):
The `builder` field in a doc-index manifest — which revision of the indexing
algorithm produced it. Distinct from INDEX_VERSION (the read contract): an
older builder means "a rebuild would give you better output", never "this
index is unusable". Rebuilds are offered (the Update index badge), never
imposed.
_Avoid_: version (that word is taken by the read contract), stale (that is a
content-hash mismatch — the source bytes changed).

**Source**:
A document a note cites, declared in a note with `[[pdf1:raw/papers/x.pdf]]`. The digit
is the **source number** — the source's own identity within that note, assigned at
declaration. It is NOT the ordinal position of a citation — notes already on
disk depend on that reading, so do not reinterpret it.
_Avoid_: citation ordinal, reference number, footnote number.

**Block id**:
A location within a source, written `b<unit>-<n>` (e.g. `b14-3`) — the unit is
the page for PDF, the spine item for EPUB, the section for MD, and always 1
for DOCX. The ordinal is a NAME, not a position: once published, an id always
resolves to the same passage — rebuilds inherit ids (pdf/inherit.ts) rather
than renumber, so `<n>` may have gaps and need not follow reading order. An
inline citation `[[1:b14-3]]` points at block `b14-3` of source number 1.
_Avoid_: anchor, offset, position.

## Indexes (three unrelated things)

The word "index" is overloaded — always qualify it.

**KB index**:
The in-memory cache (the `kbIndex` store) of every note's text plus the wikilink graph
plus cached doc-index sections. KB-wide; rebuilt from disk.
_Avoid_: bare "index", cache.

(See also **Doc-index** above — per-document, on disk under `.localmd/`.)

**Git index**:
The isomorphic-git staging area. Only ever "git index", never bare "index".
_Avoid_: bare "index", stage.

Note: `wiki/index.md` is just a note that happens to be named "index" — the KB's home
page, unrelated to any index above.

## Tools

**Built-in tool**:
A tool defined natively in the agent code (`ToolSpec`) — read_file, write_file, etc.
The word says where the code lives, nothing else.
_Avoid_: capability, function, native tool. Never use it for catalog entries —
that is **bundled**.

**Bundled tool**:
A catalog entry that ships with the app and needs no setup (`bundled` flag +
`BUNDLED_TOOL_SOURCES` — a test keeps the two in lockstep). Today the web-search
pair (jina, parallel); the set is expected to grow. Bundled is a shipping fact
about an *external* tool — it does not make the tool built-in.
_Avoid_: built-in (reserved for native code), default, preset.

**Connection**:
The user-facing word for everything that reaches an outside service — the
localmd Connect extension, MCP servers, user- or agent-authored HTTP tools,
GitHub sync, sign-ins. What unites them is that each one is something the user
chose to reach, and what it can reach is whatever they gave it.
_Avoid_: integration, external services (as a category name).

**External tool**:
A tool provided by an MCP server, namespaced `mcp__<server>__<tool>`. "MCP tool" is an
acceptable synonym. Orthogonal to bundled/connection: parallel is external *and*
bundled.
_Avoid_: plugin, integration tool.

**Deferred tool**:
A tool registered but withheld from the model until `enable_tools` activates it,
at which point it becomes an **active tool**. Both registries share the frozen
prompt catalog and the activation/recall machinery but apply different policies:
MCP tools defer when their server is large (`DEFER_THRESHOLD`); installed HTTP
tools ALL defer — they are opt-in extensions, and only the bundled web pack
(baseline capability) is pinned active. The built-in/external distinction is
orthogonal to the deferred/active one.
_Avoid_: lazy tool, hidden tool.

**Tool row**:
One tool call as the transcript shows it. `presentCall` / `presentResult`
(lib/present) are the only place its **glyph**, **label**, **tone**
(running/failed/stopped/plain) and **outcome** are decided — pure over the
persisted part, so a reloaded session looks like a live one and the chat panel
and the markdown export cannot disagree. They say WHAT happened (`kind`), never
how to word it: the panel translates, the saved file stays English. Presentation
is UI-only — nothing here reaches the model.
_Avoid_: tool card (a **card** is a decision the user clicks — approval, setup),
describeCall as a place to add UI logic (it writes the label, nothing else).

## Skills

**Skill**:
A reusable instruction unit — a `SKILL.md` (name, description, body) under
`.agents/skills/<name>/`. Listed to the model by name+description; loaded in full on
demand (progressive disclosure).
_Avoid_: preset (that word names provider endpoints only, never skills), macro,
command.

**Slash command**:
Typing `/name` in the composer, which inlines that skill's full body into the message.
A way to invoke a skill, not a separate thing.
_Avoid_: command (bare), shortcut.
