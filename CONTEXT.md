# browser-md

A pure-browser knowledge-base and AI-agent app: a browser rewrite of the trace-app
Electron application. The user opens a URL, configures an LLM key, and picks a local
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

## Sessions

**Session** (会话):
One thread of messages between the user and the agent — live and persisted
(`ChatSession`). The unit of conversation. There can be several open at once.
_Avoid_: conversation, chat, thread, transcript.

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
`.trace/<kind>-index/`. The PDF/EPUB layouts are byte-compatible with trace-app;
`docx-index` is ours (trace-app has none). This is the per-document artifact —
never call it just "the index".
_Avoid_: bare "index", parse, extraction.

**Source**:
A document a note cites, declared in a note with `[[pdf1:raw/papers/x.pdf]]`. The digit
is the **source number** — the source's own identity within that note, assigned at
declaration. It is NOT the ordinal position of a citation. (trace-app semantics — do
not reinterpret.)
_Avoid_: citation ordinal, reference number, footnote number.

**Block id**:
A location within a source, written `b<section>-<block>` (e.g. `b14-3`). An inline
citation `[[1:b14-3]]` points at block `b14-3` of source number 1.
_Avoid_: anchor, offset, position.

## Indexes (three unrelated things)

The word "index" is overloaded — always qualify it.

**KB index**:
The in-memory cache (the `kbIndex` store) of every note's text plus the wikilink graph
plus cached doc-index sections. KB-wide; rebuilt from disk.
_Avoid_: bare "index", cache.

(See also **Doc-index** above — per-document, on disk under `.trace/`.)

**Git index**:
The isomorphic-git staging area. Only ever "git index", never bare "index".
_Avoid_: bare "index", stage.

Note: `wiki/index.md` is just a note that happens to be named "index" — the KB's home
page, unrelated to any index above.

## Tools

**Built-in tool**:
A tool defined natively in the agent code (`ToolSpec`) — read_file, write_file, etc.
_Avoid_: capability, function, native tool.

**External tool**:
A tool provided by an MCP server, namespaced `mcp__<server>__<tool>`. "MCP tool" is an
acceptable synonym.
_Avoid_: plugin, integration tool.

**Deferred tool**:
An external tool from a large server that is registered but withheld from the model
until `enable_tools` activates it — at which point it becomes an **active tool**. The
built-in/external distinction is orthogonal to the deferred/active one.
_Avoid_: lazy tool, hidden tool.

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
