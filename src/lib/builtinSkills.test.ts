import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from '@/lib/fs'
import { createMemoryRoot } from '@/lib/memfs'
import { listSkills, loadSkill, BUILTIN_DIR } from './skills'
import { BUILTIN_SKILLS } from './builtinSkills'

beforeEach(() => {
  fs.setRoot(createMemoryRoot())
})

describe('app-provided skills', () => {
  it('are available in a KB that has no skills of its own', async () => {
    const names = (await listSkills()).map((s) => s.name)
    for (const b of BUILTIN_SKILLS) expect(names).toContain(b.name)
  })

  it('load their body without touching the filesystem', async () => {
    const skill = await loadSkill('connect-a-service')
    expect(skill?.dir).toBe(BUILTIN_DIR)
    expect(skill?.body).toContain('Connecting a service')
    expect(skill?.resources).toEqual([])
  })

  /** The playbook is only useful if it names the tools it tells the agent to
   *  use; a rename that misses it would leave silently stale instructions. */
  it('reference the tools they depend on', async () => {
    const body = (await loadSkill('connect-a-service'))!.body
    for (const needed of ['manage_tools', 'request_setup', 'save_bundle', 'transport', 'webcli']) {
      expect(body, needed).toContain(needed)
    }
  })

  it('yield to a KB skill of the same name', async () => {
    await fs.writeFile(
      '.agents/skills/connect-a-service/SKILL.md',
      '---\nname: connect-a-service\ndescription: mine\n---\n\nMy own version.\n',
    )
    const skill = await loadSkill('connect-a-service')
    expect(skill?.dir).toBe('.agents/skills/connect-a-service')
    expect(skill?.body).toContain('My own version.')
    expect((await listSkills()).filter((s) => s.name === 'connect-a-service')).toHaveLength(1)
  })
})
