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

If a folder has no `raw/`, anything saved automatically (a pasted screenshot, an
uploaded file) lands in `inbox/` instead. Think of `inbox/` as a doormat, not a
home: when you get to it, ask the assistant to file it properly.

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

## Checking the health of your knowledge base

The **pulse icon** in the left bar runs a structural check: broken links, pages
nothing links to, pages that are nearly empty, sections you cannot reach.

It is fast, free, and does not involve the AI at all. Deeper questions — "do any
of these pages contradict each other?" — do need the assistant to read your
content, so ask for those directly and it will suggest a scope rather than
reading everything.

## Related

Getting set up: `getting-started`. How the assistant works with your files:
`working-with-the-agent`. Version history: `git-and-github`.
