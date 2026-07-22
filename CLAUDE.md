# browser-md — working agreements

Principles for anyone (human or agent) working in this repo. CONTEXT.md is the
glossary — read it before renaming or reinterpreting a concept ("index",
"session", "slot", …).

## Language

**This is an English repo.** Code, identifiers, comments, docs, commit
messages, and LLM prompts are written in English by default — regardless of
the language the task was discussed in — unless explicitly asked otherwise.
The only intentional Chinese in the tree: the `zh` values in i18n catalogs
(`src/i18n/locales/*`), `LOCALE_NAMES`, and the CJK regex/fixture data in lib
(annotations / markdown / tts / pdf extraction).

## Product principles

- **The KB is a soft constraint.** Every convention — layout, frontmatter,
  linking — is a suggestion the agent follows and recommends, never a
  validation gate. Users hand-edit, move, and delete files outside the app;
  nothing may break or nag when they do.
- **The user's structure wins.** The `raw/` + `wiki/` layout is only the
  scaffold offered for brand-new empty KBs. Opening an existing folder must
  never graft our layout onto it: automatic writes land in a neutral `inbox/`
  when the KB has no `raw/` tree, and the agent files content according to the
  user's own organization. AGENTS.md is where a KB's structure is described —
  offer to write one that documents *their* layout; don't impose ours.
- **Minimal and manual over clever and automatic.** Prefer a manual action +
  a native dialog over background automation; prefer deterministic tools
  (kb_health) over LLM passes; confirm before token-heavy operations. Ship the
  simplest manual version first.
- **Tool-neutral KB.** KB-facing conventions live in AGENTS.md / `.agents/`
  (open formats), never vendor-specific directories.

## Hard compatibility constraints

- doc-index is byte-compatible with trace-app: `.trace/*-index/` layout,
  INDEX_VERSION 11 (PDF) / 3 (EPUB) — never bump casually.
- The `raw/` capture routing table (`rawSubdirFor` in src/lib/capture.ts)
  matches trace-app byte-for-byte.
- Browser-only: no backend. LLM endpoints must allow CORS from the browser;
  all file access goes through the File System Access API.

## Dev workflow

- `npm run dev` · `npm run typecheck` · `npx vitest run` · `npm run build` ·
  `npm run test:e2e`
- e2e runs ONLY through Playwright (`npm run test:e2e`) — never open `?e2e=1`
  in a real browser profile.
- Every UI string goes through `t('ns.key')` with both `en` and `zh` entries
  (tests enforce catalog parity and key existence).
- Commit in stages, one concern per commit; ask before committing.
