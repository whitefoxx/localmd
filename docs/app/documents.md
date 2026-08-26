---
title: PDFs, EPUBs and Word files
summary: How a document becomes readable and searchable, how answers link straight back to the exact passage they came from, and which other file formats open in the app.
---

# PDFs, EPUBs and Word files

You can keep PDFs, EPUBs and `.docx` files in your knowledge base and work with
them like anything else — but they need one preparation step first.

## Indexing

Ask the assistant to index a document, or open it and use the index action. It
reads the file once and writes a structured, searchable version alongside it (in
a hidden `.localmd/` folder).

This takes a moment for a long book. Afterwards:

- the assistant can search and quote it like any note
- you get a table of contents
- it never has to re-read the whole thing to answer a question, so it stays cheap

The index is rebuildable, so it is skipped when pushing to GitHub — no huge
repositories.

## When the app improves its indexing

The app's indexing gets better over time. When it has since you indexed a
document, nothing changes on its own: the existing index keeps working exactly
as it is, and a small **Update index** button appears in the document's viewer.
Rebuilding is always your choice — click it when you want the improvements, or
ignore it indefinitely.

Either way, **citations in your notes keep working**. A rebuild recognizes the
passages it already gave names to and keeps calling them by those names, so a
citation written last month still lands on the same paragraph after any number
of rebuilds. The one thing it cannot survive is the document itself being
replaced with different content — a citation into the old file's pages has
nothing to point at in the new one (the health check in `knowledge-base` flags
notes whose source moved on).

## Reading with nothing else on screen

The empty-square button in a PDF or EPUB toolbar is **zen mode** (⌘.). The file tree, the tabs, the assistant panel and the toolbar itself
step out, and the page takes the whole window.

Nothing is lost, only put away. Move the cursor towards the top of the screen
and the toolbar comes back — page numbers, search, highlighting, all of it —
and moves away again when you do. **Esc** leaves, and so does the same button.

## Citations that jump to the source

When the assistant answers from an indexed document, its citations are
**clickable and land on the exact passage** — not the document, the paragraph.

This is the part worth knowing about. If it tells you something surprising about
a 400-page book, you are one click from the sentence it came from — and often
you do not need the click: **rest the pointer on a citation** and it shows you
the passage it is citing, above the file it came from.

Citations survive reorganizing. Move a document to another folder and an old
citation still finds it — by name, or failing that by the cited passage itself.

The same applies across your knowledge base: references to your own pages become
links, and references to web pages become normal links, collected into a Sources
list under the answer.

## About made-up sources

The assistant will not cite a web page it did not actually open in that
chat. URLs reconstructed from memory look right and are frequently dead
or wrong, and passing one off as a source is worse than having no source.

If something comes from its general knowledge rather than a page it read, it
says so and gives no link. If it has no web access at all, it cannot cite
external pages — see `tools`.

## Everything else you can open

A knowledge base collects more than documents, and most of it opens right in
the tab:

- **Anything that is text** opens in the editor, whatever it is called — a
  configuration file, a script, a file with no extension at all. What decides
  is the content, not the name: a file only refuses to open when its bytes
  really are not text, or when it is far too large to hold in a browser tab.
- **Images** display, and **audio and video** play with the browser's own
  controls. Nothing is converted or uploaded — the file plays straight from
  your folder.
- **CSV and TSV** files show as a table, with the same Edit/Preview toggle as
  a note when you want the raw text.
- **Excel workbooks** (`.xlsx`) open read-only: every sheet, with values as
  the cells display them — including dates.
- **PowerPoint decks** (`.pptx`) open as an outline — each slide's title, text
  and pictures. The original slide layout is not reproduced, and the view says
  so.

Images, tables and decks are previews: you can read them, but the assistant
does not index or cite them the way it does PDFs, EPUBs and Word files. The old binary Office
formats (`.doc`, `.xls`, `.ppt`) predate what a browser can read — opening one
explains how to save it in the modern format instead.

## Related

Your folder: `knowledge-base`. Giving it web access: `tools`.
