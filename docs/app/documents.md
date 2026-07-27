---
title: PDFs, EPUBs and DOCX — indexing and citations
summary: How documents become readable structured indexes under .trace/, and the block-id citation form that makes an answer jump to the exact passage.
---

# PDFs, EPUBs and DOCX — indexing and citations

## Why there is an index step

A PDF is not readable as markdown, and feeding a whole book into a turn is not
affordable. So a document is converted once into a structured index of markdown
under `.trace/`, and then read like any other KB content — a table of contents,
sections, and search across them.

Call `index_document` on the source path when no index exists. Afterwards:

1. read the index's `_README.md` — it states the conventions for that index
2. read `toc.md` to find the relevant part
3. read the relevant `sections/*.md` (`list_files` / `search_files` take a `dir`
   parameter to scope to the index)

Indexes live under `.trace/` in the KB folder, so they travel with it, but they
are excluded from git pushes through the app — they are rebuildable.

## Citations

Every block in an index carries a `[[block-id]]` tag. When answering from an
indexed source:

- declare the source once at the top: `[[pdf1:path]]` (or `epub`/`docx`/`md`)
- cite claims inline as `[[1:block-id]]`

The chat renders these as clickable links that jump to the exact passage. The
index's `_README.md` carries the full rule.

## Citation forms in general

The app has no footnote system. Only these forms exist, and inventing others
produces broken links:

- a KB file → a `[[wikilink]]`
- a web page → a normal `[title](https://…)` link
- an indexed document → the `[[pdfN:path]]` + `[[N:block-id]]` pair above

Never emit `[^1]`, a bare `[1]`, or `[text](#source-1)` — there are no such
anchors, so `#source-N` points nowhere. The chat turns real references into
numbered superscripts with a Sources list, so link the actual source rather than
only naming it.

## Never fabricate a source

A cited `https://` URL must be one actually opened or fetched **this session**
with the browser tools. URLs reconstructed from memory are routinely moved,
changed or dead even when they look right, and presenting one as a source is a
fabrication.

If a claim rests on general knowledge rather than a fetched page, say so plainly
and give no link. If the browser tools are not connected, external URLs cannot
be cited at all.

## Compatibility note

The index format is byte-compatible with trace-app: the `.trace/*-index/`
layout, and the index versions, are a hard constraint rather than an internal
detail.

## Related

Reaching the web at all: `tools`.
