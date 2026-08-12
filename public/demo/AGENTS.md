# About this knowledge base

This is the localmd demo — a small, real knowledge base you can poke at without
choosing a folder of your own. It lives in memory: nothing here is written to
your disk, and closing the tab throws it away.

Everything you see is what a real one looks like. Plain Markdown, a PDF that is
actually here, and citations that actually resolve.

## Structure

```
raw/           Source material. Immutable — read it, don't rewrite it.
  papers/      PDFs and EPUBs, plus SOURCES.md recording where each came from.
  conversations/  Sessions worth keeping, saved as Markdown.
wiki/          The notes. Interlinked with [[wikilinks]].
  index.md     The home page. Every note should be reachable from here.
.trace/        Document indexes. Generated, not authored — leave it alone.
```

## Conventions

- New source material lands in `raw/`; writing happens in `wiki/`.
- One topic per note. Prefer more small linked notes over one long page.
- A claim taken from a source carries a citation: `[[1:b12-4]]` points at a
  block of source 1, declared earlier in the page as `[[pdf1:raw/papers/…]]`.
- Read a file before editing it, and keep edits small.

## If you are the agent reading this

The user is trying localmd for the first time. Be concrete, cite what you
claim, and keep answers short enough to read in one screen. When you are asked
about the paper, use the document index rather than re-reading the whole PDF —
`.trace/pdf-index/` already has it broken into citeable blocks.
