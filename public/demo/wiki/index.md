# Demo knowledge base

You are looking at a real localmd knowledge base. It is a folder of Markdown
files and one PDF — except this one lives in memory, so you can try it without
choosing a folder or handing over a key. Close the tab and it is gone.

## Start here

- **[[chain-of-thought]]** — notes on a paper, with citations that jump into the
  PDF. Click a blue chip. That is the thing worth seeing.
- **[[prompting]]** — a second note, so the links and the graph have something
  to be about.

## Things to try

1. **Click a citation.** In [[chain-of-thought]], click any `[[1:b…]]` chip. The
   PDF opens at that paragraph, highlighted.
2. **Open the PDF directly.** `raw/papers/chain-of-thought-prompting.pdf` — 43
   pages, with a contents panel built from its own outline.
3. **Search.** Press `⌘K` and look for something. It searches file names and
   every word in the knowledge base.
4. **Look at the graph.** The icon bar on the left, third one down. Two notes and
   a source is a small graph, but it is the same one that handles a thousand.
5. **Check the health panel.** It finds broken links and orphan pages —
   a linter, deterministic, not another AI pass over your notes.
6. **Edit anything.** It is your copy. The editor autosaves to memory.

## What is missing here

An assistant that answers questions about all of this. That needs a model, and
a model needs a key — yours, going straight to your provider, with nothing in
between. See the panel on the right.

## When you want the real thing

Close this and open a folder of your own. Point it at somewhere that already
has files in it — a Zotero storage directory, a Calibre library, the pile of
PDFs in Downloads, a vault you already keep. It reads how you organize things
rather than imposing a layout, and it will not write anything without showing
you the diff first.
