/**
 * First-run scaffolding: turn an empty folder into a working knowledge base
 * (the trace-app "LLM Wiki" layout) — raw/ intake dirs, a wiki index,
 * a tool-neutral AGENTS.md schema, and the two starter skills.
 */
import * as fs from '@/lib/fs'

const AGENTS_MD = `# Knowledge base guide (AGENTS.md)

This is a personal knowledge base maintained by an LLM. Agents working here follow the conventions below.

## Structure

\`\`\`
raw/    ← Immutable source files (articles, books, images, data). Read-only, do not modify
raw/conversations/ ← Saved conversation records (type: chat), just plain md files (store them wherever you like). When harvesting, distill the conclusions from the discussion into the wiki
wiki/   ← Markdown pages maintained by the LLM. Link them to each other with [[wikilinks]]
wiki/index.md ← Entry page; every new page must be reachable from here
.agents/skills/ ← Reusable workflows (SKILL.md)
MEMORY.md ← Persistent memory across sessions (user preferences, project state, important decisions). Optional: the user can write it themselves, or have the agent record/update it; never auto-summarize on your own
\`\`\`

## Rules

- raw/ is the source of truth: read it when you ingest, but only ever write to wiki/
- Each wiki page focuses on a single topic; prefer many small linked pages over one catch-all page
- Cite your sources: annotate conclusions drawn from a PDF/EPUB with a [[N:block-id]] reference
- Read the original file before changing it; keep edits minimal
`

const INDEX_MD = `# Index

Welcome! This is the entry page for your knowledge base.

## Getting started

1. Drag an article / PDF / EPUB into the window, or paste a screenshot into the chat box — it's filed automatically under \`raw/\`
2. Tell the agent on the right \`/ingest\` and it will read the source files and generate wiki pages
3. Run \`/lint\` to check the health of the knowledge base

## Pages

(None yet — after ingesting, the agent will link new pages here)
`

const SKILL_INGEST = `---
name: ingest
description: Process not-yet-ingested source files under raw/, generate or update wiki pages, and link them into the index
---

# Ingest workflow

1. List the source files under raw/ and compare against wiki/ to find the ones not yet processed.
2. Read them one by one (use the index for PDF/EPUB), creating or updating a wiki page for each source, following the conventions in AGENTS.md.
3. Link new pages into wiki/index.md with [[wikilinks]].
4. Report: what you processed, and what you skipped (and why).
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
