---
title: API keys and privacy
summary: Keys stay in your browser and the assistant never sees their values — how that works, why it can still help you set one up, and the one thing worth watching.
---

# API keys and privacy

Some services need a key to prove a request is yours. Your keys are stored in
your browser, and they are never shown to the assistant.

## How that is possible

A tool does not contain its key. It contains a **name** — a placeholder like
`{{secret:weread_api_key}}`. The real value is filled in at the last moment,
when the request is actually sent, and only then.

So the assistant can read and write the placeholder without ever seeing what it
stands for. In practice that means it can genuinely help — "this tool needs a
key called `weread_api_key`, you can get one here, the field is currently
empty" — while never being in a position to leak it.

## Giving it a key

When the assistant needs one, it does not ask you to paste it into the chat.
A small form appears instead; you type the key straight into the app. It goes to
your browser's storage, and the assistant is told only that a value was saved.

**Never paste a key into the chat message box.** Anything you type there does go
to the model. If you do it by accident, delete the message and rotate the key.

You can also fill keys in yourself at any time: **Settings → Tools → Keys**.
That section lists only keys your installed tools actually ask for, so it stays
short.

## The one thing worth watching

Key names are a single shared list. Any tool that asks for a key by a name you
already have will receive that value — whichever service that tool talks to.

This matters when tools arrive from somewhere else, for instance with a shared
knowledge base folder. Two safeguards exist:

- Under each key, the app lists which tools read it.
- When you approve a folder's tools, it warns you if they want keys you already
  have, and shows you where they send data.

## Where keys live

In your browser's local storage for this site, together with your model provider
keys and your GitHub token. Specifically:

- They are **not** in your knowledge base folder, so they are never committed to
  git and never travel with a folder you share.
- They are **not** on any server of ours, because there isn't one.
- Clearing your browser's data for this site **deletes them**. Your notes are
  unaffected — those are files on disk.

## Related

How tools use keys: `tools`. Everything the app stores: `storage-and-privacy`.
