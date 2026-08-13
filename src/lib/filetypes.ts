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

const TEXT_RE =
  /\.(txt|json|ya?ml|csv|tsv|toml|xml|css|scss|js|mjs|cjs|ts|tsx|jsx|vue|py|go|rs|java|c|cc|cpp|h|hpp|sh|zsh|bash|sql|rb|php|log|ini|conf|gitignore)$/i
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i
const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i
const VIDEO_RE = /\.(mp4|m4v|webm|mov|ogv|mkv)$/i

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
  // HTML renders as a sandboxed artifact (before TEXT_RE, which had html?).
  if (/\.html?$/i.test(path)) return 'html'
  if (TEXT_RE.test(path)) return 'text'
  return 'binary'
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
