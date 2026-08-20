---
title: Your folder and how it is organized
summary: The knowledge base is a plain folder you own; the suggested layout is only a suggestion, AGENTS.md records how yours works, and nothing is ever enforced.
---

# Your folder and how it is organized

Your knowledge base is a folder of markdown files. That is the whole format.
You can open it in any editor, sync it with anything, and rearrange it however
you like — including while the app is open.

## Your structure wins

For a brand-new empty folder, the app offers a starting layout:

- **`raw/`** — material you captured: papers, articles, images, books, saved
  conversations
- **`wiki/`** — pages you wrote

That is a suggestion for people who want one, not a rule. **If you open a folder
that is already organized, the app leaves it alone** and the assistant files new
things according to *your* structure — matching your folder names and your
naming style.

Drop a file onto the workspace and it is filed under `raw/` by kind. If the
folder has no `raw/`, it lands in `inbox/` instead — a doormat, not a home.

Filing is not reading, though. After a drop, a line appears above the message
box — *3 filed, not read yet* — with a button that starts the reading and an ×
that means not now. Nothing happens until you pick one, and dismissing it costs
you nothing: the material is filed either way, and the assistant can still find
it whenever you come back to it.

That is deliberate. Reading a stack of sources spends model time and writes new
pages into your folder, and neither is something to start because a file
touched the window. You can also type **`/ingest`** whenever you like. Either
way the assistant picks up everything you have added that no page mentions yet,
reads each source (indexing PDFs and EPUBs as it goes), writes it into your
pages, and tells you what it did and what it left behind. It never changes the
sources themselves, and running it again only picks up what is new.

Attachments are a different gesture. A screenshot you paste into the chat box,
or a file you attach there, is something you are *handing to* the assistant
rather than something you are filing — so it goes to a scratch folder called
`.tmp`. That folder stays out of the file tree, out of search and out of git,
and its contents may be cleared away. Click an attachment to open it in the
file view like anything else; if one turns out to be worth keeping, ask the
assistant to move it somewhere real.

## Telling the assistant how your folder works

A file called **`AGENTS.md`** in the folder root describes your conventions —
what goes where, how you name things, anything it should know. The assistant
reads it every session.

You do not have to write it. Ask the assistant to look at your folder and write
one, and it will describe what you *actually* have rather than prescribing
anything.

## Nothing is enforced

Every convention here — layout, page structure, linking — is a suggestion the
assistant follows and suggests. None of it is a rule that can reject a file.
Hand-edit, move things, delete things. Nothing will break or nag.

## Linking pages

Write `[[page name]]` to link to another page — the name without `.md`. Links
are what stop a page becoming an island, and they power the graph view.

Pages can also carry a `type:` at the top (`concept`, `source`, `person`, …) if
you find that useful. It is free-form; there is no fixed list.

## The log — what is not a page

Some of what comes out of reading is not a page. Two notes end up disagreeing.
A number sits there with no source behind it. A question stays open.

Those go in **`log.md`**, as dated entries naming the pages involved:

```
## 2026-03-01 — [[chain-of-thought]] and [[prompting]] disagree on the threshold
One says 10B parameters, the other 100B. Unresolved.
```

The assistant offers to write one when a scan turns something up, instead of
mentioning it once in a conversation you will close. It will not quietly edit
one of the pages to make the disagreement go away — which side is right is
yours to say.

A new folder gets a log with nothing in it, which is the normal state of a new
knowledge base; delete the file if you would rather not keep one, and nothing
will put it back. In a folder that already has its own way of doing this, the
assistant follows that instead.

The date earns its keep: the health check below can tell you an entry is worth
re-reading because the pages it names have been edited since you wrote it. It
never decides an entry is settled — only that something moved under it.

## Checking the health of your knowledge base

The **pulse icon** in the left bar shows the two things worth clicking on:
links pointing at a page that does not exist, and pages nothing links to.

Ask the assistant for a health check and it runs the same pass in full. On top
of those two it reports pages that are nearly empty, pages you cannot reach by
navigating from the index, pages with no frontmatter, files you have added that
no page has ever mentioned, citations pointing at a document that is no longer
there, pages you wrote before a document they cite was last changed, log entries
whose pages have been edited since, and tags that are the same word spelled two
ways (`machine-learning` and `Machine Learning`).

That last one is worth a word of caution, because it compares timestamps rather
than meaning: a file that was only re-saved, re-downloaded by a sync client, or
freshly checked out looks exactly like one that was rewritten. Read the page
against the document before changing anything — and never let the assistant
rewrite a page from memory to make the warning go away.

All of it is fast, free, and does not involve reading a single page — so it is
also honest about its limits. It is a list of things you might want to look at,
not a list of mistakes: an unread PDF you are saving for next month and two
spellings of a tag are your business, and nothing here is changed for you.
Deeper questions — "do any of these pages contradict each other?" — do need the
assistant to read your content, so ask for those directly and it will suggest a
scope rather than reading everything.

## Related

Getting set up: `getting-started`. How the assistant works with your files:
`working-with-the-agent`. Version history: `git-and-github`.
