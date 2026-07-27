---
title: PDFs, EPUBs and Word files
summary: How a document becomes readable and searchable, and how answers can link straight back to the exact passage they came from.
---

# PDFs, EPUBs and Word files

You can keep PDFs, EPUBs and `.docx` files in your knowledge base and work with
them like anything else — but they need one preparation step first.

## Indexing

Ask the assistant to index a document, or open it and use the index action. It
reads the file once and writes a structured, searchable version alongside it (in
a hidden `.trace/` folder).

This takes a moment for a long book. Afterwards:

- the assistant can search and quote it like any note
- you get a table of contents
- it never has to re-read the whole thing to answer a question, so it stays cheap

The index is rebuildable, so it is skipped when pushing to GitHub — no huge
repositories.

## Citations that jump to the source

When the assistant answers from an indexed document, its citations are
**clickable and land on the exact passage** — not the document, the paragraph.

This is the part worth knowing about. If it tells you something surprising about
a 400-page book, you are one click from the sentence it came from.

The same applies across your knowledge base: references to your own pages become
links, and references to web pages become normal links, collected into a Sources
list under the answer.

## About made-up sources

The assistant will not cite a web page it did not actually open in that
conversation. URLs reconstructed from memory look right and are frequently dead
or wrong, and passing one off as a source is worse than having no source.

If something comes from its general knowledge rather than a page it read, it
says so and gives no link. If it has no web access at all, it cannot cite
external pages — see `tools`.

## Related

Your folder: `knowledge-base`. Giving it web access: `tools`.
