/**
 * Agent skills — reusable workflow instructions stored IN the knowledge base,
 * following the open SKILL.md format (markdown + name/description frontmatter)
 * so any tool that speaks the format can consume them.
 *
 * Canonical directory: `.agents/skills/<name>/SKILL.md` (tool-neutral).
 * `.claude/skills/` is also read for compatibility; on a name clash the
 * canonical directory wins. Terminal Claude Code users symlink:
 * `ln -s ../.agents/skills .claude/skills` (and gitignore the link).
 *
 * Progressive disclosure: only name+description go into the system prompt;
 * the agent loads a skill's full body with the use_skill tool, or the user
 * forces one with a /slash command in the chat input.
 */
import * as fs from '@/lib/fs'
import { BUILTIN_SKILLS, builtinSkill } from '@/lib/builtinSkills'

/** Marks a skill as app-provided rather than living in the KB — not a real
 *  path, so nothing tries to read it off disk. */
export const BUILTIN_DIR = '<built-in>'

export const SKILL_DIRS = ['.agents/skills', '.claude/skills']

export interface SkillMeta {
  name: string
  description: string
  /** KB-relative skill directory, e.g. ".agents/skills/ingest" */
  dir: string
}

export interface Skill extends SkillMeta {
  body: string
  /** Other files bundled in the skill directory (templates, examples). */
  resources: string[]
}

/** Parse a SKILL.md: `---` frontmatter with flat `key: value` lines, then the
 *  markdown body. Missing fields fall back to the directory name / first
 *  body line, so hand-written files degrade gracefully. */
export function parseSkill(md: string, fallbackName: string, dir: string): Omit<Skill, 'resources'> {
  let name = fallbackName
  let description = ''
  let body = md
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  if (m) {
    body = md.slice(m[0].length)
    for (const line of m[1].split('\n')) {
      const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line.trim())
      if (!kv) continue
      const value = kv[2].trim().replace(/^["']|["']$/g, '')
      if (kv[1].toLowerCase() === 'name' && value) name = value
      if (kv[1].toLowerCase() === 'description') description = value
    }
  }
  if (!description) {
    description = body.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim().slice(0, 120) ?? ''
  }
  return { name, description, dir, body: body.trim() }
}

/** All skills in the KB (canonical dir first; name clashes keep the first). */
export async function listSkills(): Promise<SkillMeta[]> {
  const byName = new Map<string, SkillMeta>()
  for (const root of SKILL_DIRS) {
    let tree
    try {
      tree = await fs.readTreeFrom(root)
    } catch {
      continue // directory absent
    }
    for (const node of tree) {
      if (node.kind !== 'dir') continue
      const skillFile = node.children?.find((c) => c.kind === 'file' && c.name === 'SKILL.md')
      if (!skillFile) continue
      const md = await fs.tryReadFile(skillFile.path)
      if (!md) continue
      const parsed = parseSkill(md, node.name, node.path)
      if (!byName.has(parsed.name)) {
        byName.set(parsed.name, { name: parsed.name, description: parsed.description, dir: parsed.dir })
      }
    }
  }
  // App-provided skills come last: a KB skill of the same name overrides ours,
  // which is the right precedence for a folder the user owns.
  for (const s of BUILTIN_SKILLS) {
    if (!byName.has(s.name)) {
      byName.set(s.name, { name: s.name, description: s.description, dir: BUILTIN_DIR })
    }
  }
  return [...byName.values()]
}

/** Load one skill's full instructions + bundled resource paths. */
export async function loadSkill(name: string): Promise<Skill | null> {
  const metas = await listSkills()
  const meta = metas.find((s) => s.name === name)
  if (!meta) return null
  if (meta.dir === BUILTIN_DIR) {
    const b = builtinSkill(name)
    return b ? { name: b.name, description: b.description, dir: BUILTIN_DIR, body: b.body, resources: [] } : null
  }
  const md = await fs.tryReadFile(`${meta.dir}/SKILL.md`)
  if (!md) return null
  const parsed = parseSkill(md, name, meta.dir)
  let resources: string[] = []
  try {
    const tree = await fs.readTreeFrom(meta.dir)
    resources = fs.collectFiles(tree).filter((p) => !p.endsWith('/SKILL.md') && p !== 'SKILL.md')
  } catch {
    /* directory read failed — resources stay empty */
  }
  return { ...parsed, resources }
}
