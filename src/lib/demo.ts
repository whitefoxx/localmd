/**
 * The demo knowledge base: a real KB, seeded into memory, that a first-time
 * visitor can open without choosing a folder.
 *
 * Why it exists: the funnel used to require picking a local folder AND getting
 * an API key before anything happened. Most people arriving from a link are
 * browsing, not committing — they need to see the payoff (ask about a paper,
 * click the citation, land on the paragraph) before they hand over either.
 *
 * Why memory: `lib/memfs` already presents the exact `FileSystemDirectoryHandle`
 * surface the fs layer, the git adapter, the editors and the viewers use, so
 * the whole app runs against the demo unchanged — no demo-only code paths, and
 * nothing is written to the visitor's disk. Closing the tab discards it.
 *
 * Why the asset paths are remapped: the demo ships a prebuilt document index so
 * the citation click is instant rather than a wait for pdf.js. That index lives
 * at `.trace/…` inside the KB, but a leading-dot directory under `public/` is
 * not reliably published by every host, so the assets are stored undotted and
 * the manifest carries both names.
 *
 * Demo mode deliberately does NOT isolate settings the way `?e2e` does: a
 * visitor who likes it enough to paste their own key mid-demo should keep it.
 */
import * as fs from '@/lib/fs'
import { createMemoryRoot } from '@/lib/memfs'

/** One file in the demo KB: where it lives in the KB, and where it is served. */
export interface DemoFile {
  /** KB-relative path the file gets inside the demo knowledge base. */
  path: string
  /** Path under `public/demo/`. Omitted when it matches `path`. */
  asset?: string
  /** Copy bytes rather than text (PDFs, images). */
  binary?: boolean
}

export interface DemoManifest {
  /** Folder name the KB reports — shows in the title bar. */
  name: string
  /** Note to open once the KB is loaded; the demo's first screen. */
  open?: string
  files: DemoFile[]
}

/** Where the demo assets are served from, relative to the app root. */
const DEMO_BASE = 'demo'

export function isDemoMode(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')
}

export async function loadDemoManifest(): Promise<DemoManifest> {
  const res = await fetch(`${DEMO_BASE}/manifest.json`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`demo manifest: ${res.status}`)
  return (await res.json()) as DemoManifest
}

/**
 * Build the demo KB in memory and return its handle, ready for
 * `kbStore.openHandle`. Files are fetched in parallel but written in manifest
 * order, so a partial network failure leaves a prefix rather than a KB with
 * holes in the middle of it.
 */
/** Raised when the chosen folder already has something in it. */
export class TargetNotEmpty extends Error {
  constructor() {
    super('target folder is not empty')
    this.name = 'TargetNotEmpty'
  }
}

/**
 * Copy the open in-memory KB into a real folder on disk, file for file.
 *
 * This is the demo's way out. Without it the demo is a cul-de-sac: everything
 * a visitor does in it is thrown away, so the moment they like it they have to
 * start again somewhere else. With it, the demo is the first step of setting
 * up — including the paper and its prebuilt index, so the citations keep
 * working in the copy.
 *
 * Refuses a folder that already has anything in it. Merging into someone's
 * existing files is exactly the kind of surprise this app promises not to
 * spring, and an empty folder is one right-click away.
 */
export async function saveDemoTo(target: FileSystemDirectoryHandle): Promise<void> {
  for await (const _ of (target as unknown as { keys(): AsyncIterable<string> }).keys()) {
    void _
    throw new TargetNotEmpty()
  }

  const paths = fs.collectFiles(await fs.readTree())
  for (const path of paths) {
    const bytes = await fs.readBinary(path)
    const segments = path.split('/')
    const name = segments.pop()!
    let dir = target
    for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create: true })
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(bytes)
    await writable.close()
  }
}

export async function seedDemoKb(manifest: DemoManifest): Promise<FileSystemDirectoryHandle> {
  const root = createMemoryRoot(manifest.name)
  const previous = fs.hasRoot() ? fs.getRoot() : null
  fs.setRoot(root)
  try {
    const fetched = await Promise.all(
      manifest.files.map(async (file) => {
        const url = `${DEMO_BASE}/${file.asset ?? file.path}`
        // Ordinary HTTP caching, deliberately: the demo assets carry no content
        // hash in their names, so `force-cache` would serve a stale demo to
        // every returning visitor after an update, forever.
        const res = await fetch(url)
        if (!res.ok) throw new Error(`demo asset ${url}: ${res.status}`)
        return { file, content: file.binary ? await res.blob() : await res.text() }
      }),
    )
    for (const { file, content } of fetched) await fs.writeFile(file.path, content)
  } catch (err) {
    // Put the visitor's own KB back rather than leaving them pointed at a
    // half-built demo.
    fs.setRoot(previous)
    throw err
  }
  return root
}
