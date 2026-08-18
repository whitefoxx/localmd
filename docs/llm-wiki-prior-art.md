# LLM Wiki prior art — what the other implementations did, and what we take

> 2026-08-17. localmd started from Karpathy's LLM Wiki gist. So did two other
> projects, independently, within days of it. This is a survey of what they
> built on the same spec, which of it we adopted, and — more usefully — which
> of it we looked at and deliberately did not.
>
> Status legend: ✅ shipped · ⏸ deferred with reasoning · ✗ decided against.
> An entry here is a record of a decision at a point in time, not a claim about
> current behaviour. When a later pass overturns one, mark it superseded and
> link forward rather than deleting it.

## The three forks

All three implement the same three layers (immutable `raw/`, LLM-owned `wiki/`,
a schema document) and the same three operations (ingest, query, lint).

| | nashsu/llm_wiki | nvk/llm-wiki | localmd |
|---|---|---|---|
| Form | Tauri desktop app (Rust + React) | Claude Code / Codex plugin + `AGENTS.md` | Browser, no backend |
| Scale at survey time | 16.4k stars, created 2026-04-08 | 1.0k stars, created 2026-04-04 | — |
| The bet | An automation pipeline: ingest queue, graph analysis, review queue, vector search | A specification: the pattern frozen into 19 numbered lint rules | Open the user's own folder, leave its shape alone |
| Stance on the user's layout | Grafts its own | `mv`s files to their "correct" path | The user's structure wins |

The distribution numbers say the pattern has a real audience, and that a
desktop app is what captured it. Our differentiator is not "also an LLM wiki";
it is that neither of the others can open an arbitrary existing folder without
either installing something or reorganising it.

## Adopted

### ✅ `raw` → `wiki` coverage (nvk C6) — "sources no page mentions"

Their insight: the link graph has two directions, and we were only checking
one. A source nobody has cited is a compilation backlog, and it is fully
determinable without reading anything.

Shipped in `computeLint` as `unreferencedSources`. Two deliberate differences
from theirs:

- **Definition is layout-neutral.** Theirs checks `raw/` against article
  `sources:` frontmatter, which presumes their layout. Ours asks "is this a
  non-markdown file that no page anywhere mentions", so it works on a KB with
  no `raw/` at all. Dot-directories (`.trace/`, `.agents/`, `.obsidian/`) are
  excluded as plumbing; markdown is excluded because the orphan checks own it.
- **Match on filename, not on resolved links.** Wikilinks, markdown links,
  image embeds and `[[pdfN:…]]` declarations all reference files differently,
  and `parseMarkdownLinks` deliberately drops non-page assets to keep the graph
  page-to-page. Rather than teach lint every reference form, a source counts as
  read when any page's text contains its filename (percent-encoded form
  included). Generous on purpose: the finding is "nothing in this KB has ever
  named this file", which is worth acting on *because* it cannot be a false
  alarm.
- **No auto-fix.** Theirs offers to write a `uncompiled-source-coverage.md`
  backlog page. We report and stop — an unread PDF is a legitimate state.

### ✅ Dangling source provenance (nvk C4b) — `danglingCitations`

`[[pdfN:path]]` declarations were previously invisible to lint: `isCitationToken`
makes the KB index skip them so they don't count as broken wikilinks, and
nothing checked them afterwards. Now resolved through `resolveCitePath`, which
already accepts a unique-basename match — so moving a file (the user's right)
does not light up every page citing it, and only a path that cannot be placed
at all is reported.

### ✅ Tag hygiene (nvk C5) — `similarTags`

Shape-only: tags collapse to one key when they differ by case, separators, or
an ASCII plural. nvk's rule also wants `ml` ≡ `machine-learning`, which needs
semantics; a lint that guesses at meaning starts nagging about things that are
fine. Variants are reported most-used-first so the majority spelling is
obvious, and nothing is rewritten.

## Deferred

### ⏸ Volatility and a freshness score (nvk C14/C15, `wiki-structure.md`)

Pages carry `volatility: hot|warm|cold` plus a `verified:` date; freshness is a
0–100 composite of source age, verification recency, compilation recency and
source-chain integrity, with the decay curve scaled by tier and the threshold
configurable per wiki. Their best call here is refusing to auto-fix it:
recompiling a stale article replaces stale content with hallucinated content.

Deferred because the composite score is more machinery than the signal
justifies at our scale, and because it needs a frontmatter convention we do not
currently ask for. If we revisit, the minimal honest version is two
deterministic facts, not a score: *this page cites sources that no longer
exist* (already shipped as `danglingCitations`), and *this page is older than
the sources it cites*. Both are computable from mtimes and the existing graph.

### ⏸ On-disk `_index.md` navigation layer + derived-index protocol (nvk)

Per-directory index files with a 3-hop read strategy (master index → category
index → matched articles), where indexes are explicitly a **cache, not a source
of truth**: before trusting one, compare the file count to its row count and
rebuild inline when they differ. That gives a lock-free concurrency model —
two writers converge because both rebuild from the same files on disk.

The protocol is good and the staleness rule is the sort of thing we already
believe (cf. "Release the lock last"). The reason to defer is product, not
technical: writing bookkeeping files into the user's folder is exactly what
"the user's structure wins" forbids. The defensible version is asymmetric —
**maintain an `index.md` that already exists; never create one.** Note our
`kbIndex` already provides the token-saving benefit in memory, so what we would
be buying is legibility to *other* tools (Obsidian, another agent), not agent
efficiency.

### ⏸ Self-clearing review queue (nashsu `sweep-reviews.ts`)

Their ingest never blocks on human judgement: contradictions and suggestions go
into a queue. When the ingest queue drains, a sweep pass runs — first rule
matching (filename / frontmatter title / affected pages), then one LLM semantic
judgement on what's left — and closes items whose underlying condition a later
ingest already addressed, conservatively preserving the types that genuinely
need a human.

This is the strongest single idea in either project: every review queue dies of
accumulation, and they made the backlog clear itself. Deferred because we have
no knowledge-level queue to attach it to (our `ReviewPanel` is a file-diff
review — a different thing that can coexist). If we ever build one, it ships
with the sweep, not after it.

### ⏸ Two-step ingest (nashsu)

Split ingest into two LLM calls: analysis (entities, concepts, contradictions,
proposed structure) then generation from that analysis. They report better
output than a single pass. Cheap to try in the `ingest` skill; the cost is a
second round-trip per source, which interacts with our token economy and should
be measured rather than assumed.

### ⏸ Graph as an entry point, not a picture (nashsu)

Four-signal relevance (direct links, source overlap, Adamic–Adar, type
affinity), Louvain community detection with cohesion scoring, and "surprising
connection / knowledge gap → research this" actions off the result. Our
`GraphView` stops at rendering the link graph. Note they run the analysis in a
worker; on our single-threaded browser main loop that is not optional.

### ⏸ Separating "what this KB is for" from "how it is arranged"

nashsu adds `purpose.md` (goals and research scope, consulted during ingest and
query); nvk adds `schema.md`, explicitly a *topic guide* rather than a database
schema, with adoption states (`missing` → `proposed` → `advisory` → `strict`)
so an older wiki without one is valid rather than broken. Our `AGENTS.md` does
both jobs. Worth separating because intent is the one part of this a user
actually wants to write themselves — but it is another file in their folder,
so it must be offered, never scaffolded in.

## Decided against

### ✗ Dual-link convention (nvk)

Every cross-reference written twice on one line:
`[[slug|Name]] ([Name](../category/slug.md))` — the wikilink for Obsidian's
graph, the markdown link for the agent. This is one fact in two places, which
is the thing our own conventions exist to prevent, and it is unnecessary here:
`kbIndex` already resolves both forms. Recording it because the reasoning
("Obsidian needs one, agents need the other") is superficially convincing.

### ✗ Automatic canonical placement and quarantine (nvk C11/C12)

A file's correct path is derived from its frontmatter, and `lint --fix` will
`mv` it there; files not on the per-location allowlist are moved to
`inbox/.unknown/` for triage. Directly contradicts "the KB is a soft
constraint" and "the user's structure wins". The transferable part is the
allowlist as a *report* — "these files are not where your own AGENTS.md says
they go" — with no `mv` attached, and even that only makes sense for a KB whose
AGENTS.md states a layout.

### ✗ Hub / topics registry (nvk)

A `~/wiki` hub holding `wikis.json` plus `topics/<name>/` sub-wikis, with
cross-wiki index peeking and an archive lifecycle. One KB at a time is our
deliberate model, not a missing feature.

### ✗ Local HTTP API + MCP server exposing the KB (nashsu)

The stated benefit is letting external tools query the wiki. It is worth being
precise about how small the gap actually is: a KB is a local folder, so any
coding agent already reads it by being pointed at the directory — no server
required. What a server would add is narrower than it sounds (querying from
*another* directory, and reusing the app's parsed artifacts — doc indexes,
embeddings — instead of re-deriving them). Not a reason to acquire a backend.

## Sources

- Karpathy, *LLM Wiki* — <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>
- nvk/llm-wiki — <https://github.com/nvk/llm-wiki> · <https://llm-wiki.net/>
- nashsu/llm_wiki — <https://github.com/nashsu/llm_wiki>
