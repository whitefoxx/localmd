/**
 * Builds `public/demo/manifest.json` — the file list the demo KB is seeded
 * from — and unpacks the prebuilt document index that `/?demo-build=1`
 * produces.
 *
 *   node scripts/build-demo.mjs          # just rebuild the manifest
 *
 * Normally you do not run this by hand: the dev-only `/?demo-build=1` route
 * POSTs its bundle to the dev server, which calls straight into the two
 * functions below (see the demoIndexWriter plugin in vite.config.ts). That
 * replaced a browser download, which Chrome blocks when nothing on the page
 * was clicked — silently, so it looked like the build had simply not run.
 *
 * Why `.localmd/` is stored as `localmd/`: a leading-dot directory under `public/`
 * is not reliably published by every static host, so the assets are undotted
 * and the manifest carries both names.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEMO = join(ROOT, 'public', 'demo')

/** Folder name the demo KB reports, and the note it opens on. */
const NAME = 'localmd-demo'
const OPEN = 'wiki/chain-of-thought.md'

const BINARY = /\.(pdf|epub|docx?|png|jpe?g|gif|webp|svg)$/i

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) walk(abs, out)
    else out.push(relative(DEMO, abs))
  }
  return out
}

/**
 * Write an index bundle into `public/demo/localmd/`, replacing whatever was
 * there. Replacing matters: a rebuild that produces fewer section files than
 * last time would otherwise leave the extras behind, and the manifest would
 * cheerfully seed them.
 */
export function unpackIndex({ indexDir, files }) {
  if (!indexDir?.startsWith('.localmd/')) throw new Error(`unexpected index dir: ${indexDir}`)
  rmSync(join(DEMO, 'localmd'), { recursive: true, force: true })
  for (const [kbPath, content] of Object.entries(files)) {
    const asset = join(DEMO, kbPath.replace(/^\.localmd\//, 'localmd/'))
    mkdirSync(dirname(asset), { recursive: true })
    writeFileSync(asset, content)
  }
  return Object.keys(files).length
}

/** Rebuild `manifest.json` from whatever is on disk under `public/demo/`. */
export function rebuildManifest() {
  const files = walk(DEMO)
    .filter((p) => p !== 'manifest.json')
    .sort()
    .map((asset) => {
      const path = asset.startsWith('localmd/') ? `.${asset}` : asset
      const entry = { path }
      if (asset !== path) entry.asset = asset
      if (BINARY.test(asset)) entry.binary = true
      return entry
    })

  writeFileSync(
    join(DEMO, 'manifest.json'),
    JSON.stringify({ name: NAME, open: OPEN, files }, null, 2) + '\n',
  )
  return files.length
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bundlePath = process.argv[2]
  if (bundlePath) {
    console.log(`unpacked ${unpackIndex(JSON.parse(readFileSync(bundlePath, 'utf8')))} index files`)
  }
  console.log(`manifest.json: ${rebuildManifest()} files`)
}
