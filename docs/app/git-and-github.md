---
title: Git and GitHub sync
summary: How versioning works on a local folder, the token-based publish flow, the fast-forward-only rule, and what is excluded from a push.
---

# Git and GitHub sync

The knowledge base is a folder, so version control is ordinary git on that
folder. There is no proprietary sync and no server of ours in the path.

## The normal flow

1. `git_status` — see what changed
2. `git_diff` — review anything unclear
3. `git_commit` with a message describing the change
4. `git_push` if the user asked to push

If `git_status` reports the folder is not a repository and the user wants
version control, `git_init` first.

Never bundle unrelated changes silently; say what was committed. Commit when the
user asks, not automatically after editing.

## Publishing to GitHub

Prefer the token-based flow:

1. `github_create_repo` — defaults to private, named after the KB, uses the
   token from Settings and sets it as `origin`
2. `git_commit`, then `git_push` — the first push to an empty repo is handled

To attach an existing repository instead, use `git_remote_add` with its URL.

When a github tool fails, relay its error to the user rather than silently
trying another approach — those messages name the exact token setting to fix.

## The token

A fine-grained GitHub token is needed to push; pulling a public repo does not
need one. Settings → Git & GitHub explains the exact scopes: Repository access
set to *Only select repositories* (just the KB repo), Permissions → Contents set
to *Read and write*.

The token lives in `localStorage` with everything else — see
`storage-and-privacy`. It is never written into the folder.

## Constraints worth knowing

- **Sync is fast-forward-only.** The app will not merge. When histories have
  diverged, the conflict is resolved in a terminal.
- **`.trace/` and files over 100MB are excluded** from pushes through the app.
  Indexes are rebuildable, so this costs nothing; it keeps repositories sane.
  They can still be handled from a terminal.
- **Binary files commit normally** otherwise — images and PDFs in the KB are
  ordinary tracked files.
- **`git_restore` is the undo** for tracked text files, and brings back one
  deleted after it was committed. It discards uncommitted work, so confirm
  before running it.

## Related

What is in the folder versus the browser: `storage-and-privacy`.
