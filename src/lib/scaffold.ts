/**
 * First-run scaffolding: turn an empty folder into a working knowledge base
 * (the "LLM Wiki" layout) — raw/ intake dirs, a wiki index and log,
 * a tool-neutral AGENTS.md schema, and the starter skills.
 */
import * as fs from '@/lib/fs'

const AGENTS_MD = `# Knowledge base guide (AGENTS.md)

This is a personal knowledge base maintained by an LLM. Agents working here follow the conventions below.

## Purpose

<!-- What is this knowledge base FOR? One or two lines in your own words: the
     questions you want it to answer, what you are reading towards, what you do
     NOT care about. This is the one part an agent cannot read off the folder,
     and it is what decides which parts of a source are worth writing down.
     Leave it blank and the agent will not invent one. Delete the section if
     you would rather not have it. -->

## Structure

\`\`\`
raw/    ← Immutable source files (articles, books, images, data). Read-only, do not modify
raw/conversations/ ← Saved conversation records (type: chat), just plain md files (store them wherever you like). When harvesting, distill the conclusions from the discussion into the wiki
wiki/   ← Markdown pages maintained by the LLM. Link them to each other with [[wikilinks]]
wiki/index.md ← Entry page; every new page must be reachable from here
wiki/log.md ← Synthesis log: dated entries for what is NOT a page — contradictions between pages, claims still missing a source. Name the pages involved with [[wikilinks]]. Optional; delete it if you don't want one
.agents/skills/ ← Reusable workflows (SKILL.md)
MEMORY.md ← Persistent memory across sessions (user preferences, project state, important decisions). Optional: the user can write it themselves, or have the agent record/update it; never auto-summarize on your own
\`\`\`

## Rules

- raw/ is the source of truth: read it when you ingest, but only ever write to wiki/
- Each wiki page focuses on a single topic; prefer many small linked pages over one catch-all page
- Cite your sources: annotate conclusions drawn from a PDF/EPUB with a [[N:block-id]] reference
- Read the original file before changing it; keep edits minimal
- When two pages disagree, record it in wiki/log.md under a dated \`## YYYY-MM-DD\` heading rather than picking a winner — which side is right is the user's call
`

const INDEX_MD = `# Index

Welcome! This is the entry page for your knowledge base.

## Getting started

1. Drag an article / PDF / EPUB into the window, or paste a screenshot into the chat box — it's filed automatically under \`raw/\`
2. Tell the agent on the right \`/ingest\` and it will read the source files and generate wiki pages
3. Run \`/lint\` to check the health of the knowledge base

## Pages

(None yet — after ingesting, the agent will link new pages here)

## Log

[[log]] — what came up that isn't a page: disagreements between pages, claims still missing a source
`

const LOG_MD = `# Log

Dated entries for the things that are not a page of their own: two pages that
disagree, a claim still missing a source, a question left open. The agent adds
them as it works; you decide what to do about them.

Name the pages involved with [[wikilinks]] so an entry can be found from both
ends, and keep the \`## YYYY-MM-DD\` heading — that date is what lets a health
check tell you an entry is worth re-reading because its pages have moved on.

An empty log is the normal state of a new knowledge base. Delete this file if
you would rather not keep one.
`

const SKILL_INGEST = `---
name: ingest
description: Process not-yet-ingested source files under raw/, generate or update wiki pages, and link them into the index
---

# Ingest workflow

1. Find what is not yet processed: call kb_health and read \`unreferencedSources\` — the files no page mentions. Do not list raw/ and diff it by hand.
2. Read them one by one (index_document first for PDF/EPUB/DOCX, then the index's sections), creating or updating a wiki page for each source, following the conventions in AGENTS.md.
3. Link new pages into wiki/index.md with [[wikilinks]], and cite what you claim with [[pdfN:path]] + [[N:block-id]].
4. Report: what you processed, and what you skipped (and why).

This file is this KB's own copy — edit it and the app's built-in /ingest steps aside.
`

const SKILL_LINT = `---
name: lint
description: Check the health of the knowledge base — orphan pages, broken links, missing index entries, contradictory content
---

# Lint workflow

1. Walk every page under wiki/ and collect the [[wikilinks]].
2. Find: orphan pages (no inbound links), broken links (target doesn't exist), and pages missing from index.md.
3. Spot-check for contradictory content (the same fact stated differently across pages).
4. List all the problems first, then fix them; explain each fix as you make it.
`

const SKILL_HARVEST = `---
name: harvest
description: Distill a discussion — pull its conclusions, decisions, and ideas into wiki notes
---

# Harvest workflow

Subject: a discussion. This can be the **current conversation**, or any file the user @-mentions (for example a previously saved conversation file — just treat it as an ordinary file, no special handling needed).

1. Read through the material to be distilled and extract the conclusions, decisions, and ideas worth keeping — this is distillation, not a transcript of the conversation.
2. Merge into existing wiki pages by topic (preferred), creating a new page and linking it into the index only when necessary.
3. If the source is a file in the KB, add a [[link]] back to it in the notes you write, so it's easy to re-check later.
4. Report: what you distilled, where you wrote it, and what you skipped.

Finding nothing worth distilling is a perfectly normal outcome — just say so.
`

/* The two trees the app writes and the user never asked for. Offered here so a
 * brand-new KB is already clean the first time it is committed; an existing KB
 * gets the same line added lazily, on the first write into either (see
 * lib/gitignore.ts). Both are regenerable derivative data — indexes, oversized
 * tool results, composer attachments — and none of it belongs in a history. */
const GITIGNORE = `# Written by localmd: regenerable, not part of your knowledge base.
.trace/
.tmp/
`

const FILES: Array<[string, string]> = [
  ['.gitignore', GITIGNORE],
  ['AGENTS.md', AGENTS_MD],
  ['wiki/index.md', INDEX_MD],
  ['wiki/log.md', LOG_MD],
  ['.agents/skills/ingest/SKILL.md', SKILL_INGEST],
  ['.agents/skills/lint/SKILL.md', SKILL_LINT],
  ['.agents/skills/harvest/SKILL.md', SKILL_HARVEST],
  ['raw/articles/.gitkeep', ''],
  ['raw/books/.gitkeep', ''],
  ['raw/images/.gitkeep', ''],
  ['raw/papers/.gitkeep', ''],
]

/** Write the starter layout. Existing files are never overwritten. */
export async function scaffoldKb(): Promise<string[]> {
  const written: string[] = []
  for (const [path, content] of FILES) {
    if (await fs.exists(path)) continue
    await fs.writeFile(path, content)
    written.push(path)
  }
  return written
}
