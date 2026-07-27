---
title: Skills — reusable workflows
summary: What a skill is, the SKILL.md format and where it lives, how progressive disclosure keeps them free until used, and when to write one.
---

# Skills — reusable workflows

A skill is a written workflow the agent can load and follow: "how we ingest a
paper into this KB", "how to prepare the weekly review". It is a markdown file,
not code.

## Format and location

Canonical path: `.agents/skills/<name>/SKILL.md`. `.claude/skills/` is also read
for compatibility; on a name clash the canonical directory wins. Terminal Claude
Code users typically symlink one to the other.

```markdown
---
name: ingest-paper
description: One line — this is what future sessions see when deciding to load it.
---

The full instructions go here, self-contained.
```

Both frontmatter fields degrade gracefully: a missing `name` falls back to the
directory name, a missing `description` to the first body line.

Other files in the skill directory are bundled resources — templates, examples.
They are listed when the skill loads, and read with `read_file` if the
instructions reference them.

## Progressive disclosure

Only the name and one-line description go into the system prompt. The full body
is fetched with `use_skill` when a task actually matches.

This is why a skill's description should be a precise trigger rather than a
summary: it is the only thing a future session sees when deciding whether to
load it, and it is paid for on every turn.

## Built-in skills

The app ships skills that are about the app rather than about any one knowledge
base — `connect-a-service` is one. They are available in every KB without
scaffolding anything into the user's folder, and a KB skill of the same name
overrides them.

## Slash commands

The user can force a skill directly from the chat input with `/name`.

## When to write one

When a workflow has been worked out once and will be repeated. The useful moment
is right after finishing something non-obvious: what the steps were, what the
gotchas were, which field means what.

Write what was actually learned, not a description of tools that already
describe themselves. A skill that just lists tool names adds nothing; a skill
that records "this API reports duration in seconds, not minutes" saves the next
session a round trip.

## Related

Reference material about the app itself is not a skill — it is what app_help
serves. To connect an external service, load the built-in connect-a-service
skill with use_skill rather than hand-writing a skill file for it. Where a KB's
skills sit among everything else it carries: `knowledge-base`.
