/**
 * Format-agnostic helpers shared by the document indexers (PDF, EPUB, MD).
 * Ported from trace-app's doc-index/util.ts; writes go through our File System
 * Access layer instead of Electron IPC. Index formats and directory naming are
 * kept byte-compatible with trace-app so existing KBs interoperate.
 */
import * as fs from '@/lib/fs'

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
 */
export async function writeAll(
  indexDir: string,
  files: { path: string; content: string }[],
): Promise<void> {
  const CHUNK = 24
  for (let i = 0; i < files.length; i += CHUNK) {
    await Promise.all(
      files.slice(i, i + CHUNK).map((f) => fs.writeFile(`${indexDir}/${f.path}`, f.content)),
    )
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
