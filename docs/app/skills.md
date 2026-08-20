---
title: Skills — saving a way of working
summary: Teach the assistant a repeatable workflow once, stored as a file in your folder, and run it later with a slash command.
---

# Skills — saving a way of working

A skill is a workflow you worked out once, written down so the assistant follows
it the same way every time. "How I ingest a paper." "How I prepare my weekly
review." "How our team formats meeting notes."

It is a plain markdown file in your folder, not a program.

## Making one

The easy way: after the assistant has done something the way you wanted, say
**"save that as a skill"**. It writes the file.

It ends up at `.agents/skills/<name>/SKILL.md`, with a name and a one-line
description at the top, and the instructions below. You can edit it like any
other file.

## Using one

Type `/` in the message box and pick it. Or just describe the task — the
assistant sees a one-line summary of every skill and loads the full instructions
when one matches.

A new conversation also puts your first few skills as buttons right above the
message box; the ▲ next to them opens the full list.

That summary line matters: it is the only thing considered when deciding whether
a skill applies. "How to ingest a paper into raw/papers with a summary page" is
a better line than "paper stuff".

## Who a skill is for

By default a skill is offered to both of you: it is in the slash menu, and the
assistant can pick it up on its own. Some skills only make sense one way round —
a checklist you run by hand every Friday is not something the assistant should
ever start, and a routine it follows silently does not need to sit in your menu.

Add an `invocation` line to the top of the file to say which:

```
---
name: weekly-review
description: My Friday wrap-up
invocation: user
---
```

`user` means only you can start it. `model` means only the assistant. Leave the
line out and it stays available to both.

There is a reason to bother: the assistant is told about every skill it might
use at the start of every reply, so a workflow only you ever run costs a little
on each one. Marking it `user` takes it out of that list without taking it out
of your menu. You can still type `/name` for a `model` skill — the setting
decides what gets *offered*, not what is allowed.

## What makes a good skill

Write down what you **learned**, not what the tools already say.

A skill that lists tool names adds nothing — the assistant already knows those.
A skill that records "this API reports duration in seconds, not minutes" or
"always check the appendix for the funding statement" saves real work every time.

## Skills travel

They live in your folder, so they go with it through git. Share a knowledge base
and you share the ways of working that go with it.

The app also ships a few built-in skills you never have to install. Some are
about the app rather than your notes — connecting a new service is one. One is
about your notes: type **`/ingest`** and the assistant works through the
material you have added that no page covers yet and writes it up, following
whatever structure your folder already uses. A skill of your own with the same
name takes priority over any of them.

## Related

Working with the assistant: `working-with-the-agent`. Long-term memory, which is
a different thing: `memory-and-sessions`. Your folder: `knowledge-base`.
