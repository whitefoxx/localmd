/**
 * Rendering for the agent's list_files output. Small listings come back as
 * plain newline-separated paths; large KBs fold into a per-directory summary
 * (count + a few example names) so one call never floods the context — the
 * agent drills into a specific directory with the `dir` parameter, which
 * re-runs the same rendering rooted there. Layout intent (folder names,
 * naming style) survives the fold; only bulk is dropped.
 */

/** Listings with more paths than this fold into the directory summary. */
export const FOLD_AT = 400
/** Example file names shown per directory in a folded listing. */
const EXAMPLES = 3

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function renderFileList(paths: string[], foldAt = FOLD_AT): string {
  if (paths.length <= foldAt) return paths.join('\n')

  const byDir = new Map<string, string[]>()
  for (const p of paths) {
    const dir = dirname(p)
    const list = byDir.get(dir)
    if (list) list.push(basename(p))
    else byDir.set(dir, [basename(p)])
  }

  const lines: string[] = []
  for (const dir of [...byDir.keys()].sort()) {
    const files = byDir.get(dir)!
    if (dir === '') {
      lines.push(...files) // root files are structural — list them all
    } else if (files.length <= EXAMPLES) {
      lines.push(`${dir}/ — ${files.map((f) => `${dir}/${f}`).join(', ')}`)
    } else {
      lines.push(
        `${dir}/ — ${files.length} files, e.g. ${files.slice(0, EXAMPLES).join(', ')}, …`,
      )
    }
  }
  return (
    `[${paths.length} files — folded to a directory summary. Call list_files with dir="<directory>" to list one in full.]\n` +
    lines.join('\n')
  )
}
