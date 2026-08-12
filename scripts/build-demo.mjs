/**
 * Builds `public/demo/manifest.json` — the file list the demo KB is seeded
 * from — and, when handed the bundle that `/?demo-build=1` downloads, unpacks
 * the prebuilt document index alongside it.
 *
 *   node scripts/build-demo.mjs                      # just rebuild the manifest
 *   node scripts/build-demo.mjs ~/Downloads/demo-index.json
 *
 * Why the index arrives as a download rather than being generated here: the
 * indexer only runs in a browser (see src/demo/buildIndex.ts). Why `.trace/`
 * is stored as `trace/`: a leading-dot directory under `public/` is not
 * reliably published by every static host, so the assets are undotted and the
 * manifest carries both names.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
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

const bundlePath = process.argv[2]
if (bundlePath) {
  const { indexDir, files } = JSON.parse(readFileSync(bundlePath, 'utf8'))
  if (!indexDir.startsWith('.trace/')) throw new Error(`unexpected index dir: ${indexDir}`)
  let n = 0
  for (const [kbPath, content] of Object.entries(files)) {
    const asset = join(DEMO, kbPath.replace(/^\.trace\//, 'trace/'))
    mkdirSync(dirname(asset), { recursive: true })
    writeFileSync(asset, content)
    n++
  }
  console.log(`unpacked ${n} index files from ${indexDir}`)
}

const files = walk(DEMO)
  .filter((p) => p !== 'manifest.json')
  .sort()
  .map((asset) => {
    const path = asset.startsWith('trace/') ? `.${asset}` : asset
    const entry = { path }
    if (asset !== path) entry.asset = asset
    if (BINARY.test(asset)) entry.binary = true
    return entry
  })

writeFileSync(
  join(DEMO, 'manifest.json'),
  JSON.stringify({ name: NAME, open: OPEN, files }, null, 2) + '\n',
)
console.log(`manifest.json: ${files.length} files`)
