/**
 * What separates the two editions, in one auditable list.
 *
 * A `.mjs` and not JSON so every entry can say WHY it is here. This file is the
 * thing a person reads before an export; the script below it is just machinery.
 *
 * The rule the list obeys: an entry belongs here only if the open-source build
 * cannot have it — because it needs a server, a private key, or a price. Code
 * that merely mentions the paid tier stays; `src/edition/` is what makes it
 * answer differently. See CONTEXT.md, "Edition".
 */

/**
 * Paths dropped from the export. Directories end in `/`.
 *
 * Every entry must exist at HEAD; a stale one aborts the export rather than
 * being skipped, because a list that silently tolerates dead entries is a list
 * nobody can trust to be complete.
 */
export const EXCLUDE = [
  // ── Needs a server we run ────────────────────────────────────────────────
  // The trial proxy (our upstream key, our budget) and the early-slot counter.
  'api/',

  // ── Needs the private signing key ───────────────────────────────────────
  'scripts/sign-key.mjs', // issues licence keys; reads ~/.localmd/signing-key.pem
  'public/claim.html', // the claim link's landing page; writes a key into settings
  'src/lib/claimPage.test.ts', // pins claim.html against the settings store

  // ── Is the paid tier ────────────────────────────────────────────────────
  'src/lib/licence.ts',
  'src/lib/licence.test.ts',
  'src/stores/licence.ts',
  'src/lib/trial.ts',
  'src/lib/trial.test.ts',
  'src/lib/pricing.ts',
  'src/lib/pricing.test.ts',
  'src/components/PricingDialog.vue',
  'src/components/PricingBlock.vue',
  'src/components/settings/LicenceSection.vue',
  'tests-e2e/licence.spec.ts',

  // ── Describes one deployment, not the software ──────────────────────────
  // Marketing copy for an LLM crawler, naming a price, a trial and an address
  // that belong to the hosted build. The overlay's index.html replaces the
  // matching <head> — see oss/index.html for why it carries none of it.
  'public/llms.txt',
  // Names our address in its header, points crawlers at an /llms.txt this
  // build does not ship, and disallows a /claim.html it does not have. A
  // robots.txt is a statement about one site; served from a fork's domain it
  // is three wrong statements. Chromium hosts serve none by default and
  // crawlers read that as allow-all, which is the right answer here.
  'public/robots.txt',
  // The social card for that same <head>, and the two files that generate it.
  // With no og:/twitter: tags to point at it, all three are orphans. (The
  // landing page's own images are NOT here: those are imported by the app.)
  'public/og.png',
  'scripts/og.html',
  'scripts/shoot-og.mjs',

  // ── Is ours, not the project's ──────────────────────────────────────────
  // Working agreements that point at a private knowledge base and a launch
  // plan. The open-source repo gets its own; see oss/README.md.
  'CLAUDE.md',
  'docs/TODO.md', // internal planning, in Chinese, half of it already shipped

  // ── Is the export itself ────────────────────────────────────────────────
  // The overlay's contents are already at their destination by the time this
  // runs, and a repository has no business carrying the machinery that
  // produced it. Nothing here is secret — un-exclude them if publishing the
  // list ever seems more useful than not, and the leak gate will then have
  // opinions about the patterns they contain, which is the right conversation
  // to be forced into.
  'oss/',
  'scripts/export-oss.mjs',
  'scripts/oss-manifest.mjs',
  'docs/oss-export.md', // the runbook for the above, and a log of our exports
]

/**
 * Strings that must not survive into the export, checked over every text file
 * after the overlay is applied.
 *
 * The gate is a backstop for the list above, not a substitute: it catches a new
 * hosted-only file nobody remembered to exclude, and it catches a secret pasted
 * where one should never be. It cannot catch a hosted-only file that happens to
 * mention nothing.
 */
export const FORBID = [
  {
    pattern: /Js5J1N9CivdUlC8u2iGY29Viu3y3thVMlvTtkq2qhdE/,
    why: 'the licence signing key’s public half — harmless to publish, but its presence means a licence module came along',
  },
  {
    // Deliberately NOT a bare /LMD1/: `licencePlaceholder: 'LMD1.…'` is an i18n
    // string, and the catalogs ship whole on purpose (stripping them would mean
    // editing two locale files on every export and racing the parity test).
    // What must never appear is a key — three dot-separated base64url segments.
    pattern: /LMD1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/,
    why: 'an actual licence key',
  },
  { pattern: /TRIAL_UPSTREAM_KEY|TRIAL_SIGNING_SECRET/, why: 'trial server secrets' },
  { pattern: /UPSTASH_REDIS_REST_TOKEN|KV_REST_API_TOKEN/, why: 'trial store credentials' },
  { pattern: /signing-key\.pem/, why: 'the private key’s path' },
  // Any mention, not just a call: shared code that names an address only one
  // edition can reach is already carrying that edition around, whether or not
  // it dials it. Both hits this caught on its first run were comments and a
  // test fixture, and both were worth fixing at the source.
  { pattern: /api\/trial\//, why: 'the trial endpoint, which this build does not have' },
  { pattern: /\/api\/slots/, why: 'the slot counter, which this build does not have' },
  { pattern: /gist\.githubusercontent\.com/, why: 'the slot-count gist' },
  { pattern: /tally\.so/, why: 'the early-access form' },
  { pattern: /sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}/, why: 'an API key' },
  // Also the check that `removeDeps` below actually worked: package.json and
  // the lockfile are text files like any other, so a dependency that failed to
  // come out is caught here rather than by a reader of the public repo.
  {
    pattern: /@vercel\/analytics/,
    why: 'the hosted build’s page-view counter — this edition reports nothing, and says so by not depending on it',
  },
]

/**
 * Fields rewritten in package.json. Deliberately a patch and not a whole file:
 * a second package.json in the overlay would drift from the dependency list on
 * the first `npm install` here and nobody would notice until an export failed.
 */
export const PACKAGE_PATCH = {
  set: {
    name: 'localmd',
    license: 'MIT',
    description: 'An AI knowledge base that runs in your browser and your local folder.',
    repository: { type: 'git', url: 'git+https://github.com/whitefoxx/localmd.git' },
    homepage: 'https://localmd.app',
  },
  /** Scripts whose file the export drops. */
  removeScripts: ['sign-key', 'shoot:og'],
  /**
   * Dependencies this edition has no importer for, because the only file that
   * imported one is replaced by the overlay.
   *
   * Dropped from the lockfile too, and that is the point rather than tidiness:
   * someone auditing what this build talks to reads the dependency list, and a
   * package that is installed but unused answers that question wrongly. "It
   * reports nothing" should be checkable without reading every module.
   */
  removeDeps: ['@vercel/analytics'],
}
