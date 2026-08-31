# Exporting the open-source edition

How the public repository at `github.com/whitefoxx/localmd` is brought up to
date with this one.

This is not a merge. The two repositories share no history: the public one is a
squashed snapshot, re-synced from a commit here. There is no branch to merge, no
conflict to resolve, and nothing in the public repo is ever authored directly —
its working tree is replaced wholesale on every export. **Anything committed
only there is lost at the next export**, which is why the script refuses to run
against a dirty target.

Read `scripts/oss-manifest.mjs` first. It is the list of what separates the two
editions and it says why for each entry; the script under it is just machinery
that carries the list out.

## The command

```bash
node scripts/export-oss.mjs --to ../localmd-oss --e2e
```

`--to` is the public checkout. `--e2e` runs Playwright against the export on
port 5199 and is what makes this a release-grade run rather than a smoke test —
see "Why e2e is not optional" below. Other flags:

| | |
|---|---|
| `--replace` | redo an export the target has staged but not committed |
| `--fast` | borrow this repo's `node_modules` instead of `npm ci` — iteration only, not hermetic |
| `--commit "msg"` | commit in the target after a clean run (never pushes) |
| `--keep` | leave the temp tree behind |

Both repositories must be clean before it will run. The source is
`git archive HEAD`, never the working tree — an export names a commit, and a
tree with uncommitted edits in it cannot be pointed at anything.

Nothing is ever pushed. The script prepares the target's working tree and stops.

## What actually takes the time

Not the export. The export is a script. What takes the time is **the drift
check** — the private repo has moved, and the handful of files that stand in for
their private counterparts have not moved with it. Those files are invisible to
every test in this repo, because this repo never builds with them.

Before running the export, look for drift in these six places, in this order.

### 1. The overlay has fallen behind the files it replaces

`oss/` holds a substitute for each file the open-source edition answers
differently. A substitute only stays correct as long as its private counterpart
does not change shape.

```bash
LAST=<commit of the previous export>
git log --oneline $LAST..HEAD -- src/edition/ src/lib/links.ts index.html CLAUDE.md
```

Then, for each overlay file, compare its **exported surface** against the private
one — not its prose:

```bash
for f in oss/src/edition/*.ts; do
  n=$(basename $f)
  diff <(grep -oE 'export (const|function|interface|type) [A-Za-z_]+' src/edition/$n | sort) \
       <(grep -oE 'export (const|function|interface|type) [A-Za-z_]+' $f | sort) \
    && echo "$n ok"
done
diff <(grep -oE 'export const [A-Z_]+' src/lib/links.ts | sort) \
     <(grep -oE 'export const [A-Z_]+' oss/src/lib/links.ts | sort)
```

A missing *name* is real drift, and a typecheck failure in the export. A
differing *keyword* is not: `gate.ts` declares `restrictedToolResult` as a
`const` in one edition and a `function` in the other, which the grep reports
and TypeScript does not care about, because the call signature is what crosses
the seam. A missing *non-code* element may not show up here at all — see the
next item.

### 2. A build step depends on something only the private file has

`oss/index.html` replaces `index.html` entirely, so it has to carry everything
the build reads out of that file — not just the metadata it deliberately drops.
`staticLandingCopy` in `vite.config.ts` throws when the `<noscript>` marker is
missing, and that failure surfaces at **build**, after typecheck and vitest have
both gone green. That ordering is the reason the export builds rather than
merely typechecking.

When you change `index.html`, ask what in the build reads it, and whether the
overlay still satisfies that.

### 3. Shared code has started naming one deployment

The sharpest class, because nothing fails. Code that both editions compile can
still bake in an address, a page or an asset that only the hosted build has, and
it will ship to every fork quietly.

```bash
git diff $LAST..HEAD -- src/ vite.config.ts index.html | grep -nE '^\+.*(localmd\.app|llms\.txt|claim\.html|og\.png)'
```

The fix is never a branch on which edition it is. Either make it relative (a
path is right wherever the build is served), take it from the seam in
`src/lib/links.ts`, or let the edition answer by what it contains — the
`llms.txt` link is emitted only by a build that ships an `llms.txt`, which needs
no knowledge of editions at all.

### 4. A new file describes the deployment rather than the software

Every file added since the last export is a candidate for `EXCLUDE`:

```bash
git diff --name-status $LAST..HEAD | grep '^A'
```

The test is the manifest's own: **can the open-source build have this?** A file
needing a server, a private key or a price cannot. Neither can one that makes
claims true only of `localmd.app` — `robots.txt` was excluded for saying three
things a fork's domain would make false.

Code that merely *mentions* the paid tier stays. `src/edition/` is what makes it
answer differently, and the i18n catalogs ship whole on purpose.

### 5. A dependency is now only one edition's

If the overlay replaces the only file that imported a package, the package
should leave `package.json` and the lockfile too — `PACKAGE_PATCH.removeDeps`
does both. This is not tidiness: someone auditing what the build talks to reads
the dependency list, and a package installed but unused answers that question
wrongly. `@vercel/analytics` is the standing example.

The reverse also holds. Before adding a vendor import to core, ask whether both
editions want it; if only one does, it belongs behind `src/edition/`, which is
what makes the overlay sufficient and the dependency removable.

### 6. The working agreements have diverged

`oss/AGENTS.md` is a rewrite of `CLAUDE.md`, not a copy — it drops what is ours
(the build-in-public section, the private knowledge base) and adds an "Editions"
section that has no private counterpart. So changes to `CLAUDE.md` do not flow
through; they are carried over by hand, or not at all.

```bash
git log --oneline $LAST..HEAD -- CLAUDE.md
```

Carry over anything that is an agreement about **the software**. Leave anything
about who sells it, or where our own notes live.

## Why e2e is not optional here

`--e2e` costs about two and a half minutes and is the only check that sees the
things this app lives on: the File System Access API, CORS, the extension
transports. Two specs in this repo sat red for three days with typecheck and
vitest green over them the whole time. An export is precisely the moment that
matters — it is the last gate before code leaves the machine, and the public
repo's history is the wrong place to discover a stub has drifted.

`npm ci` (i.e. *not* `--fast`) is the second half of that: it proves a
contributor can install the tree as published.

## After a clean run

The export stages the target and stops. Read the diff before anything else:

```bash
git -C ../localmd-oss diff --cached --stat
git -C ../localmd-oss diff --cached --name-status | grep -E '^(A|D)'
```

Additions should be exactly this repo's new files minus the manifest's new
exclusions. **Deletions deserve a second look** — a file disappearing from the
public repo is either a deliberate new `EXCLUDE` or a file someone deleted here,
and the diff does not say which.

Then a standalone audit, independent of the script's own gate:

```bash
cd ../localmd-oss
ls src/lib/licence.ts src/stores/licence.ts src/lib/trial.ts src/lib/pricing.ts \
   public/claim.html public/llms.txt api 2>&1 | grep -v '^ls:'   # expect no output
grep -rniE 'api/trial|/api/slots|tally\.so|signing-key|sk-[A-Za-z0-9]{20,}' src/ public/
```

If the change touched the landing page or `index.html`, build the export and read
the output rather than trusting that the build exited zero — a build that
succeeds still tells you nothing about *what* it emitted:

```bash
ln -sfn ../localmd/node_modules node_modules && npx vite build
grep -o '<a href="[^"]*">[^<]*</a>' dist/index.html | tail -4
grep -c 'localmd\.app' dist/index.html        # expect 0
rm -rf dist node_modules
```

## Committing

The public repo's history is written for a reader who has never seen this one,
so its commits are not this repo's commits. Summarize the release; do not
replay 40 subjects, and do not reference commits or files that exist only here.

```bash
git -C ../localmd-oss commit -m "<what changed for a reader of that repo>"
git -C ../localmd-oss push
```

The script does not push, and neither should anything automated. What leaves the
machine is a person's decision made after reading a diff.

## When the export fails

It fails before touching the target, always — the verification runs in a temp
tree, and the sync is the last step. A failed export leaves the public checkout
exactly as it was.

| Failure | What it means |
|---|---|
| `manifest lists "X", which is not in the tree at HEAD` | a file was renamed or deleted here; fix the manifest entry rather than dropping it |
| `Module '@/lib/links' has no exported member …` | overlay drift — case 1 above |
| `staticLandingCopy: no <noscript> block found` | overlay drift in `index.html` — case 2 |
| leak gate hit | either the file belongs in `EXCLUDE`, or the value should never have been written down |
| `package.json has no "X" script to remove` | `PACKAGE_PATCH.removeScripts` is stale |
| `package.json has no "X" dependency to remove` | `PACKAGE_PATCH.removeDeps` is stale |
| `X is still required by …` | something else in the lockfile needs a dependency `removeDeps` drops; take it out of the list |

## Log

Record each export here, so the next one has a `$LAST` to diff against.

| Date | From | Notes |
|---|---|---|
| 2026-08-26 | `5e2607b` | first publication |
| 2026-08-31 | `6a330d7` | Analytics became an edition question. `@vercel/analytics` left the open-source build entirely — seam, `package.json` and lockfile — so "this build reports nothing" is checkable from the dependency list rather than by reading modules. `removeDeps` is the new machinery; a FORBID pattern proves it each time, and caught prose in `oss/README.md` explaining the absence by name on the first run. |
| 2026-08-31 | `1a734d9` | 43 commits. Four kinds of drift, one of each: `CONNECT_STORE_URL` missing from the overlay's links seam (typecheck), the `<noscript>` marker missing from `oss/index.html` (build), `staticLandingCopy` hardcoding `localmd.app` into every fork's landing page (silent), and `robots.txt` newly excluded. The first three were fixed in this repo, not worked around in the export. |
