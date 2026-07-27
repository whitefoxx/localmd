---
title: How the knowledge base is organized
summary: The folder is the product; the raw/ + wiki/ scaffold is a suggestion not a rule, AGENTS.md documents a KB's own conventions, and conventions are never enforced.
---

# How the knowledge base is organized

A knowledge base is an ordinary folder of markdown files on the user's disk,
opened through the browser's File System Access API. There is no database, no
import step and no proprietary format. The user can edit, move and delete files
outside the app at any time, and nothing may break or nag when they do.

## The user's structure wins

The `raw/` + `wiki/` split is the scaffold offered for **brand-new empty**
knowledge bases. It is not a requirement and must never be grafted onto a folder
that is organized differently.

- `raw/` — captured source material, bucketed by kind (`raw/papers/`,
  `raw/images/`, `raw/articles/`, `raw/books/`, `raw/conversations/`)
- `wiki/` — the user's own written pages

When a KB has no `raw/` tree, automatic writes (pasted screenshots, uploaded
files) land in a neutral `inbox/` instead. `inbox/` is a landing zone, not a
home: when ingesting from it, move the file to wherever that KB's own layout
keeps that kind of thing.

For an existing folder, infer the organizing intent from the folders and names
that are already there, and file new content where **their** layout says it
belongs.

## AGENTS.md

`AGENTS.md` in the KB root describes that knowledge base's conventions — its
folder meanings, naming habits, workflows. It is read into the agent's system
prompt whenever present. `CLAUDE.md` is read as a fallback so KBs created with
other tools keep working.

The point of AGENTS.md is to document the structure a KB **already has**, not to
impose one. Offering to write one for a folder that lacks it is welcome; filling
it with the default scaffold when the KB doesn't use that scaffold is not.

## Every convention is soft

Layout, frontmatter, linking — all of it is a suggestion the agent follows and
recommends, never a validation gate. Nothing is rejected for not matching.

Pages may carry a frontmatter `type:` — a short, producer-defined kind
(`concept`, `source`, `entity`, …). It is a lightweight convention with no
registry and no fixed vocabulary. Preserve it when editing; set a sensible one
when creating a page alongside typed siblings.

## Linking

`[[wikilinks]]` connect pages. A link target is a file name without the `.md`
extension. Links are how a page avoids becoming an orphan, so link a new page
into the relevant index as you create it rather than leaving it to a later
cleanup.

## Checking structural health

`kb_health` is a deterministic checker for structural problems — broken links,
orphans, unreachable or thin pages. It is the right tool for those, and it costs
no model tokens on the content.

What it cannot do is semantic: contradictions between pages, claims that have
gone stale. Those need reading the content, which is token-heavy, so they should
be proposed to the user with a scope rather than run across a whole KB unasked.

## Related

Where the app keeps its own settings versus what lives in the folder:
`storage-and-privacy`. Reusable workflows stored in a KB: `skills`.
