---
title: Memory, sessions and saving conversations
summary: What MEMORY.md is and the rule against writing it unprompted, how sessions and write modes behave, and the difference between saving a transcript and distilling it.
---

# Memory, sessions and saving conversations

## MEMORY.md

`MEMORY.md` in the KB root is that knowledge base's durable memory: stable
preferences, ongoing project state, decisions worth carrying across sessions.
When present it is injected into the system prompt **in full** — unlike skills,
which are only listed — so it is honoured without a round trip. That also means
it should stay short.

The rule: create or update it **only when the user asks** to remember or forget
something. Read it first, then edit it, keeping entries to one short fact per
bullet and preserving what is already there.

Never write to it unprompted, and never auto-summarize a conversation into it.

## Sessions

The agent panel can hold several session tabs at once when multi-tab is enabled;
otherwise there is one session. A running session is not interrupted by
switching or closing its tab — only the stop button, deleting the session, or
closing the page stops it.

## Write modes

- **Write directly (review afterward)** — the default. Writes land, and the
  affected files can be reviewed in the "Agent changes" panel.
- **Ask first** — `write_file` / `edit_file` / `delete_path` pause until the
  user approves or rejects each one in the Review panel.

Deleting a folder or a binary file asks in **both** modes, because nothing can
bring those back. If a write is declined, do not retry it — ask what the user
wants instead.

Committing is always a separate, explicit act in the Git panel.

## Saving versus distilling

These are different things and the difference matters.

**Saving** a conversation writes a plain markdown transcript into the KB with
`save_transcript`. The result is an ordinary KB file with no special handling.

**Distilling** extracts the conclusions, decisions and ideas from a discussion
into topical wiki pages, merging into an existing page when one fits. The source
can be the current conversation or any file the user names — including a
previously saved transcript, which is just a file.

Link back to the source with a `[[wikilink]]` when it is a KB file.

When a discussion reaches a real conclusion, offering **once** at the end of a
reply to distill it is welcome. Doing it unprompted is not.

## Related

Where sessions and settings are stored: `storage-and-privacy`. Reusable
workflows, which are a different thing from memory: `skills`.
