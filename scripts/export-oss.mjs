#!/usr/bin/env node
/**
 * Export the open-source edition.
 *
 *   node scripts/export-oss.mjs --to ../localmd
 *   node scripts/export-oss.mjs --to ../localmd --commit "v0.2.0"
 *
 *   --replace  redo an export the target has staged but not committed
 *   --e2e      also run Playwright against the export, on port 5199
 *   --fast     borrow this repo's node_modules instead of installing (not a
 *              hermetic check, and it shares vite's cache — iteration only)
 *   --keep     leave the temp tree behind for inspection
 *
 * What separates the editions is `scripts/oss-manifest.mjs` — read that first;
 * this file only carries the list out.
 *
 * Three properties are worth stating, because each one is a decision:
 *
 *   - The source is `git archive HEAD`, never the working tree. An export is a
 *     thing you can point at a commit for, and a tree with uncommitted edits in
 *     it cannot be pointed at anything. Untracked scratch files can never ride
 *     along either, which matters more here than in most scripts.
 *   - Nothing is published. The script prepares the target's working tree and
 *     stops; `--commit` will commit, and no flag will ever push. What leaves
 *     this machine is a person's decision, made after reading a diff.
 *   - It verifies before it copies. The export is typechecked, unit-tested and
 *     BUILT in a temp directory first, so a stub that has drifted from the core
 *     fails here rather than in the public repo's history.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync, cpSync, mkdirSync, symlinkSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { EXCLUDE, FORBID, PACKAGE_PATCH } from './oss-manifest.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : (args[i + 1] ?? '')
}
const has = (name) => args.includes(`--${name}`)

const step = (msg) => console.log(`\n\x1b[1m▸ ${msg}\x1b[0m`)
const note = (msg) => console.log(`  ${msg}`)
const die = (msg) => {
  console.error(`\n\x1b[31m✗ ${msg}\x1b[0m\n`)
  process.exit(1)
}

const git = (cwd, ...a) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

const run = (cwd, cmd, a, env = {}) =>
  execFileSync(cmd, a, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })

/* ── where it goes ────────────────────────────────────────────────────────── */

const target = flag('to')
if (!target) die('need --to <path to the open-source checkout>')
const TARGET = resolve(target)

if (!existsSync(join(TARGET, '.git'))) {
  die(`${TARGET} is not a git checkout. Clone the open-source repo there first.`)
}
if (resolve(TARGET) === REPO) die('refusing to export a repository onto itself')

// A dirty target is either an edit made directly in the public checkout — which
// the sync below would erase without asking — or the last export, not yet
// committed. From here the two are indistinguishable, so the destructive
// reading wins and re-exporting takes an explicit word.
if (git(TARGET, 'status', '--porcelain') && !has('replace')) {
  die(
    `${TARGET} has uncommitted changes.\n` +
      '  If they are a previous export you want to redo, pass --replace.\n' +
      '  If they are edits made in that checkout, commit or discard them first —\n' +
      '  the export replaces its working tree.',
  )
}

/* ── what goes ────────────────────────────────────────────────────────────── */

if (git(REPO, 'status', '--porcelain')) {
  die('this repository has uncommitted changes. An export names a commit; commit or stash first.')
}
const HEAD = git(REPO, 'rev-parse', '--short', 'HEAD')
const SUBJECT = git(REPO, 'log', '-1', '--pretty=%s')

const work = mkdtempSync(join(tmpdir(), 'localmd-oss-'))
const TREE = join(work, 'tree')
mkdirSync(TREE)
process.on('exit', () => {
  if (!has('keep')) rmSync(work, { recursive: true, force: true })
})

step(`Exporting ${HEAD} (${SUBJECT})`)

/* 1. the tracked tree at HEAD, and nothing else */
const tar = join(work, 'head.tar')
git(REPO, 'archive', '--format=tar', '-o', tar, 'HEAD')
run(work, 'tar', ['-xf', tar, '-C', TREE])
note(`git archive HEAD → ${TREE}`)

/* 2. drop what the open-source edition cannot have */
step('Excluding')
for (const path of EXCLUDE) {
  const abs = join(TREE, path)
  if (!existsSync(abs)) {
    die(`manifest lists "${path}", which is not in the tree at HEAD.\n  A stale entry means the list is no longer describing this repo — fix it rather than skipping it.`)
  }
  const isDir = statSync(abs).isDirectory()
  rmSync(abs, { recursive: true, force: true })
  note(`− ${path}${isDir ? '' : ''}`)
}
note(`${EXCLUDE.length} entries dropped`)

/* 3. lay the open-source edition over the top */
step('Overlaying oss/')
const OVERLAY = join(REPO, 'oss')
if (!existsSync(OVERLAY)) die('no oss/ directory — that is where the open-source edition lives')
for (const rel of walk(OVERLAY)) {
  const dest = join(TREE, rel)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(join(OVERLAY, rel), dest)
  note(`+ ${rel}`)
}

/* 4. package.json, and the lockfile that has to agree with it */
step('Patching package.json')
const pkgPath = join(TREE, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
Object.assign(pkg, PACKAGE_PATCH.set)
for (const s of PACKAGE_PATCH.removeScripts) {
  if (!(s in pkg.scripts)) die(`package.json has no "${s}" script to remove — the patch is stale`)
  delete pkg.scripts[s]
  note(`− script: ${s}`)
}
for (const dep of PACKAGE_PATCH.removeDeps) {
  if (!pkg.dependencies?.[dep]) {
    die(`package.json has no "${dep}" dependency to remove — the patch is stale`)
  }
  delete pkg.dependencies[dep]
  note(`− dependency: ${dep}`)
}
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
note(`name: ${pkg.name} · license: ${pkg.license}`)

// npm ci refuses a lockfile whose root name disagrees with package.json.
const lockPath = join(TREE, 'package-lock.json')
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
lock.name = pkg.name
if (lock.packages?.['']) lock.packages[''].name = pkg.name

// A dropped dependency has to leave the lockfile too, or `npm ci` refuses the
// pair outright — and a reader who checks the dependency list deserves to find
// the same answer in both files. Nested installs under it go with it; anything
// still requiring it aborts, because pruning that would describe a tree npm
// cannot reproduce.
for (const dep of PACKAGE_PATCH.removeDeps) {
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    delete lock.packages?.['']?.[section]?.[dep]
  }
  for (const key of Object.keys(lock.packages ?? {})) {
    if (key === `node_modules/${dep}` || key.startsWith(`node_modules/${dep}/`)) {
      delete lock.packages[key]
    }
  }
  const stillNeeded = Object.entries(lock.packages ?? {})
    .filter(([key, meta]) => key !== '' && meta.dependencies?.[dep])
    .map(([key]) => key)
  if (stillNeeded.length) {
    die(`${dep} is still required by ${stillNeeded.join(', ')}.\n  Removing it would leave a lockfile npm cannot install from — take it out of removeDeps.`)
  }
  note(`− locked: ${dep}`)
}

writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
note('package-lock.json name kept in step')

/* 5. the backstop */
step('Leak gate')
let leaks = 0
for (const rel of walk(TREE)) {
  const buf = readFileSync(join(TREE, rel))
  if (buf.includes(0)) continue // binary
  const text = buf.toString('utf8')
  for (const { pattern, why } of FORBID) {
    if (!pattern.test(text)) continue
    const line = text.split('\n').findIndex((l) => pattern.test(l)) + 1
    console.error(`  \x1b[31m✗ ${rel}:${line || '?'} — ${why}\x1b[0m`)
    leaks++
  }
}
if (leaks) {
  die(`${leaks} forbidden ${leaks === 1 ? 'match' : 'matches'}. Either the file belongs in EXCLUDE, or the value should never have been written down.`)
}
note(`${FORBID.length} patterns, clean`)

/* 6. prove it stands up on its own */
step('Verifying the export')
if (has('fast')) {
  // Shares the private repo's install, including vite's cache under it. Fine
  // for iterating on this script; not what a release should trust.
  symlinkSync(join(REPO, 'node_modules'), join(TREE, 'node_modules'), 'dir')
  note('node_modules symlinked (--fast: not a hermetic check)')
} else {
  note('npm ci — also proves a contributor can install this tree')
  run(TREE, 'npm', ['ci', '--no-audit', '--no-fund'])
}
run(TREE, 'npm', ['run', 'typecheck'])
run(TREE, 'npx', ['vitest', 'run'])
run(TREE, 'npm', ['run', 'build'])
if (has('e2e')) {
  // A port of its own, deliberately: playwright.config reuses a server already
  // on 5173, so the default would silently test whatever is running there —
  // which during development is this repo, not the export.
  note('e2e on port 5199')
  run(TREE, 'npm', ['run', 'test:e2e'], { E2E_PORT: '5199' })
} else {
  note('e2e skipped (--e2e to run it, on port 5199)')
}

/* 7. leave nothing built behind */
rmSync(join(TREE, 'dist'), { recursive: true, force: true })
rmSync(join(TREE, 'node_modules'), { recursive: true, force: true })

/* 8. into the target's working tree */
step(`Syncing into ${TARGET}`)
for (const entry of readdirSync(TARGET)) {
  if (entry === '.git') continue
  rmSync(join(TARGET, entry), { recursive: true, force: true })
}
for (const rel of walk(TREE)) {
  const dest = join(TARGET, rel)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(join(TREE, rel), dest)
}
git(TARGET, 'add', '-A')
const staged = git(TARGET, 'diff', '--cached', '--stat')
note(staged ? staged.split('\n').slice(-1)[0] : 'nothing changed since the last export')

/* 9. stop, unless told otherwise. never push. */
const message = flag('commit')
if (message === undefined) {
  step('Ready')
  console.log(`
  Staged in ${TARGET}. Read the diff, then:

    git -C ${TARGET} diff --cached
    git -C ${TARGET} commit -m "<what changed for a reader of this repo>"
    git -C ${TARGET} push

  Nothing was pushed. This script does not push.
`)
} else {
  if (!staged) {
    step('Nothing to commit')
  } else {
    git(TARGET, 'commit', '-m', message)
    step(`Committed: ${git(TARGET, 'log', '--oneline', '-1')}`)
    console.log(`\n  Not pushed. Read it, then: git -C ${TARGET} push\n`)
  }
}

/* ── walking ──────────────────────────────────────────────────────────────── */

/** Every file under `root`, as paths relative to it. `.git` is never a file we
 *  copy, verify or scan — the target's history is not ours to overwrite. */
function walk(root, prefix = '') {
  const out = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const rel = prefix ? join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) out.push(...walk(root, rel))
    else out.push(rel)
  }
  return out
}
