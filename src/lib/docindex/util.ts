/**
 * Format-agnostic helpers shared by the document indexers (PDF, EPUB, MD).
 * Ported from trace-app's doc-index/util.ts; writes go through our File System
 * Access layer instead of Electron IPC. Index formats and directory naming are
 * kept byte-compatible with trace-app so existing KBs interoperate.
 */
import * as fs from '@/lib/fs'
import { ensureIgnored } from '@/lib/gitignore'

/** Zero-pad a number to 3 digits (`7` → `"007"`). */
export function pad(n: number): string {
  return String(n).padStart(3, '0')
}

/**
 * Filesystem-safe slug for section file names. Keeps Unicode letters and
 * digits, so a CJK section title does not collapse to an empty name.
 */
export function slugify(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return out || 'section'
}

/** SHA-256 of some bytes as lowercase hex — used to detect a stale index. */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Stable 8-hex-char hash of a string — disambiguates index directory names. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Index directory for a source path: `.trace/<kind>-index/<name>-<hash>`. */
export function indexDirFor(kind: 'pdf' | 'epub' | 'md' | 'docx', source: string): string {
  const base = source.split('/').pop()?.replace(/\.[^.]+$/, '') ?? source
  return `.trace/${kind}-index/${slugify(base)}-${fnv1a(source)}`
}

/**
 * Write the index files with bounded concurrency — a large book becomes
 * hundreds of section files, and firing every write at once exhausts handles.
 *
 * The one place every index kind writes, so it is also where `.trace/` earns
 * its `.gitignore` line: an index is megabytes of regenerable derivative data,
 * and a KB that only ever indexes documents would otherwise never be told.
 */
export async function writeAll(
  indexDir: string,
  files: { path: string; content: string }[],
): Promise<void> {
  await ensureIgnored('.trace').catch(() => {
    /* the index is still worth writing if the .gitignore cannot be touched */
  })
  // A rebuild must survive being killed at ANY point — the user closes the
  // tab whenever they like — without ever presenting a manifest that lies or
  // losing the old locations.json (the block-id record that lets the next
  // build carry ids forward). Hence this order, and never a clear-then-write:
  //   1. overwrite/add the new build's files (each write is atomic; the old
  //      manifest still vouches for a complete old index throughout),
  //   2. write manifest.json alone — the one write that flips the directory
  //      to "the new index, complete",
  //   3. only then delete files the new build no longer produces (a stale
  //      sections/*.md that toc.md stopped linking would still turn up in
  //      search_files). A crash here leaves orphans, never a broken index —
  //      and the next successful rebuild sweeps them.
  const before = fs
    .collectFiles(await fs.readTreeFrom(indexDir).catch(() => []))
    .map((p) => p.slice(indexDir.length + 1))
  const manifest = files.filter((f) => f.path === 'manifest.json')
  const rest = files.filter((f) => f.path !== 'manifest.json')
  const CHUNK = 24
  for (let i = 0; i < rest.length; i += CHUNK) {
    await Promise.all(
      rest.slice(i, i + CHUNK).map((f) => fs.writeFile(`${indexDir}/${f.path}`, f.content)),
    )
  }
  for (const f of manifest) await fs.writeFile(`${indexDir}/${f.path}`, f.content)
  const produced = new Set(files.map((f) => f.path))
  for (const stale of before.filter((p) => !produced.has(p))) {
    await fs.removeFile(`${indexDir}/${stale}`).catch(() => {
      /* cleanup is best-effort; an orphan is harmless and swept next time */
    })
  }
}

/** Read a manifest and report whether it is fresh for the given content hash. */
export async function readFreshManifest<T extends { version: number; contentHash: string }>(
  indexDir: string,
  version: number,
  contentHash: string,
): Promise<T | null> {
  const raw = await fs.tryReadFile(`${indexDir}/manifest.json`)
  if (!raw) return null
  try {
    const m = JSON.parse(raw) as T
    if (m.version === version && m.contentHash === contentHash) return m
  } catch {
    /* corrupted manifest → rebuild */
  }
  return null
}
