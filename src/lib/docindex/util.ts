/**
 * Format-agnostic helpers shared by the document indexers (PDF, EPUB, MD).
 * Writes go through the File System Access layer. Index formats and directory
 * naming are byte-stable: existing knowledge bases hold directories named by
 * these rules, and a name that moves orphans the index it points at.
 */
import * as fs from '@/lib/fs'
import { ensureIgnored } from '@/lib/gitignore'

/**
 * Which part of a build is running.
 *
 * Extraction is the one everybody thinks of, and it was the only one anybody
 * was told about: a 2480-page PDF sat under "Extracting page 2480/2480" for
 * the whole of the other two — inheriting ids and rendering sections
 * (`build`), then writing hundreds of files (`write`) — which is minutes of
 * looking hung on a long document.
 */
export type IndexPhase = 'extract' | 'build' | 'write'

export type IndexProgress = (current: number, total: number, phase: IndexPhase) => void

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

/** Index directory for a source path: `.localmd/<kind>-index/<name>-<hash>`. */
export function indexDirFor(kind: 'pdf' | 'epub' | 'md' | 'docx', source: string): string {
  const base = source.split('/').pop()?.replace(/\.[^.]+$/, '') ?? source
  return `.localmd/${kind}-index/${slugify(base)}-${fnv1a(source)}`
}

/**
 * Write the index files with bounded concurrency — a large book becomes
 * hundreds of section files, and firing every write at once exhausts handles.
 *
 * The one place every index kind writes, so it is also where `.localmd/` earns
 * its `.gitignore` line: an index is megabytes of regenerable derivative data,
 * and a KB that only ever indexes documents would otherwise never be told.
 */
export async function writeAll(
  indexDir: string,
  files: { path: string; content: string }[],
  onProgress: (written: number, total: number) => void = () => {},
): Promise<void> {
  await ensureIgnored('.localmd').catch(() => {
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
  // Said before the directory listing below, not after: on a big index that
  // listing is itself a wait, and the point of reporting at all is that the
  // caller stops showing the last thing the extractor said.
  onProgress(0, files.length)
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
    onProgress(Math.min(i + CHUNK, rest.length), files.length)
  }
  for (const f of manifest) await fs.writeFile(`${indexDir}/${f.path}`, f.content)
  onProgress(files.length, files.length)
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

/** Longest passage a citation chip's tooltip carries. A block is a paragraph,
 *  so this only ever bites on the long ones — and a tooltip nobody can read to
 *  the end of is worse than one that stops. */
const PASSAGE_MAX = 600

/**
 * The passage a block id names, read back out of a section file.
 *
 * Every indexer writes a block as `[[id]] text` on one line — with the
 * markdown marker for its kind in front (`## `, `> `, `- `), which is why this
 * reads forward from the tag rather than parsing the line. Two blocks put
 * nothing after the tag: a code block (fenced on the following lines) and a
 * docx table (`(table)`, then its rows), so those are collected from the lines
 * below, up to the blank line that ends every block.
 *
 * Returns null when the section does not carry that block — the caller is
 * usually asking every section it has.
 */
export function blockPassage(sectionContent: string, blockId: string): string | null {
  const tag = `[[${blockId}]]`
  const at = sectionContent.indexOf(tag)
  if (at < 0) return null
  const lines = sectionContent.slice(at + tag.length).split('\n')
  let text = lines[0].trim()
  if (!text || text === '(table)') {
    const body: string[] = []
    for (const line of lines.slice(1)) {
      const t = line.trim()
      // A fence or a blank line opens the block on the way in and closes it on
      // the way out, so the same test does both jobs.
      if (!t || t === '```') {
        if (body.length) break
        continue
      }
      body.push(t.replace(/^\|\s*/, '').replace(/\s*\|$/, ''))
    }
    text = body.join('\n')
  }
  if (!text) return null
  return text.length > PASSAGE_MAX ? `${text.slice(0, PASSAGE_MAX)}…` : text
}
