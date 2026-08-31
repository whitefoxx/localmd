/**
 * Whether this build reports anything — it does not.
 *
 * No page view, no events, and no analytics dependency in `package.json` to
 * check that claim against: the export drops it, so "this build talks to
 * nobody" is something you can confirm from the dependency list rather than
 * take on trust. See CONTEXT.md, "Edition".
 *
 * The seam is here rather than in `src/lib/analytics.ts` so that the rules
 * about what would be worth counting stay shared and readable — a build that
 * reports nothing keeps them and drops the transport, instead of deleting the
 * rules and leaving the next person to reinvent them.
 *
 * If you deploy this and want your own numbers, this is the file to fill in.
 * `docs/app/storage-and-privacy.md` is where your users are told what leaves
 * their machine, and it currently says nothing does — so change it there in
 * the same commit.
 */

export function startReporting(): void {}

export function reportEvent(_name: string): void {}
