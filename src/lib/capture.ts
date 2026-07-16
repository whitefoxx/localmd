/**
 * Source capture (drag-drop onto the app + paste/upload in the chat input):
 * route incoming files into `raw/<subdir>` by type with collision-safe names.
 * The routing table is byte-for-byte trace-app's, so both apps file sources
 * identically. Pure helpers are exported for unit tests; the only I/O lives
 * in importFile()/captureFiles().
 */
import * as fs from '@/lib/fs'

/** Which `raw/` subdirectory an uploaded/pasted file belongs in, by extension. */
export function rawSubdirFor(filename: string): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase()
  if (ext === 'pdf') return 'papers'
  if (ext === 'epub') return 'books'
  if (/^(png|jpe?g|gif|webp|bmp|svg|avif|tiff?|ico|heic)$/.test(ext)) return 'images'
  if (/^(csv|tsv|jsonl?|ndjson|xlsx?|parquet)$/.test(ext)) return 'data'
  if (/^(mp3|wav|m4a|flac|aac|ogg|opus)$/.test(ext)) return 'podcasts'
  if (/^(mp4|mov|webm|mkv|avi|m4v)$/.test(ext)) return 'videos'
  if (/^(srt|vtt)$/.test(ext)) return 'transcripts'
  // Markdown, text, html, office docs, and anything unknown — the agent
  // re-files on ingest, so a sensible default bucket is enough.
  return 'articles'
}

/** A file's basename, stripped of path separators and characters illegal on
 *  common filesystems. Empty/odd names fall back to a stable default. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f<>:"|?*]/g, '').trim()
  return cleaned || 'file'
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/** Ensure a usable, unique-ish filename for a clipboard blob that may arrive
 *  name-less — browsers name every pasted screenshot "image.png". */
export function ensureFilename(name: string, mime: string, stamp: number): string {
  const safe = sanitizeFilename(name)
  if (safe !== 'file' && safe !== 'image.png' && safe.includes('.')) return safe
  const ext = MIME_EXT[mime] ?? 'dat'
  return `capture-${stamp}.${ext}`
}

/** n-th name variant for collision handling: ("a/b.png", 3) → "a/b-3.png". */
export function numberedVariant(desired: string, n: number): string {
  if (n <= 1) return desired
  const dot = desired.lastIndexOf('.')
  const slash = desired.lastIndexOf('/')
  if (dot > slash) return `${desired.slice(0, dot)}-${n}${desired.slice(dot)}`
  return `${desired}-${n}`
}

async function resolveUniquePath(desired: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const candidate = numberedVariant(desired, n)
    if (!(await fs.exists(candidate))) return candidate
  }
  throw new Error(`could not find a free name for ${desired}`)
}

/** Write an incoming File into `raw/<subdir>/` and return its KB path. */
export async function importFile(f: File): Promise<string> {
  const name = ensureFilename(f.name, f.type, Date.now())
  const dest = await resolveUniquePath(`raw/${rawSubdirFor(name)}/${name}`)
  await fs.writeFile(dest, f)
  return dest
}

/** KB directory for ephemeral files — pasted screenshots and other chat-composer
 *  attachments handed to the agent, which don't belong in the curated `raw/`
 *  tree. Kept out of git via ensureTmpIgnored(). */
export const TMP_DIR = '.tmp'

/** Ensure the KB's `.gitignore` excludes the temp dir. Idempotent; runs on the
 *  first temp write. Honoured by both the in-app commit flow (git.isIgnored)
 *  and terminal git, so nothing under `.tmp/` ever enters the repo. */
async function ensureTmpIgnored(): Promise<void> {
  const line = `${TMP_DIR}/`
  const current = (await fs.tryReadFile('.gitignore')) ?? ''
  const ignored = current.split('\n').some((l) => {
    const t = l.trim()
    return t === line || t === TMP_DIR
  })
  if (ignored) return
  const next =
    current && !current.endsWith('\n') ? `${current}\n${line}\n` : `${current}${line}\n`
  await fs.writeFile('.gitignore', next)
}

/** Write an ephemeral File into the temp dir (flat) and return its KB path.
 *  Used by the chat composer so pasted screenshots don't land in `raw/images/`. */
export async function importTempFile(f: File): Promise<string> {
  await ensureTmpIgnored()
  const name = ensureFilename(f.name, f.type, Date.now())
  const dest = await resolveUniquePath(`${TMP_DIR}/${name}`)
  await fs.writeFile(dest, f)
  return dest
}

/** Write an incoming File into an explicit KB directory ('' = root), keeping
 *  its original name (collision-safe). Used by the file-tree "Import" action,
 *  which places files where the user points rather than routing into raw/. */
export async function importFileInto(f: File, dir: string): Promise<string> {
  const name = ensureFilename(f.name, f.type, Date.now())
  const dest = await resolveUniquePath(dir ? `${dir}/${name}` : name)
  await fs.writeFile(dest, f)
  return dest
}

/** Save dropped/uploaded files into raw/; returns the KB paths written. */
export async function captureFiles(files: File[]): Promise<string[]> {
  const written: string[] = []
  for (const file of files) {
    written.push(await importFile(file))
  }
  return written
}
