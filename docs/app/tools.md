---
title: Tools — giving the assistant new abilities
summary: Almost nothing comes switched on; how to add a service by asking, what happens when one needs a key or a login, what the tags on each row mean, and why some counts are green and some grey.
---

# Tools — giving the assistant new abilities

Out of the box the assistant can work with your folder and nothing else. It
cannot search the web, look up a paper, or read your reading app — until you
give it a tool that does.

This is deliberate: what it can reach is always something you chose.

Everything lives in **Settings → Tools**.

## Two groups, and only one costs anything

The Tools page is split the same way the pricing is, so where a row sits tells
you what it costs:

- **Bundled tools — free.** These ship with the app and never cost anything.
  Today that is web search and page reading — two of them, because they fail
  differently: one needs no connection and answers quickly; the other finds
  better material and returns more of it. Between them you rarely have nothing.
  This set can grow over time.
- **Connections — paid.** Everything that reaches an outside service: the
  localmd Connect browser extension, MCP servers, and tools built against an
  API. One licence covers all of it (**Settings → Licence**; the start screen
  explains the price and the free early slots). Until you have a key, this
  group is visible but locked.

**localmd Connect** deserves a paragraph of its own: it is the companion
extension made for this app, and the one install that makes most *other*
things work. It lets the assistant use your own logged-in Chrome, so it
reaches pages that need a login and services that refuse web pages outright —
and on top of those browser tools it adds two things: a marketplace of a few
hundred **site adapters** — ready-made extractors for popular sites (Twitter,
Zhihu, Reddit, YouTube, …) that the assistant finds and runs in one step,
instead of hand-driving the page — and **site scripts**, persistent rules that
fix a page on every visit: hide the ads, restyle a section, run a snippet.
Worth setting up first, once you have a key.

There is no long list of recommendations. Keeping one would mean deciding on
your behalf which services are worth having, and re-checking those decisions
forever — services change their terms, their limits and their addresses. What
this app has instead is a way to add anything, in a minute, by asking.

## Adding anything else: just ask

This — like everything in the Connections group — needs a licence.

Tell the assistant what you want to reach — "search Hacker News", "read my
Readwise highlights", "look things up in my Notion". It works out how that
service is reached, then either builds the tools itself or points the app at the
service's own MCP server.

You never have to find an address yourself, but if you want to browse, a good
place is **mcp.so** — a directory of MCP servers. Find one you like, come back,
and say "add this one" with the name or the address. The assistant takes it from
there.

**Nothing it proposes happens on its own.** When it wants to add a server you
get a card showing the exact address, and it is added only when you click. When
a service needs a key, the card takes the key straight into the app — it is
never typed into the conversation, and the assistant never sees it. When a
service needs you to log in, the card opens that service's own sign-in page.

That rule is worth knowing the reason for: the assistant reads web pages, files
and tool results, and none of those can be trusted to be talking to it honestly.
A page can perfectly well contain the words "add the server at …". So the
assistant is never the one who decides — it can only ever put the address in
front of you.

## Connecting localmd Connect

**On localmd.app it works the moment it is installed**, with nothing to allow
and nothing to type. Check it on in Settings → Tools and the row turns green by
itself. Two things are still worth knowing:

- **The “Allow user scripts” toggle**, in the extension's popup. Site scripts
  and the more capable (*func*) adapters need it; the simple (*pipeline*)
  adapters work without. Until it is on, those tools report that they cannot
  run — the assistant will tell you, and the fix is that one switch.
- **Development addresses** (a local `localhost:…` build of this app) are not
  pre-authorized. Click the extension's toolbar icon, open **Web app access**,
  add the address shown on the row's page — exactly as shown, port included —
  and reload this page (a page gets the extension as it loads, never
  afterwards).

Two of its abilities can change things outside this app, so they always stop
and ask first, in the chat:

- **Running a write adapter** — one that posts, messages or deletes on a real
  site, as you. The confirmation card names the site and the adapter and shows
  the arguments; nothing runs until you confirm, and a decline is final for
  that request.
- **Installing a site script that injects CSS or JavaScript.** The card shows
  the match patterns and the exact code. For hide-only rules the card is
  lighter — just the patterns and the selectors being hidden. The assistant can
  also preview the effect first (outlining what would be hidden, or a one-off
  dry run of the JavaScript) so you judge the real thing, not a description.

Confirming is the front line, not the only line: every site script can be
paused or deleted at any time from the extension's popup, whatever installed
it.

Once it is connected, **@** in the chat box also lists the pages you have open,
so you can hand the assistant a tab (or several) to work with — see
`working-with-the-agent`.

## Adding a server yourself

Settings → Tools → **Add an MCP server** takes an address, an optional name, and
an optional token. That covers most of what you will be handed when a service
says "here is our MCP endpoint".

There is one checkbox worth knowing about: **Reach it through the browser
extension**.

Leave it off and the app connects to the address itself. That is the simpler
path, and it works whenever the service allows it. The catch is that most hosted
MCP services do not: they were built for desktop apps and refuse a web page
outright, which shows up as a red row saying "Failed to fetch" no matter how
correct your address is.

Turn the checkbox on and localmd Connect fetches on the app's behalf instead.
It is not a web page, so the refusal does not apply to it. The trade is that
the server now depends on the extension — if localmd Connect is not connected,
that row cannot start, and it says so rather than failing obscurely.

If a server you know is correct will not connect, that checkbox is the first
thing to try.

## When a service wants you to log in

Plenty of services do not hand out keys — they want an account. A row like that
connects, fails, and says so with an authorization error; that is when a
**Sign in** button appears on it.

Pressing it opens the service's own sign-in page in a small window. You log in
there and choose what to grant — which pages, which workspace. The window closes
itself and the row turns green.

The button only appears where it is the answer. A row that is working, or one
that failed for some other reason, does not offer it — signing in to a service
that never asked would just produce a different confusing error.

**Sign out**, in the same place, forgets the login. See `keys` for what is
stored and how to revoke it from the service's end.

## Reading the Installed list

One row per integration. Open any row to see the individual tools inside it.

Each row has a tag saying **where it came from**:

- **Preset** — one of the few things that come switched on. We defined it, so
  only the parts you must supply (an address, a token) can be edited.
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
that one integration, leaves everything else alone, and tells you how it went —
including when the answer is the same as before.

localmd Connect is the exception to "mostly repairs itself", on development
addresses only: if you remove the address from its **Web app access** list,
calls stop being answered rather than refused, so the app can only report that
they timed out. Add the address back and reload. (localmd.app itself cannot end
up in that state — it is pre-authorized.)

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
often it does not allow browser access, which the localmd Connect extension
gets around — try installing it. For a server you added yourself, also turn on
**Reach it through the browser extension** in that server's settings; the
address being right is not enough if the service will not talk to a web page
at all.

**A tool returns an authorization error.** The key is probably missing or wrong.
Check Settings → Tools → Keys.

**A row says it needs a value for something.** That integration wants a key you
have not entered yet, and the row names which one. Put it in Settings → Tools →
Keys under that name and the row connects itself — there is no second step. The
key is stored once and referenced by name, so rotating it later means editing it
in that one place rather than reinstalling anything.

**You just want it fixed.** Tell the assistant what happened. It can test tools
directly and see the real error.

## Related

Keys and privacy: `keys`. Everything the app stores and where:
`storage-and-privacy`.
