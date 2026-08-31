# localmd

**An agent lives in your folder, a wiki grows around your files.** It reads
the PDFs, EPUBs and notes already there and writes linked Markdown beside
them — every citation clicks back to the exact paragraph, and every change
waits for your yes.

### ▶ [Try it now](https://localmd.app) — no install, no account, no key

It is a web page. Open it, click **Try the demo**, ask a question
about a real 43-page paper, then click a citation and land on the paragraph it
came from. Nothing to clone first; come back here if you like it.

---

There is no backend. The app is a static page: it reads and writes your files
through the File System Access API, and it talks to whichever model provider you
gave it a key for. Nothing is uploaded, because there is nowhere to upload to.

**That last sentence is the reason this repository exists.** "Your files are not
uploaded" is a claim, and claims about privacy are worth exactly as much as your
willingness to take someone's word for it. Here you can read the code, run it
yourself, and watch the network tab — and this build has nothing to see there:
no analytics, no page-view counter, no dependency that could carry one. Every
feature the hosted build has is in here; what is not is the free trial, which
spends our API budget and needs a server to meter it. See
[Two editions](#two-editions).

Bugs and ideas → the [issues](https://github.com/whitefoxx/localmd/issues) on
this repository.

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

`npm run build` writes a folder of static files. Serve it over https from
anywhere that serves static files — there is nothing to configure, no
environment to set and no server to keep running. `netlify.toml` is included so
Netlify does not have to guess the build command; every other host wants
`npm run build` and `dist`.

(No Dockerfile, on purpose: a container whose whole job is serving a folder of
files is more moving parts than a build plus any static host, not fewer.)

Deploying it is yours to run. Bug reports about the app are welcome in the
issues; "my host is not serving it" is a question about your host, and this is a
solo project with no support commitment behind it.

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

The hosted build at [localmd.app](https://localmd.app) adds four things that
have no business in a copy you run yourself — a free trial that spends our API
budget, a paid tier, a browser extension published under our name, and an
anonymous page-view count for that one deployment. The first three are what
pays for the work; the last is why `@vercel/analytics` is absent from this
repository's `package.json` rather than merely unused in it. The core is free forever either way; running your own copy is a fully
supported way to use localmd, and if you do, everything works.

`src/edition/` is the seam where the two differ — four small files, and no
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
"localmd" or its logo, which identify the hosted service at localmd.app; see
[TRADEMARK.md](TRADEMARK.md). Fork freely — please give your copy its own name.
