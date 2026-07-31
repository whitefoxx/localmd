---
title: What localmd is
summary: An AI knowledge base that runs in your browser and your local folder. Nothing to install, no account, and the files stay where you put them.
---

# What localmd is

localmd is a web page that turns an ordinary folder on your computer into a
place to keep what you read, write and think about — with an AI assistant that
can actually work on it with you.

Two things make it unusual.

**There is nothing to install.** No app, no terminal, no background service, no
plugin to set up. You open the page, point it at a folder, and the assistant is
already there. Your browser asks your permission for that one folder, and that
permission is the whole arrangement.

**Your knowledge base is that folder.** Markdown files, PDFs, images — not a
database, not a cloud service.

That means:

- **No account.** Nothing to sign up for.
- **Nothing is uploaded.** The app reads and writes the folder you chose,
  directly, from your browser. The one thing that does leave is what you send to
  your AI model — see `storage-and-privacy`.
- **No lock-in.** Open the same folder in any editor. Edit files outside the app,
  move them, delete them — nothing breaks.

If you stopped using localmd tomorrow, you would still have everything, in a
format anything can read.

## Which browser

Chrome, Edge, or another Chromium-based browser. Letting a web page read and
write a folder you choose needs a browser feature (the File System Access API)
that only those have — Firefox and Safari can't open a local folder this way at
all. It is the same feature the whole no-install idea rests on.

## Getting started

1. Click **Open local folder** and choose a folder. Your browser will ask for
   permission — that permission is what lets the app read and write those files,
   and it covers only the folder you picked.
2. If the folder is empty, the app offers to set up a starting structure. If it
   already has files, it leaves them exactly as they are.
3. Add a model in **Settings → Models** so the assistant can work. This needs an
   API key from a provider (Anthropic, OpenAI, DeepSeek and others). See
   `models`.

Nothing else is required. Tools, git and document indexing are all optional and
can wait until you want them.

## The three areas of the screen

- **Left** — the icon bar, and your files. The icons are, top to bottom: files,
  search, graph view, git, knowledge-base health. At the bottom: settings,
  theme, help, and close folder.
- **Middle** — whatever you are reading or editing.
- **Right** — the assistant.

You can drag the edges to resize, and hide the side panels entirely.

**Settings → General** holds the interface language and the appearance (system,
light or dark). The theme icon in the bar is a shortcut for the same setting,
and you can simply ask the assistant to switch it.

## What the assistant can do

Most of it. It reads and writes files in your folder, searches them, files new
material where it belongs, reads PDFs, commits to git, builds itself new tools
for services you use — and it can explain and change the app's own settings for
you.

If you are ever unsure how something works, just ask it. It has this manual.

## A note on cost

The app is free and has no server. What costs money is the AI model, billed by
whichever provider's key you enter, at their prices. Nothing is charged by
localmd, because there is nobody to charge it.

## Related

Your folder and how it is organized: `knowledge-base`. Working with the
assistant: `working-with-the-agent`. Where settings are kept:
`storage-and-privacy`.
