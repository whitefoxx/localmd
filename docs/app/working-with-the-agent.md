---
title: Working with the assistant
summary: What the assistant can do for you, how to control whether its edits land immediately, and how to save or distill a conversation into your notes.
---

# Working with the assistant

The assistant on the right is not a chatbot bolted onto a notes app. It has real
access to your folder: it can read files, search them, write new ones, reorganize
things you ask it to, read PDFs, and change the app's own settings.

## Asking it to do things

Plain language works. Some examples of the range:

- "What did I write about attention mechanisms?"
- "File this PDF where it belongs and write me a summary page."
- "Turn this conversation into a note."
- "Install the research tools so you can look up papers."
- "Switch write mode to ask first."
- "How do API keys work in this app?"

Two things help: **@** references a specific file, and **/** runs a saved
workflow directly.

It answers — and reasons — in the language you wrote in, and switches when you
do. The interface language in Settings → General is only what it falls back to
when a message gives it nothing to go on, like a bare path or a dropped file.

## Whether edits land immediately

**Settings → Agent → Write mode** has two options:

- **Write directly (review afterward)** — the default. Edits happen, and each
  changed file is listed for you to approve or undo afterwards.
- **Ask first** — every write, edit and delete pauses the conversation on a
  card right there in the chat: the file, the diff, and Approve / Reject
  buttons. The assistant waits until you decide — there is no dialog to miss,
  and each conversation asks for its own changes.

Either way, **deleting a folder or a binary file always asks**, because nothing
can bring those back. And committing to git is always separate and explicit —
the assistant never commits unless you ask.

Files that have already been changed collect behind the diff icon in the left
bar, with a count on it. Click it to see the changes side by side and keep or
undo each one.

If you reject an edit, it will ask what you want instead rather than trying
again. Stopping a turn while a card is waiting is not a rejection — nothing is
written, and the assistant simply picks the question back up if you continue.

## Plans

For anything with several steps, the assistant keeps a visible checklist so you
can see where it is and what is left. You do not need to ask for this. The
checklist belongs to its conversation and is saved with it — close the tab or
reload the page, and it is still there when you come back. Dismissing it with
its × is what forgets it.

## Sessions

Each conversation is a session. If multi-tab is enabled in Settings → Agent, you
can have several going at once.

A running session keeps running if you switch tabs or close its tab. It stops
only when you press stop, delete the session, or close the page.

Stop means stop: the request in flight is cancelled too, not just the reply.
The conversation closes off immediately. A few things cannot be called back
once they are under way — a push already sent, a document part-way through
indexing — and those finish in the background; nothing waits for them.

## Asking something a different way

If a reply went somewhere you did not want, you do not have to start over or
argue your way out of it. Hover over one of your own messages and click the
pencil: the text comes back to the composer, you change it, and sending it picks
the conversation up from there.

The reply you are leaving behind is not thrown away. Your message now has
versions — a small **1/2** appears beside it, and the arrows move between them.
Each version keeps whatever followed it, so you can try two approaches and go
back to either.

Two things worth knowing:

- The assistant answers again from that point, so it costs a reply.
- **Your files are not rewound.** Anything already written, moved or deleted
  stays exactly as it is. Going back changes the conversation, not your folder —
  undo file changes from the diff panel, or with git.

In a conversation that started before this existed, the older messages have no
pencil — they were never recorded in a way that can be replayed one at a time.
Everything you say in it from now on can be re-asked normally.

## Saving a conversation

Two different things, and the difference matters:

- **Save** writes the conversation to your folder as a plain markdown file. Ask
  for "save this conversation". You get a transcript — an ordinary note.
- **Distill** pulls the *conclusions* out of a discussion and writes them into
  topic pages, merging into a page that already exists when one fits. Ask to
  "turn this into notes".

You can distill a conversation you saved weeks ago too — it is just a file, so
name it and ask.

When a discussion reaches a real conclusion, the assistant may offer once to
distill it. It will not do it on its own.

## Pointing it at a browser tab

With localmd Connect installed (see `tools`), **@** also lists the pages you
have open in your browser. Pick one and it becomes a chip above the box: the
assistant can now read that tab for the rest of the conversation, so a
follow-up needs no re-picking. Pick several and it can compare them. The ✕ on a
chip lets a page go.

What travels with your message is the address of the tab, not a copy of the
page: the assistant reads it when it needs it, and reads it *then* rather than
when you picked it. That matters more than it sounds — it reads the tab as you
have it, signed in, with whatever you searched or filtered still on screen,
which is a different page from what the same address gives a stranger.

Tabs belong to the conversation they were picked in. A new conversation starts
with none, and the ones you picked earlier are still there when you switch back.

## When it cannot reach the web

The assistant has no web access until you give it some, and it will tell you so
rather than invent an answer. See `tools`.

It also will not cite a link it did not actually open. If something rests on its
general knowledge rather than a page it read, it says so.

## Related

What it can be given access to: `tools`. Long-term memory across conversations:
`memory-and-sessions`. Choosing a model: `models`.
