/**
 * Dev-only tool that regenerates the demo KB's prebuilt document index.
 *
 * The demo ships its `.trace/` index rather than building it on open, so the
 * first citation click is instant instead of a wait for pdf.js. That index has
 * to be produced by the real indexer — a hand-written one would drift from
 * `INDEX_VERSION` and be silently rejected as stale — and the real indexer only
 * runs in a browser: it imports the pdf.js worker through Vite's `?url` and
 * reads `location.href`, so a Node script cannot drive it.
 *
 * So: run `npm run dev` and open `/?demo-build=1`. The result is POSTed to the
 * dev server, which writes it into `public/demo/trace/` and rebuilds the
 * manifest (see the demoIndexWriter plugin in vite.config.ts).
 *
 * Re-run this whenever the PDF changes or `INDEX_VERSION` is bumped — a stale
 * demo index fails the freshness check and the demo silently loses its
 * citations. Guarded by `import.meta.env.DEV`, so it is never in a release.
 */
import * as fs from '@/lib/fs'
import { createMemoryRoot } from '@/lib/memfs'
import { indexDocument } from '@/lib/docindex'

/** The demo's source document, at its KB-relative path. The path is part of
 *  the index directory name (it is hashed into it), so it must match what
 *  `manifest.json` seeds — change one and you must change the other. */
const SOURCE = 'raw/papers/chain-of-thought-prompting.pdf'

export async function buildDemoIndex(): Promise<void> {
  const log = (msg: string) => console.info(`[demo-build] ${msg}`)

  const root = createMemoryRoot('demo-build')
  fs.setRoot(root)

  log(`fetching ${SOURCE}`)
  const res = await fetch(`demo/${SOURCE}`)
  if (!res.ok) throw new Error(`demo asset: ${res.status}`)
  await fs.writeFile(SOURCE, await res.blob())

  log('indexing (this runs the real pdf.js extractor)…')
  const summary = await indexDocument(SOURCE, (page, total) => {
    if (page % 10 === 0 || page === total) log(`page ${page}/${total}`)
  })
  log(`indexed: ${summary.blockCount} blocks in ${summary.sectionCount} sections`)

  const paths = fs.collectFiles(await fs.readTreeFrom(summary.indexDir))
  const bundle: Record<string, string> = {}
  for (const path of paths) {
    const text = await fs.tryReadFile(path)
    if (text !== null) bundle[path] = text
  }

  log(`posting ${Object.keys(bundle).length} files from ${summary.indexDir}`)
  const written = await fetch('/__demo-index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indexDir: summary.indexDir, files: bundle }),
  })
  log(written.ok ? await written.text() : `FAILED: ${written.status} ${await written.text()}`)
}
