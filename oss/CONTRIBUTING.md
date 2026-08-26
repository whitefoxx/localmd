# Contributing

Issues and pull requests are welcome. This is a solo project, so replies may be
slow — that is a bandwidth limit, not disinterest.

## Where things go

Here — bug reports, feature requests, questions and patches all belong on this
repository's issues. There is no second tracker to guess between.

(The hosted build at localmd.app has its own, at
[localmd.app-feedback](https://github.com/whitefoxx/localmd.app-feedback), for
reports about that deployment specifically — its trial, its licence, its
uptime. Anything about the software itself belongs here.)

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npx vitest run
npm run test:e2e   # Playwright against system Chrome
```

Chrome or Edge only — the File System Access API this is built on exists
nowhere else.

## Before a pull request

**Read `CONTEXT.md` first.** It is the glossary: "index", "session", "slot",
"bundled", "connection" and a dozen other words mean specific things here, and a
patch that quietly redefines one costs more to review than it saves. `AGENTS.md`
carries the working agreements — worth a skim, and worth handing to a coding
agent if you use one.

Then, in rough order of how often each one comes up:

- **Everything is English.** Code, identifiers, comments, docs, commit messages
  and LLM prompts, regardless of what language the issue was discussed in. The
  only intentional Chinese in the tree is the `zh` half of the i18n catalogs and
  the CJK fixture data in `src/lib`.
- **Every UI string goes through `t('ns.key')`**, with both `en` and `zh`
  entries. Tests enforce catalog parity, so a missing translation is a red
  build, not a silent gap.
- **A user-visible change is not finished until `docs/app/*.md` matches it.**
  Those files are the user manual, served both by the in-app Help panel and to
  the agent through `app_help`. English is canonical; edit it first, then the
  translation, then run `npm run docs:sync`. A stale doc is a bug of the same
  severity as stale code — it tells users something false and teaches the agent
  to repeat it.
- **Verify browser-facing work in a browser.** typecheck and vitest cannot see
  the three things this app actually lives on: CORS, the extension transports,
  and the File System Access API. Before claiming a feature works, click the
  path a user would.
- **Some things are format contracts, not code.** `src/lib/docindex` carries a
  hard invariant — a block id, once published, always resolves to the same
  passage, because people's notes cite those ids. A red golden test there means
  "bump BUILDER and check inheritance", never "regenerate to green". The `raw/`
  capture routing table and the localStorage / IndexedDB key names are the same
  kind of thing: existing knowledge bases and browsers were organized by them.
- **Commit in stages, one concern per commit.** Say why in the message, not just
  what; the diff already says what.

## Sign your commits off (DCO)

Add a sign-off line to each commit:

```bash
git commit -s -m "..."
```

which appends `Signed-off-by: Your Name <your@email>`. It certifies the
[Developer Certificate of Origin](https://developercertificate.org/) — in short,
that you wrote the patch or otherwise have the right to submit it under this
project's licence. It is a statement about provenance; it asks nothing of you
beyond that.

Contributions are licensed under the MIT terms in [LICENSE](LICENSE), the same
as the rest of the repository. [TRADEMARK.md](TRADEMARK.md) covers the one thing
the licence does not: the name.

## The two editions

`src/edition/` is the seam between this build and the hosted one at
localmd.app — three small files, and no other code in the tree knows which build
it is in. If a patch needs core code to ask which edition it is running as, the
seam is missing something; extend the seam rather than adding the branch.
