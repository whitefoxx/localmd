# localmd

**An AI knowledge base that runs in your browser and your local folder. Open a
URL, pick a folder, start thinking — nothing to install.**

There is no backend. The app is a static page: it reads and writes your files
through the File System Access API, and it talks to whichever model provider you
gave it a key for. Nothing is uploaded, because there is nowhere to upload to.

Hosted at **[localmd.app](https://localmd.app)** · bugs and ideas →
[localmd-feedback](https://github.com/whitefoxx/localmd-feedback)

## What it does

- **Markdown, in a folder you already have.** File tree, editor, preview,
  `[[wikilinks]]`, backlinks, a force-directed graph, full-text search. It
  adapts to your folders, not the other way round. There is no import, because
  there is no format to import into.
- **An agent that works in your files.** It lists, reads, searches, writes and
  edits, with a review panel that shows every change as a diff before or after
  it lands. Bring a key for Anthropic, OpenAI, DeepSeek, Gemini, xAI, Groq,
  Qwen, GLM, Kimi, MiniMax, or any OpenAI-compatible endpoint.
- **PDFs and EPUBs with citations that click back.** Documents are parsed into a
  block-level index, so when the agent quotes a source it writes a token that
  renders as a chip — click it and you land on that paragraph, highlighted.
- **Version history that is just git.** isomorphic-git in the browser, writing a
  real `.git` your terminal understands. Optional sync to GitHub over the REST
  Git Data API (git's smart-HTTP has no CORS, so mirroring objects is the way a
  page can do this at all).
- **Tools are data, not code.** Web search ships with it. Beyond that, you or
  the agent can author an HTTP tool against any API, or connect an MCP server —
  a spec, not a release.
- **Installable and offline.** It is a PWA; everything is cached on your device.

## Requirements

**Chrome or Edge.** The File System Access API — the thing that lets a web page
read and write a folder you picked — exists only in Chromium browsers. Firefox
has called it harmful; Safari offers only a sandboxed store. That constraint is
also the reason this can be a web page at all rather than an app you install.

You supply your own API key. It is kept in your browser and sent straight to the
provider you chose, never through us — there is no "us" in the request path. Be
precise about what that means: your files stay in your folder, and the text you
send to a model goes to that model's provider.

Custom gateways often refuse browser CORS; the providers' own endpoints work.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static output in dist/ — deploy anywhere with https
npm run typecheck
npx vitest run
npm run test:e2e   # Playwright, drives system Chrome
```

Production needs https: the File System Access API requires a secure context.

## Two editions

This repository is the **open-source edition**, and it is the whole application:
the agent, the tools, the document indexes, git and GitHub sync, MCP servers,
the browser extension bridge. Everything here is free, in both senses.

The hosted build at [localmd.app](https://localmd.app) adds three things that
cannot live in a repository — a free trial that spends our API budget, a paid
tier, and a browser extension published under our name. Those are what pays for
the work. The core is free forever either way; running your own copy is a fully
supported way to use localmd, and if you do, everything works.

`src/edition/` is the seam where the two differ — three small files, and no
other code in the tree knows which build it is in. `CONTEXT.md` explains the
vocabulary.

## Architecture

A static Vue 3 SPA (Vite + Pinia + Tailwind). Reading order for the code:

| | |
|---|---|
| `src/lib/fs.ts` | the File System Access layer: KB-relative paths → handles, atomic writes |
| `src/agent/` | the tool loop, the tool definitions, the system prompt |
| `src/lib/docindex/` | PDF/EPUB/Markdown → block-level indexes, and the id invariant that keeps citations resolving |
| `src/lib/git*.ts`, `src/lib/github.ts` | isomorphic-git over a File System Access adapter; GitHub sync |
| `src/stores/` | Pinia: KB, files, chat sessions, settings, tools, MCP |
| `src/edition/` | the seam described above |
| `docs/` | design notes and post-mortems, including `docs/token-optimization.md` |
| `CONTEXT.md` | the glossary — read it before renaming a concept |
| `AGENTS.md` | the working agreements: what the constraints are and why |

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
for where things go and what a patch needs. [AGENTS.md](AGENTS.md) has the
working agreements behind the code, and is worth handing to a coding agent if
you use one. Security reports go through
[SECURITY.md](SECURITY.md), privately.

## License

MIT — see [LICENSE](LICENSE). The licence covers the code, not the name
"localmd" or its logo, which identify the hosted service. Fork freely; please
pick your own name.
