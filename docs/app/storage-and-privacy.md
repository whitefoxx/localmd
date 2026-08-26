---
title: Where everything is stored
summary: What lives in your folder, what lives in your browser, what actually leaves your machine, and what clearing browser data would lose.
---

# Where everything is stored

There is no server. The app is a website that runs entirely in your browser, and
there is no account, no upload and no copy of your data anywhere but your own
machine.

Two places hold things, and it is worth knowing which is which.

## In your folder

Everything that *is* your knowledge base, plus anything meant to travel with it:

- your notes, PDFs, images — all of it
- `AGENTS.md` — how your folder is organized
- `MEMORY.md` — what the assistant remembers about you
- `.agents/` — saved workflows, and any tools this folder carries
- `.localmd/` — document indexes, and any result too large to fit in one
  chat, kept so the assistant can read the rest of it back
- `artifacts/` — interactive pages the assistant generated

Share or clone the folder and all of this comes along.

## In your browser

Everything that is *settings* — belonging to this browser rather than to any
folder:

- your model providers and their API keys
- which tools are installed, and any you or the assistant created
- tool API keys, your GitHub token, and any service you signed in to
- interface language, shortcuts, and preferences

None of this is in your folder, so none of it is ever committed or shared. It
follows the browser: open the same folder on another computer and you will set
up keys again there.

**Clearing browser data for this site deletes all of it.** Your knowledge base
is untouched — it is files on disk — but you will re-enter your keys. If that
would hurt, keep them wherever you normally keep passwords.

## What actually leaves your machine

Only these, and only when the relevant thing happens:

- **To your AI provider** — the chat, and whatever file content is read
  during it. This is the main one: if you ask the assistant about a note, that
  note's text goes to the model.
- **To a tool's service** — only the request that tool makes, only when it runs.
- **To GitHub** — only when you push.

One thing happens without you asking: loading the app counts an anonymous
visit — which page, where you arrived from, and rough facts about the browser
(country, device, browser name). It is measured by the host that serves the
site, with no cookie and no identifier that follows you between visits or
between sites, and it says nothing about your folder, your notes or your
chat. A content blocker that stops it changes nothing about how the app
works.

That is the complete list. Nothing else is sent in the background, and nothing
goes anywhere on a schedule.

## Working offline

Reading, writing and searching your notes all work with no internet at all — the
files are local. Only the assistant needs a connection, since the model is
remote.

That works because the browser keeps its own copy of the app. A newer one is
fetched in the background when it exists, and put to use when you say so rather
than in the middle of your work — see `getting-started`.

## A note on external tools

Results that come back from an outside service are treated as data, never as
instructions. If a web page contains text telling the assistant to do something,
it will not act on it. And it will not send your notes to an outside service
unless that is precisely what you asked for.

## Related

Keys specifically: `keys`. Backup: `git-and-github`. Your folder:
`knowledge-base`.
