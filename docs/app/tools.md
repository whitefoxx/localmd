---
title: Tools — giving the assistant new abilities
summary: Nothing is built in; how to add web search, research lookup or a service you use, what the tags on each row mean, and why some counts are green and some grey.
---

# Tools — giving the assistant new abilities

Out of the box the assistant can work with your folder and nothing else. It
cannot search the web, look up a paper, or read your reading app — until you
give it a tool that does.

This is deliberate: what it can reach is always something you chose.

Everything lives in **Settings → Tools**.

## The easiest way: just ask

Click **Describe it to the agent** and say what you want it to reach — "search
Hacker News", "read my Readwise highlights", "look things up in my Notion".

It will find out how that service works, build the tools, test them, and ask you
for anything only you can provide (usually an API key). This is a normal
conversation, not a feature request — tools in this app are just configuration,
so it can create them on the spot.

## Or pick from the recommended list

**Browse recommended** has a checklist of things that are known to work: web
search and page reading, research databases (OpenAlex, Crossref, Europe PMC),
Wikipedia and Open Library, RSS feeds, arXiv, Zotero, and a couple of
documentation services.

If you want just one thing to start with, take **WebCLI**. It is a browser
extension that lets the assistant use your own logged-in Chrome — so it reaches
pages that need a login, and it makes most other tools work better too.

## Reading the Installed list

One row per integration. Open any row to see the individual tools inside it.

Each row has a tag saying **where it came from**:

- **Preset** — from the recommended list. We defined it, so only the parts you
  must supply (an address, a token) can be edited.
- **Yours** — you made it, or the assistant made it for you.
- **KB** — it came with this knowledge base folder. See below.

Some rows have a second tag, **MCP** or **Extension**. That means the row is a
separate program the app connects to, rather than a set of web requests.

## Why some counts are green and some grey

- **Green, with a dot** — this is a live connection, and it answered just now.
  The number is how many tools it reported.
- **Grey** — there is nothing to connect to. The number comes from the
  configuration itself and is simply always true.

Grey is not a problem. A red dot is: it means a connection failed, and the row
says why. A connection that dies later — the program stops, the extension
reloads — turns red too, rather than pretending to still be there.

## When a connection drops

Mostly it repairs itself:

- Reloading the page reconnects everything.
- Coming back to the tab re-tries whatever was failing, so a server that came
  back up while you were elsewhere is simply working again.
- If the assistant uses a tool whose connection died in the meantime, the app
  reconnects and sends it once more. (Only when the request provably never
  arrived — nothing is ever run twice on a guess.)

When you want to force it, open the row and press **Reconnect**. It re-connects
that one integration and leaves everything else alone.

## Tools that come with a folder

A knowledge base folder can carry its own tools, so a folder someone shares with
you arrives with the abilities it needs.

Those tools **stay switched off until you approve them once**. Before you do,
the app shows you where each one sends data, and warns you if any of them want
to use an API key you already have. If the folder later changes its tools, it
asks again.

Approve only what you understand — it is someone else's configuration running
with your keys.

## What happens when you switch folders

- Anything tagged **KB** is replaced by whatever the new folder carries.
- Everything else — presets, your own tools, your servers, your keys — stays
  exactly as it is. Those belong to your browser, not the folder.

## When something does not work

**"Failed to fetch" or a red dot.** The service refused the connection. Most
often it does not allow browser access, which the WebCLI extension gets around —
try installing it.

**A tool returns an authorization error.** The key is probably missing or wrong.
Check Settings → Tools → Keys.

**You just want it fixed.** Tell the assistant what happened. It can test tools
directly and see the real error.

## Related

Keys and privacy: `keys`. Everything the app stores and where:
`storage-and-privacy`.
