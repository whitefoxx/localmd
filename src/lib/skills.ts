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
 *
 * Those two audiences are independent, which is why a skill declares who it is
 * for. The model's catalog is paid for on every step of every turn, so a
 * workflow only ever run by hand (`invocation: user`) should not be in it; and
 * a skill the agent follows on its own has no business cluttering the slash
 * menu (`invocation: model`). Absent or unrecognized, a skill is for both.
 */
import * as fs from '@/lib/fs'
import { BUILTIN_SKILLS, builtinSkill } from '@/lib/builtinSkills'

/** Marks a skill as app-provided rather than living in the KB — not a real
 *  path, so nothing tries to read it off disk. */
export const BUILTIN_DIR = '<built-in>'

export const SKILL_DIRS = ['.agents/skills', '.claude/skills']

/** Who may invoke a skill. One frontmatter key rather than two booleans: the
 *  fourth state (invocable by nobody) has no meaning, so it is not spellable. */
export type SkillInvocation = 'both' | 'model' | 'user'

export interface SkillMeta {
  name: string
  description: string
  /** KB-relative skill directory, e.g. ".agents/skills/ingest" */
  dir: string
  /** Listed to the model in the system prompt, and loadable by use_skill. */
  modelInvocable: boolean
  /** Offered in the slash menu and the composer's skill buttons. */
  userInvocable: boolean
}

/** Derive the two audience flags. Anything unrecognized reads as `both`: the
 *  KB is a soft constraint, so a typo in a hand-edited file must not make a
 *  skill vanish from both audiences with nothing to explain why. */
export function invocationFlags(value: string | undefined): {
  modelInvocable: boolean
  userInvocable: boolean
} {
  const v = value?.trim().toLowerCase()
  if (v === 'model') return { modelInvocable: true, userInvocable: false }
  if (v === 'user') return { modelInvocable: false, userInvocable: true }
  return { modelInvocable: true, userInvocable: true }
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
  let invocation: string | undefined
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
      if (kv[1].toLowerCase() === 'invocation') invocation = value
    }
  }
  if (!description) {
    description = body.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim().slice(0, 120) ?? ''
  }
  return { name, description, dir, ...invocationFlags(invocation), body: body.trim() }
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
        byName.set(parsed.name, {
          name: parsed.name,
          description: parsed.description,
          dir: parsed.dir,
          modelInvocable: parsed.modelInvocable,
          userInvocable: parsed.userInvocable,
        })
      }
    }
  }
  // App-provided skills come last: a KB skill of the same name overrides ours,
  // which is the right precedence for a folder the user owns.
  for (const s of BUILTIN_SKILLS) {
    if (!byName.has(s.name)) {
      byName.set(s.name, {
        name: s.name,
        description: s.description,
        dir: BUILTIN_DIR,
        ...invocationFlags(s.invocation),
      })
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
    return b
      ? {
          name: b.name,
          description: b.description,
          dir: BUILTIN_DIR,
          ...invocationFlags(b.invocation),
          body: b.body,
          resources: [],
        }
      : null
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
