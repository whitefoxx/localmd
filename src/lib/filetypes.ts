/** Classify a KB path into a viewer kind. */

export type FileKind = 'markdown' | 'text' | 'image' | 'pdf' | 'epub' | 'docx' | 'html' | 'binary'

const TEXT_RE =
  /\.(txt|json|ya?ml|csv|tsv|toml|xml|css|scss|js|mjs|cjs|ts|tsx|jsx|vue|py|go|rs|java|c|cc|cpp|h|hpp|sh|zsh|bash|sql|rb|php|log|ini|conf|gitignore)$/i
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i

export function fileKind(path: string): FileKind {
  if (/\.md$/i.test(path)) return 'markdown'
  if (IMAGE_RE.test(path)) return 'image'
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (/\.epub$/i.test(path)) return 'epub'
  // Legacy .doc opens in the same viewer, which explains why it can't render.
  if (/\.docx?$/i.test(path)) return 'docx'
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
  }
  return map[ext] ?? 'application/octet-stream'
}
