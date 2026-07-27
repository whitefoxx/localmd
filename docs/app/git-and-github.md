---
title: Version history and backup
summary: Optional git support gives you undo across time and a private GitHub backup; commits only ever happen when you ask.
---

# Version history and backup

Your knowledge base is a folder, so it can be a git repository — which gives you
a full history of every change and a way to back it up privately.

This is entirely optional. Everything works without it.

## What it gets you

- **Undo that survives everything.** Not just the last change — any file, at any
  past point.
- **A record of what changed and when**, including everything the assistant did.
- **Backup and sync** through a private GitHub repository.

## Getting started

Ask the assistant to "set up version control for this folder" and it will do the
whole thing. Or use the git icon in the left bar.

To back up to GitHub you need a token — a limited-access password. Settings →
Git & GitHub has the exact steps, and the important part is that you can scope it
to **just this one repository**.

Once that is set, ask it to "publish this to a private GitHub repo".

## Committing is always yours to ask for

The assistant never commits on its own, however many files it just changed. It
commits when you ask, tells you what went in, and will not bundle unrelated
changes together silently.

The **Agent changes** panel shows what was edited since you last looked, so you
can review before deciding.

## Things to know

- **Syncing only fast-forwards.** If the same folder changed in two places, the
  app will not attempt a merge — you resolve that in a terminal. In practice
  this is rare for a personal knowledge base.
- **Document indexes and files over 100MB are skipped** when pushing. Indexes
  rebuild themselves, so nothing is lost and your repository stays small.
- **Images and PDFs are committed normally.**
- **Restoring discards uncommitted work**, so the assistant will confirm first.

## Related

Your folder: `knowledge-base`. Where the GitHub token is kept:
`storage-and-privacy`.
