---
title: Memory across chats
summary: MEMORY.md is what the assistant remembers between chats; it is only ever written when you ask, and it is a file you can read and edit.
---

# Memory across chats

Each chat starts fresh. What carries over is a single file:
**`MEMORY.md`** in your folder's root.

If it exists, the assistant reads it at the start of every chat and honours
what it says. Typical contents:

- how you like things written or filed
- what you are currently working on
- decisions you do not want to re-explain

## It is only written when you ask

The assistant will not add to your memory on its own, and it will not quietly
summarize a chat into it. Say "remember that…" or "forget that…" and it
edits the file, keeping what is already there.

This is a deliberate limit. Memory that grows by itself becomes a file nobody
trusts and nobody reads.

## Keep it short

The whole file is included in every request, so it costs something on every
message. A dozen short lines is a good memory; three pages is a liability.

If it has grown, ask the assistant to tidy it.

## You can just read it

It is a normal markdown file in your folder. Open it, edit it, delete a line,
put it in git. There is no hidden state anywhere else.

## Memory versus skills versus notes

Three different things, easy to confuse:

- **Memory** — a handful of facts about you and your current work, read every
  time. See above.
- **Skills** — a workflow, loaded only when it applies. See `skills`.
- **Notes** — your actual knowledge base. Everything else.

If you find yourself putting instructions into memory, it is probably a skill.
If you find yourself putting knowledge into memory, it is probably a note.

## Related

Saving and distilling chats: `working-with-the-agent`. Reusable
workflows: `skills`.
