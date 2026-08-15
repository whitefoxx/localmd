/** Classify a KB path into a viewer kind. */

export type FileKind =
  | 'markdown'
  | 'text'
  | 'image'
  | 'pdf'
  | 'epub'
  | 'docx'
  | 'html'
  | 'audio'
  | 'video'
  | 'sheet'
  | 'slides'
  | 'binary'

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i
const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i
const VIDEO_RE = /\.(mp4|m4v|webm|mov|ogv|mkv)$/i

/**
 * Extensions whose bytes are not text. Everything no viewer claims and this
 * does not match opens as text — an allowlist of known text extensions is a
 * list that is always missing the file in front of you (`.env`, `Makefile`,
 * `.prettierrc`, `.ndjson`, and whatever config format gets invented next),
 * which is why editors guess the other way round.
 *
 * A name is only a guess. Before showing a file as text, the reader checks the
 * bytes with `looksBinary` — that is the half of the rule that keeps an
 * unrecognised blob from rendering as mojibake.
 */
const BINARY_EXT = [
  // archives and installers
  'zip|tar|t?gz|tbz2?|bz2|xz|zst|lz4|7z|rar|jar|war|apk|iso|dmg|pkg|deb|rpm|msi|crx',
  // executables, libraries, compiled artifacts
  'exe|dll|so|dylib|o|obj|lib|node|wasm|class|pyc|pyd|pdb|bin|dat',
  // databases, columnar and tensor data
  'db|sqlite\\d?|mdb|realm|parquet|orc|avro|feather|arrow|npy|npz|pt|pth|ckpt|onnx|safetensors|gguf|ggml|pack|idx|pcapng?',
  // fonts and design documents
  'woff2?|ttf|ttc|otf|eot|psd|xcf|sketch|fig|blend|swf|pages|numbers|odt|ods|odp',
  // media no browser viewer of ours claims (the ones it does are above)
  'tiff?|heic|heif|svgz|icns|tga|emf|wmf|cur|raw|cr[23]|nef|arw|orf|rw2|dng',
  'avi|wmv|flv|mpe?g|mpv|3gp|m2ts|mts|vob|rm|rmvb|asf',
  'wma|aiff?|ape|midi?|amr|m4b|caf|dsf',
  // e-books and certificates that are not text on disk
  'mobi|azw3?|djvu?|chm|xps|oxps|p12|pfx|jks|keystore|der',
].join('|')
const BINARY_RE = new RegExp(`\\.(${BINARY_EXT})$`, 'i')

export function fileKind(path: string): FileKind {
  if (/\.md$/i.test(path)) return 'markdown'
  if (IMAGE_RE.test(path)) return 'image'
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (/\.epub$/i.test(path)) return 'epub'
  // Legacy .doc opens in the same viewer, which explains why it can't render.
  if (/\.docx?$/i.test(path)) return 'docx'
  if (AUDIO_RE.test(path)) return 'audio'
  if (VIDEO_RE.test(path)) return 'video'
  // Legacy .xls/.ppt open in the same viewers, which explain themselves too.
  if (/\.xlsx?$/i.test(path)) return 'sheet'
  if (/\.pptx?$/i.test(path)) return 'slides'
  // HTML renders as a sandboxed artifact.
  if (/\.html?$/i.test(path)) return 'html'
  if (BINARY_RE.test(path)) return 'binary'
  return 'text'
}

/** True when a path's *name* claims text: notes, code, config, HTML. The one
 *  question everything asks of the classification above — reading a file,
 *  searching one, diffing one in git — so it is answered in one place. */
export function isTextName(path: string): boolean {
  const kind = fileKind(path)
  return kind === 'markdown' || kind === 'text' || kind === 'html'
}

/** How much of a file's head decides whether it is text. */
export const SNIFF_BYTES = 8192

/**
 * The byte-level half of the rule above: a NUL in the head means this is not
 * text, whatever its name suggested. It is git's own heuristic, and the one
 * signal that never fires on real prose — undecodable UTF-8 deliberately does
 * not count, so a Latin-1 note still opens (with replacement characters)
 * instead of being declared binary. UTF-16 is the known cost: its NULs read as
 * binary here, and we would mangle it on save if they didn't.
 */
export function looksBinary(head: Uint8Array): boolean {
  const n = Math.min(head.length, SNIFF_BYTES)
  for (let i = 0; i < n; i++) if (head[i] === 0) return true
  return false
}

/** True for plain-text prose (.txt) that should get a serif reading view rather
 *  than the code editor. Code/config text (.json, .ts, .log, …) stays in
 *  CodeMirror — reflowing them as prose would be wrong. */
export function isProseText(path: string): boolean {
  return /\.txt$/i.test(path)
}

/** CSV/TSV render as a table in preview mode, with the same Edit/Preview
 *  toggle as `.txt` — the raw text stays editable in CodeMirror. */
export function isTabular(path: string): boolean {
  return /\.(csv|tsv)$/i.test(path)
}

export function mimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    pdf: 'application/pdf',
    epub: 'application/epub+zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg',
    flac: 'audio/flac',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    ogv: 'video/ogg',
    mkv: 'video/x-matroska',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint',
  }
  return map[ext] ?? 'application/octet-stream'
}
