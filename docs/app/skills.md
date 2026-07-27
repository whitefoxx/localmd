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

That summary line matters: it is the only thing considered when deciding whether
a skill applies. "How to ingest a paper into raw/papers with a summary page" is
a better line than "paper stuff".

## What makes a good skill

Write down what you **learned**, not what the tools already say.

A skill that lists tool names adds nothing — the assistant already knows those.
A skill that records "this API reports duration in seconds, not minutes" or
"always check the appendix for the funding statement" saves real work every time.

## Skills travel

They live in your folder, so they go with it through git. Share a knowledge base
and you share the ways of working that go with it.

The app also ships a few built-in skills for things about the app rather than
your notes — connecting a new service is one. You never have to install those,
and a skill of your own with the same name takes priority.

## Related

Working with the assistant: `working-with-the-agent`. Long-term memory, which is
a different thing: `memory-and-sessions`. Your folder: `knowledge-base`.
