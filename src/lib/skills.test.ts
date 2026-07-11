import { describe, it, expect } from 'vitest'
import { parseSkill } from './skills'

describe('parseSkill', () => {
  it('parses frontmatter name and description', () => {
    const s = parseSkill(
      '---\nname: ingest\ndescription: Process raw sources into wiki pages\n---\n\n# Ingest\n\nSteps…',
      'fallback',
      '.agents/skills/ingest',
    )
    expect(s.name).toBe('ingest')
    expect(s.description).toBe('Process raw sources into wiki pages')
    expect(s.body).toBe('# Ingest\n\nSteps…')
  })

  it('strips quotes and tolerates unknown keys', () => {
    const s = parseSkill(
      '---\nname: "lint"\nversion: 2\ndescription: \'Check the KB\'\n---\nbody',
      'x',
      'd',
    )
    expect(s.name).toBe('lint')
    expect(s.description).toBe('Check the KB')
  })

  it('falls back to directory name and first body line', () => {
    const s = parseSkill('# 标题\n\n第一段说明文字。\n\n更多内容', 'my-skill', 'd')
    expect(s.name).toBe('my-skill')
    expect(s.description).toBe('第一段说明文字。')
    expect(s.body).toContain('# 标题')
  })

  it('handles files with no frontmatter and no prose', () => {
    const s = parseSkill('# only a heading', 'n', 'd')
    expect(s.name).toBe('n')
    expect(s.description).toBe('')
  })

  it('handles CRLF frontmatter', () => {
    const s = parseSkill('---\r\nname: win\r\ndescription: crlf test\r\n---\r\nbody', 'x', 'd')
    expect(s.name).toBe('win')
    expect(s.description).toBe('crlf test')
    expect(s.body).toBe('body')
  })
})
