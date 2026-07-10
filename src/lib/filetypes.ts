/** Classify a KB path into a viewer kind. */

export type FileKind = 'markdown' | 'text' | 'image' | 'pdf' | 'epub' | 'binary'

const TEXT_RE =
  /\.(txt|json|ya?ml|csv|tsv|toml|xml|html?|css|scss|js|mjs|cjs|ts|tsx|jsx|vue|py|go|rs|java|c|cc|cpp|h|hpp|sh|zsh|bash|sql|rb|php|log|ini|conf|gitignore)$/i
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i

export function fileKind(path: string): FileKind {
  if (/\.md$/i.test(path)) return 'markdown'
  if (IMAGE_RE.test(path)) return 'image'
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (/\.epub$/i.test(path)) return 'epub'
  if (TEXT_RE.test(path)) return 'text'
  return 'binary'
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
  }
  return map[ext] ?? 'application/octet-stream'
}
