/**
 * The app's own reference manual, readable by the agent on demand.
 *
 * Distinct from skills on purpose. A skill is a WORKFLOW — do this, then that —
 * and the system prompt carries a one-line listing of every one so the agent
 * knows when to reach for it. These are REFERENCE: what a thing is, where it is
 * stored, why it behaves the way it does. There is no useful moment to "invoke"
 * them; they answer a question the user asked.
 *
 * So the index is not in the prompt either. `app_help` with no topic returns
 * the list, `app_help` with one returns the body — the always-on cost is the
 * tool's own description and nothing else, however many topics we add. That
 * matters because this set is meant to grow to cover the whole app.
 *
 * Docs are markdown files in `docs/app/`, imported at build time. They ship in
 * the bundle: the user's KB folder stays untouched, and a doc is never
 * something they have to install or sync.
 */

export interface AppDocMeta {
  id: string
  title: string
  /** One line, shown in the index the agent reads before picking. */
  summary: string
}

export interface AppDoc extends AppDocMeta {
  body: string
}

/** `id: title: summary` frontmatter, same shape as SKILL.md so the two formats
 *  don't diverge for no reason. */
function parseDoc(md: string, id: string): AppDoc {
  let title = id
  let summary = ''
  let body = md
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  if (m) {
    body = md.slice(m[0].length)
    for (const line of m[1].split('\n')) {
      const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line.trim())
      if (!kv) continue
      const value = kv[2].trim().replace(/^["']|["']$/g, '')
      if (kv[1].toLowerCase() === 'title' && value) title = value
      if (kv[1].toLowerCase() === 'summary') summary = value
    }
  }
  if (!summary) {
    summary = body.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim().slice(0, 160) ?? ''
  }
  return { id, title, summary, body: body.trim() }
}

const MODULES = import.meta.glob('../../docs/app/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const DOCS: AppDoc[] = Object.entries(MODULES)
  .map(([path, md]) => parseDoc(md, path.slice(path.lastIndexOf('/') + 1, -3)))
  .sort((a, b) => a.id.localeCompare(b.id))

export function listAppDocs(): AppDocMeta[] {
  return DOCS.map(({ id, title, summary }) => ({ id, title, summary }))
}

export function appDoc(id: string): AppDoc | undefined {
  return DOCS.find((d) => d.id === id)
}
