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
  chats
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
reads it at the start of every chat.

You do not have to write it. Ask the assistant to look at your folder and write
one, and it will describe what you *actually* have rather than prescribing
anything.

There is one part it cannot write for you, and it is worth two lines of your
own: **what this knowledge base is for.** The questions you want it to answer,
what you are reading towards, what you do not care about. A folder tells the
assistant where a page goes; only you can say which parts of a paper are worth
keeping — the same paper read for its method and read for its results makes
different notes. A new folder's `AGENTS.md` has an empty **Purpose** section
waiting for that. Leave it blank and nothing is invented in its place.

## Nothing is enforced

Every convention here — layout, page structure, linking — is a suggestion the
assistant follows and suggests. None of it is a rule that can reject a file.
Hand-edit, move things, delete things. Nothing will break or nag.

## Linking pages

Write `[[page name]]` to link to another page — the name without `.md`. Links
are what stop a page becoming an island, and they power the graph view.

Pages can also carry a `type:` at the top (`concept`, `source`, `person`, …) if
you find that useful. It is free-form; there is no fixed list. The same goes
for `tags:`.

## The graph

The graph view draws every page as a dot and every link between them as a line.
It is a picture of what you have connected — and the place an island is obvious.

Click a dot and the graph dims to that page and the pages it touches, with a
card beside it showing what the page says. Nothing is opened: the picture you
clicked from is the reason you are there, so leaving it is a button on the card
rather than something a click does to you. While a page is held, moving the
pointer across its neighbours swaps the card between them without re-aiming the
graph — and it stays on the last one, so you can move the pointer onto the card
and read it. Two marks keep that legible: a dashed ring on the page the graph is
arranged around, a solid one on the page the card is showing. A dimmed page is
not part of the answer on screen, so pointing at one does nothing. Click empty
space, or press Esc, to let go.

A link inside the card is read inside the card: the page it names takes over,
and **Back** returns you to the one you came from. The graph does not move while
you do it — the dashed ring stays where you put it — so following a link three
pages deep never costs you the neighbourhood you started in. A link to a PDF or
a picture says what the file is rather than trying to show it, and the button
underneath still opens it properly. A link to a page that does not exist does
nothing: looking around should not create files.

The card reads a page; it can also **write** one. The pencil hands it the same
editor the main pane uses — the same highlighting, live rendering, link
completion and undo history — over the same buffer, saving as you go, so the
file cannot be open in both places with two different ideas of what it says. While you are writing, moving the pointer over the graph no longer
changes the subject — a card that swapped pages out from under the cursor
would be unusable. The other button gives the card most of the window when a
360px column is not enough room, and hands it back afterwards.

Follow links far enough and the page in the card is one the graph is dimming —
it is drawn, but at an opacity that reads as absent, so you cannot see where it
sits. **Find it on the graph** appears then. It does what clicking that node would
have done — the graph re-aims around it — and brings it into the middle of the
part of the window the card is not covering, so it is somewhere you can
actually look at it. Your zoom is left alone: you asked where to look, not how
close.

Once a folder has more than a few dozen pages, the hard part is finding the one
you can already name. The **magnifier** in the bar along the top does that: click
it for a box, type part of a name or part of its folder, pick from the list, and
the graph goes there — pinned and brought into view, exactly as if you had found
the dot yourself and clicked it. Esc gives up what you typed, then the box, and
only then closes anything else.

**Tags**, in the bar along the top, adds a second kind of dot: one per tag,
joined to every page carrying it. A tag has no file to show, so its card lists
what carries it — click one of those to look at it, or search the tag to see
the whole answer.

## Finding things by tag

Search (⌘K) opens on the files you already have open, the way an editor does.
Type to search them all; type **`?`** to ask a different kind of question.

Behind `?` are the filters — `?type:concept`, `?tag:llm`, `?path:wiki/`,
`?fm:status=draft` for any other field at the top of a page, `?age:>6m`,
`?orphan:true`. They combine, match part of a word, and ignore case; repeat one
and both must hold.

A few of them ask what the app noticed rather than what you wrote:
`?stale:true` for pages written before a document they cite was last changed,
`?undistilled:true` for a day's jottings nothing has been written out of yet,
`?thin:true` for pages that never got past a stub, `?weakly-linked:true` for
ones only an index points at. These are the same checks the health button runs.
The difference is where the answer meets you: a panel is something you open
after you have already decided to tidy up, and a filter is something you can
ask in the middle of looking for something else. `?` on its own lists every filter there is, and a key with
nothing after it lists what can go in it — `?tag:` names every tag in the
knowledge base with how many files carry it, so you pick one rather than
remember it.

The prefix earns its keystroke: without it a colon is just a colon, so
searching for the words `type:concept` finds the page that says them.

These are the same filters a `localmd-query` block takes (see `writing-notes`)
and the same ones the assistant uses — only ⌘K asks for the `?` first, because
it is also a search box. A way of narrowing that you work out in one place
works in the others. A filter that will not parse is quietly
ignored here rather than complained about: half-typed is the normal state of a
search box.

A PDF or EPUB has no frontmatter of its own, so it inherits the tags of the
pages that cite it: tag a note about a paper and the paper answers to that tag
too. Nothing is written anywhere to make that work, so re-tagging the note
re-tags the paper.

## Today's page — before you know where it goes

Not everything arrives knowing where it belongs. A thought on the way to
something else, a link worth keeping, a sentence you do not want to lose:
deciding which page it goes on is usually more work than the thought itself,
which is how most of them get lost.

So there is one place that needs no decision — today. Press ⌘K, type `:`, write
the line, press Enter. It lands in a file named for today's date, in
`raw/daily/` if your folder has a `raw/` and `inbox/daily/` if it does not, as a
plain bullet: no title to think of, nothing to fill in. The palette stays open,
so a second line costs only typing it, and whatever you were reading stays where
it was. Press `:` with nothing after it to open today's page itself and sit down
in it.

Only the days you actually wrote something have a file. Nothing is created
because you opened the app.

These pages are **material, not notes**. They sit with the rest of what you
captured, and the assistant reads them the way it reads a dropped article —
pulling what is worth keeping into real pages that link back to the day it came
from. A jot is not where a thought ends; it is how the thought gets into the
folder at all.

If you already keep daily notes — from another app, or just your own folder of
dated files — the app writes into the folder you already use, as long as the
files are named `YYYY-MM-DD.md`. It finds them by name, so moving them later
breaks nothing.

Opening a knowledge base lands you here: today's page if there is one, otherwise
your index page. If you have neither, nothing opens — a folder with no home page
is not given one.

The log below runs the other direction. Today's page is what *you* put in before
it has a home; the log is what the assistant worked out about the pages you
already have.

## The todo list — what you have to do about it

Some of what turns up while you are reading is not a note, it is a job. ⌘K,
`[]`, the line, Enter — it lands in **`todos.md`** at the root of your folder,
as `- [ ] …`. The panel stays open, so several go in one after another, and
nothing you were reading is disturbed.

`[x]` files something already done, box ticked — a thing you did before there
was time to write it down still belongs on the list, which is a record of what
happened as much as a queue of what has not. `[]` on its own opens the list
instead, to go through them.

**Tick a box by clicking it.** Anywhere a page is being read — the list itself,
or a note that happens to carry a checklist — the boxes in the preview are
live, and clicking one edits the line behind it. No switching to edit and
hunting for the right one.

That file is a task list in the ordinary markdown sense, which is the whole
design: GitHub renders it, every editor's preview renders it, the assistant can
read and tick items in it, and none of that needs this app. It is one file at
the root because a list you cannot find is a list you stop keeping.

## The log — what is not a page

Some of what comes out of reading is not a page. Two notes end up disagreeing.
A number sits there with no source behind it. A question stays open.

Those go in **`log.md`**, as dated entries naming the pages involved:

```
## 2026-03-01 — [[chain-of-thought]] and [[prompting]] disagree on the threshold
One says 10B parameters, the other 100B. Unresolved.
```

The assistant offers to write one when a scan turns something up, instead of
mentioning it once in a chat you will close. It will not quietly edit
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

The **pulse icon** in the left bar shows the findings there is something to do
about: links pointing at a page that does not exist, pages nothing links to,
documents no page has written about yet, search indexes left behind by a
document that has been renamed or removed, and pages that cite a document
without saying which one. The last three come with a button that drafts the
work for the assistant — you still read it and send it.

Ask the assistant for a health check and it runs the same pass in full. On top
of those it reports pages that are nearly empty, pages you cannot reach by
navigating from the index, pages with no frontmatter, files you have added that
no page has ever mentioned, citations pointing at a document that is no longer
there, pages that cite a document without saying which one, pages you wrote
before a document they cite was last changed, log entries whose pages have been
edited since, days you jotted into that nothing has been written out of yet,
search indexes built from a document that has since left the folder, and tags
that are the same word spelled two ways (`machine-learning` and `Machine
Learning`).

Today's pages are left out of the page checks entirely. No frontmatter, two
lines, nothing linking to them — none of that is a fault in a day's jottings,
and a check that said otherwise would be teaching you not to write things down.
The one thing they are asked is whether anything has been written out of them
yet, and even that skips the most recent day, which is the one you are still
adding to.

The index one is quiet in a different way. A document's index is a folder of
its own under `.localmd/`, and it does not go away when you rename or delete the
document — it sits there still answering to that document's passage numbers,
which is why a citation into a book you removed months ago can still look
perfectly alive. The check names those, and when the same file is simply back
under a new name it says so. Clearing one out is a deletion like any other: the
assistant offers, you approve.

A renamed document gets a fresh index, numbered from scratch, so citations
written against the old name do not start landing in the new file just because
the bytes match — but that is repairable, and only when the two really are the
same file. Ask the assistant to recover the old citations and it hands the old
index's record of which passage each number named to the new one and rebuilds
from it. Afterwards, open a couple of the old citations and check they land
where they should; nothing about this is worth taking on trust.

The undeclared-source one is worth knowing about, because it is quiet too. A page can
cite passages — "as it says at [1]" — without ever naming the book those numbers
belong to; the assistant sometimes leaves the naming to the source page it links
to instead. Passage numbers are counted within each document, so a page like
that leaves its own citations to be matched by number alone, and several
documents can answer to the same one. The check names those pages and, where the
page it links to makes it obvious, the exact line that would fix it — which the
assistant can offer to add. See `documents` for what happens when you click such
a citation in the meantime.

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

### Links you meant to make

The same pass looks for the opposite of a broken link: a page that writes the
name of another page and never links to it. Twelve notes mention attention, you
have a page called Attention, and not one of them points at it — so the page
exists and nothing leads to it, which from the inside of a knowledge base feels
much the same as never having written it.

This is matched on the words alone. Nothing here knows what either page is
about; it knows that these characters are the title of that one. So it stays
out of code blocks, out of links you already made and out of the frontmatter,
and it passes over a name that two pages share, because it would have to guess
which you meant. What comes back is a list to read, not a change to accept — a
word can be a page's name without being about that page, and you are the one
who can tell.

The assistant offers them one page at a time: everything that mentions
Attention, in a single answer you say yes or no to. That is one decision
instead of twelve, and it is the point rather than a convenience. A heap of
suggestions you have to approve one by one would be the work it was supposed to
save you, handed back with someone else's name on it.

## Related

Getting set up: `getting-started`. How the assistant works with your files:
`working-with-the-agent`. Version history: `git-and-github`.
