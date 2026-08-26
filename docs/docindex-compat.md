# Doc-index compatibility: how the index survives its own improvement

Written when the first algorithm-upgrade machinery landed (2026-08). The
binding requirement, set before any of it was designed:

> Improving the indexing algorithm must never strand an existing index or
> re-point an existing citation. A user may decline to rebuild forever and
> lose nothing but the improvements.

## The invariant

**A block id, once published, always resolves to the same passage.**

Ids look positional (`b14-3` = 3rd block on page 14) and originally were:
rebuilds renumbered whatever the grouper produced, so any change to grouping
silently re-pointed every citation users had written into their notes — each
one still resolving *successfully*, just to the wrong paragraph, with no
signal to anyone. That is the worst failure mode this design exists to make
impossible. The page prefix stays meaningful; the ordinal is a **name**, and
names are never reassigned.

## Two revision numbers, two jobs

`INDEX_VERSION` (11 PDF / 3 EPUB / 1 MD / 1 DOCX) is the **read contract**:
what a reader must understand to use the directory. It strands every index on
disk when bumped, so it is expected never to move again. The constraint is
owed to existing KBs and to the block ids their notes already cite.

`builder` (manifest field, per-kind constant) is the **algorithm revision**.
Bump it whenever the pipeline's published output changes — block boundaries,
ids, kinds, text. It invalidates nothing: an older-builder index reads as
`outdated` (`indexState` in `src/lib/docindex/index.ts`), stays fully usable,
and the viewers offer an *Update index* badge. Only the user's click — or an
explicit `rebuild: true` on the `index_document` tool — rebuilds. A manifest
without the field predates the split and reads as builder 1.

Rule of thumb: changed what the files SAY → bump `builder`; changed how a
reader must PARSE them → that is an INDEX_VERSION conversation, and a
migration story is owed first.

## Id inheritance (`pdf/inherit.ts`)

When a rebuild runs over the SAME source bytes (contentHash equal), the prior
`locations.json` rects are still valid coordinates in that very PDF —
geometry is ground truth, no LLM involved:

- each new block takes over the prior id whose rects it overlaps best
  (same page only; greedy best-match; containment counts as full overlap, so
  split halves still find their parent);
- prior ids no new block claims are **carried forward verbatim** — the
  passage still exists at those coordinates, so old citations keep landing;
  the id just stops appearing in the freshly rendered sections;
- genuinely new blocks get ordinals above the page's all-time high-water
  mark, so a retired ordinal is never recycled for different text.

Consequences worth knowing: `locations.json` is a superset of every build's
ids and only grows; ordinals may have gaps and need not follow reading order;
an unchanged algorithm inherits every id onto itself, so a forced rebuild is
an id-level no-op.

Residual holes, stated rather than papered over:

- deleting `.trace/` deletes the id record itself — the next build numbers
  from scratch, and if the algorithm changed in between, citations scramble;
- replacing the PDF's content invalidates the geometry — inheritance is
  correctly refused (hash mismatch) and ids restart; kb_health's
  source-outran-the-page check is the backstop;
- EPUB/DOCX/MD have **no inheritance yet**. Their `BUILDER` constants carry a
  comment forbidding a first bump until they do (EPUB needs spine + text
  matching; geometry is PDF-only).

## Crash-safe writes (`util.ts` writeAll)

The browser is closed whenever the user likes, so a rebuild must be killable
at any byte. Order: overwrite/add new files (each write atomic via the
File System Access swap-file) → write `manifest.json` alone, last — its
presence is what `hasIndex` reads as "complete", and it must never vouch for
files not yet written → only then delete files the new build no longer
produces. A crash leaves either the old index intact or the new index plus
harmless orphans (swept by the next successful rebuild) — never a manifest
that lies, and never a moment without a `locations.json` (which would break
the inheritance chain).

## Enforcement

- `src/lib/docindex/contract.test.ts` pins the INDEX_VERSION values, the
  id syntax, and that parsePdf actually consults inheritance.
- `src/lib/docindex/pdf/golden.test.ts` replays six pages of real prose
  (Fed 2023 annual report, public domain, RawItem fixtures) through the real
  pipeline and compares against committed output. **A red golden test means
  the published output changed**: bump `builder`, satisfy yourself
  inheritance carries the old golden's ids, then regenerate with
  `UPDATE_GOLDEN=1`. Regenerating to silence it skips the entire mechanism.

## Measurements (2026-08, PageIndex example corpus)

### Builder 2 (boilerplate + relative levels + spread boundaries)

What the first algorithm bump changed, same corpus, re-measured:

| document | branch | sections | notes |
|---|---|---:|---|
| earthmover | pages → **headings** | 12 → 8 | the fix target: 1.11× section headings now rank; real structure |
| four-lectures | headings → headings | 53 junk → **4** | degenerate-metrics guard + numbering-only fallback |
| fed-2023-truncated | headings → headings | 12 → 7 | chapter-grain boundaries (max section grew to 55k — rebalance target) |
| q1-fy25-earnings | pages → pages | 22 → 22 | tables; per-page honestly right |
| all outline docs | outline → outline | unchanged | zero regression (43/132/268/8/16 sections identical) |

Golden diff at the bump: identical block set (233), identical ids (0
lost / 0 gained), 3 running headers re-kinded boilerplate, heading levels
went from a 2-step absolute split to ranked 1/2/3. The demo index was
regenerated THROUGH inheritance (buildDemoIndex seeds the published
locations.json before rebuilding) — all 1357 published ids carried, demo
note citations verified clicking through in the browser.

### Builder 1 baseline

The original pipeline over nine real PDFs — kept for comparison. `branch`
is `pickStructure`'s choice; section chars are per-section extracted text.

| document | pages | blocks | outline | L1-heading pages | branch | sections | section chars (min/med/max) |
|---|---:|---:|---:|---:|---|---:|---|
| attention-residuals | 21 | 1,034 | 22 | 1 | outline | 16 | 0.6k / 3.7k / 17.5k |
| earthmover | 12 | 1,530 | 0 | 1 | pages | 12 | 3.9k / 6.4k / 7.4k |
| four-lectures | 53 | 8,075 | 0 | 53 | headings | 53 | 0.0k / 1.7k / 3.3k |
| q1-fy25-earnings | 22 | 979 | 0 | 0 | pages | 22 | 0.3k / 1.8k / 4.1k |
| fed-2023-truncated | 50 | 1,176 | 0 | 12 | headings | 12 | 0.1k / 7.3k / 45.1k |
| fed-2023-full | 222 | 14,736 | 50 | 103 | outline | 43 | 0.0k / 8.1k / 80.5k |
| reg-BI interpretive | 28 | 747 | 10 | 0 | outline | 8 | 1.4k / 10.3k / 12.0k |
| reg-BI proposed rule | 408 | 10,430 | 162 | 0 | outline | 132 | 1.5k / 5.2k / 27.0k |
| PRML | 758 | 20,914 | 285 | 53 | outline | 268 | 1.0k / 4.8k / 59.5k |

What these numbers said, and what became of it (builder 2 addressed the
first two; the third is the open target):

- the `pages` fallback was real — papers without an embedded outline
  (earthmover, q1-earnings) landed there → fixed for prose docs by relative
  levels + spread boundaries; tables (q1) stay per-page, correctly;
- heading detection over-fired on degenerate metrics (four-lectures: an "L1"
  on all 53 pages — line heights of 3.5 vs 1.5 with the median between
  them) and under-fired on close ratios (earthmover: 1.11× headings under
  the old 1.18 floor) → degenerate guard + CANDIDATE_FLOOR 1.08 + ranking;
- big documents still produce sections near the 100k read cap (fed-full
  80.5k, now 55k in the truncated cut too) — the section-rebalancing idea
  (PageIndex's merge/expand cost model, minus the LLM) remains the next
  measured target.

The harness lives in the session scratchpad (`measure.ts`, esbuild-bundled,
pdfjs-dist legacy under Node); it hand-mirrors `pickStructure`/`buildSections`
and will drift if those change — regenerate against `layout.ts` exports when
rerunning.
