---
title: Tools and MCP servers
summary: What a tool is, the difference from an MCP server, the Preset/Yours/KB sources, where each is stored, and what changes when the user switches knowledge base.
---

# Tools and MCP servers

Nothing is built in. What the agent can reach is exactly what the user has
installed under Settings → Tools.

## Two kinds of thing

**A tool** is one HTTP request: a URL template, its parameters, headers, and a
rule for shaping the response. It is data — a JSON spec — not code. That is why
the agent can research a service and build working tools for it inside one
conversation, and why "add a tool" never means shipping a release.

**An MCP server** is a separate program that speaks the Model Context Protocol.
The user supplies an address; the server answers with a list of tools, and that
list can differ between sessions. A browser extension (WebCLI) speaks the same
protocol over a Chrome runtime port, so it is the same kind of thing with a
different transport.

The practical difference: a tool always exists, so its count is a fact about the
config. A server can be down, so its count is a status. In the UI only server
rows get a status dot and a colour — a green count means a connection answered
just now, a grey count is a number from the config with nothing to connect to.
A grey count is not a problem.

## The three sources

Every row in Settings → Tools carries one source tag.

- **Preset** — from the recommended catalog the app ships. Defined by the app,
  so only the fields the user must supply (a server URL, a token) are editable.
- **Yours** — the user wrote it in the editor, or the agent built it for them.
- **KB** — it came with the knowledge base folder. Visible but not editable in
  Settings; it is changed by editing the file, or by asking the agent.

A second tag, **MCP** or **Extension**, appears only on rows backed by a live
connection.

## Where each is stored

**In the browser** (`localStorage`, key `browser-md:settings`):

- which catalog presets are installed
- the tools the user wrote or the agent built for them
- every MCP server address and token
- API keys

These follow the browser, not the folder. They survive switching knowledge
bases, and they are lost if the user clears site data. There is no account and
no server, so they are not synced anywhere.

**In the knowledge base folder:**

- `.agents/tools.json` — the KB's own tools
- `.agents/mcp.json` — the KB's own MCP servers

These travel with the folder through git, so anyone who clones the repository
gets them.

## Switching knowledge base

Everything tagged KB is replaced by whatever the newly opened folder carries —
its tools and servers, or none at all. Everything else (presets, the user's own
tools, their servers, their keys) is untouched.

A folder's tools stay inert until the user approves them once. Changing which
tools it defines, or where they send data, asks again. The approval is recorded
per KB in `localStorage` under `browser-md:kb-tools-trust:v1`, as a fingerprint
of the tool set rather than a blanket "trusted" flag.

## The browser constraint

This app has no backend. A tool's request is made by the browser itself, so an
API that sends no CORS headers cannot be called directly, however correct the
spec is.

That is what the WebCLI extension is for: its `fetch_url` runs in a service
worker with the user's real cookies and no CORS limit, so it reaches endpoints
the page cannot. A tool's `transport` chooses the path — `auto` tries direct
then falls back, `direct` and `webcli` force one. Catalog entries that only work
through the extension are marked in the recommended list (arXiv is one — it
sends no `Access-Control-Allow-Origin`).

## Things that trip people up

- **A parameter cannot span path segments.** `{{repo}}` given `vuejs/core` is
  sent as `vuejs%2Fcore`. This is deliberate — it is what guarantees a tool only
  ever talks to the host the user approved — but it means one parameter per
  segment: `/repos/{{owner}}/{{repo}}`.
- **The host cannot contain a placeholder**, for the same reason.
- **Response shaping is not optional in practice.** A raw JSON payload can cost
  thousands of tokens per call. `mode: json` with a `pick` and a `template`
  turns it into a few lines.
- **Tool names are global.** A KB tool, a user tool and a preset all share one
  namespace; on a clash the more specific scope wins (KB, then user, then
  catalog).

## Related

Keys and what the model can see: `keys`. Where everything the app stores lives:
`storage-and-privacy`.
