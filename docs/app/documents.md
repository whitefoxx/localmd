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

## Scanned documents

Some PDFs are pictures of pages rather than text — anything that came off a
scanner or a photocopier, and most old papers. There is nothing in the file
for the index to read, so it comes back empty and the viewer says so: no
passages to quote, and the assistant cannot cite anything from it.

Everything else still works. You can read it, highlight it, annotate it and
have it read aloud, and notes you write about it are ordinary notes. What is
missing is only the part that needs machine-readable text.

### Reading the pictures

The notice offers a **Read the pictures** button, which recognises the text on
each page and builds the index from that. Pick the language the document is
written in — there is a combined option for a book in one language with terms
in another — and the button tells you how many pages that is and roughly how
long it will take. It is not fast: think seconds per page, so a long book is
most of an hour.

This happens on your machine, and the document never leaves the folder. The
first time you use a language, its alphabet is downloaded once and then kept
by the browser.

Cancelling throws the work away rather than keeping the pages it got to. A
book that was half read would produce an index that looks complete and quietly
covers a third of the pages — neither you nor the assistant would have any way
to tell.

Recognition is good, not perfect. Expect the occasional wrong character,
especially on a soft scan, and treat a quotation from a recognised page as
something to check against the page itself — which is exactly what clicking
the citation does.

## Turning a document into a note

A document sitting in your folder is material; a note about it is knowledge.
The app can tell the two apart: while no page in the knowledge base cites a
document, a small **Write a note** button appears in its viewer, beside the
index badge.

Clicking it does not write anything. It drafts a request to the assistant —
read this document, write a page about it, tag it, and declare it as a source
so citations into it work — and puts that draft in the chat box for you to
edit, send or discard. The detection is free; the writing costs tokens, so
there is a click in between.

The button disappears as soon as some page cites the document, which is why
"cites" and not "mentions" is the test: naming a file in passing claims
nothing, while a `[[pdf1:…]]` declaration is a page claiming to have read it.

## When the app improves its indexing

The app's indexing gets better over time. When it has since you indexed a
document, nothing changes on its own: the existing index keeps working exactly
as it is, and a small **Update index** button appears in the document's viewer.
Rebuilding is always your choice — click it when you want the improvements, or
ignore it indefinitely.

Either way, **citations in your notes keep working**. A rebuild recognizes the
passages it already gave names to and keeps calling them by those names, so a
citation written last month still lands on the same paragraph after any number
of rebuilds. What makes that possible is a record, kept beside the index, of
which passage each name belongs to. The one thing it cannot survive is the
document itself being replaced with different content — a citation into the old
file's pages has nothing to point at in the new one (the health check in
`knowledge-base` flags notes whose source moved on).

## Opening the same folder on another machine

The index lives in the hidden `.localmd/` folder, and that folder is left out of
git on purpose — so a knowledge base you clone onto another computer arrives
with your notes and without it. Opening a document there would normally index it
on the spot, and that build has no way of knowing which passage each existing
citation was written against. It would number the passages afresh: the citations
would all still open, and some would land on a different paragraph.

So it does not happen quietly. When your notes already cite a document and the
app cannot promise those citations will survive, **indexing stops** and the
viewer shows an **Indexing paused** button. Clicking it tells you how many
citations are at stake and lets you go ahead anyway. The assistant is held to
the same rule — it asks in the conversation and waits for your answer rather
than deciding for you.

To keep the citations exact, copy `.localmd/` across from the machine that built
the index before opening the document. It is an ordinary folder copy; nothing in
it is machine-specific.

If that machine is gone, going ahead is a perfectly reasonable choice — an index
you can search is worth more than citations you may never revisit. The pause
exists so that it is your call and not a surprise.

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
citation still finds it by name.

When a citation does not say which document it came from — some pages declare
their source, some leave it to the page they link to — the app looks the passage
up in the indexes instead. Passage numbers are counted within each document, so
several documents can hold the same one; when they do, **you are asked which**,
with the passage each candidate holds, rather than being sent to whichever
turned up first. And if the document a citation points at is no longer in the
folder, it says so instead of opening an empty tab: an index outlives the file
it was built from, which is why such a citation can still look live.

Declaring the source on the page itself — the `[[pdf1:…]]` line the assistant
writes when it files a document — is what makes all of this exact, so a page
that cites a book is worth having one.

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
