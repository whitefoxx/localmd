/**
 * Drag-drop capture: route dropped files into raw/ subdirectories by type
 * (following the trace-app KB convention) with collision-safe names.
 */
import * as fs from '@/lib/fs'

const ROUTES: [RegExp, string][] = [
  [/\.(png|jpe?g|gif|webp|svg|heic)$/i, 'raw/images'],
  [/\.pdf$/i, 'raw/papers'],
  [/\.epub$/i, 'raw/books'],
  [/\.(mp3|wav|m4a|flac|ogg)$/i, 'raw/podcasts'],
  [/\.(mp4|mov|webm|mkv)$/i, 'raw/videos'],
  [/\.(md|txt|html?)$/i, 'raw/articles'],
]

function routeFor(name: string): string {
  for (const [re, dir] of ROUTES) {
    if (re.test(name)) return dir
  }
  return 'raw/data'
}

async function uniquePath(dir: string, name: string): Promise<string> {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let candidate = `${dir}/${name}`
  for (let i = 1; await fs.exists(candidate); i++) {
    candidate = `${dir}/${stem}-${i}${ext}`
  }
  return candidate
}

/** Save dropped files into raw/; returns the KB paths written. */
export async function captureFiles(files: File[]): Promise<string[]> {
  const written: string[] = []
  for (const file of files) {
    const dir = routeFor(file.name)
    const path = await uniquePath(dir, file.name)
    await fs.writeFile(path, file)
    written.push(path)
  }
  return written
}
