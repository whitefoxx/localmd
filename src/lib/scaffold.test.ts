import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from '@/lib/fs'
import { createMemoryRoot } from '@/lib/memfs'
import { scaffoldKb } from './scaffold'

beforeEach(() => {
  fs.setRoot(createMemoryRoot())
})

describe('scaffoldKb', () => {
  it('writes the starter layout once and never overwrites', async () => {
    const first = await scaffoldKb()
    expect(first).toContain('AGENTS.md')
    expect(first).toContain('wiki/index.md')
    expect(first).toContain('wiki/log.md')
    await fs.writeFile('AGENTS.md', 'mine')
    expect(await scaffoldKb()).toEqual([])
    expect(await fs.tryReadFile('AGENTS.md')).toBe('mine')
  })

  /** Intent is the one thing an agent cannot read off a tree, so the schema
   *  asks for it — as an empty section the user may leave empty or delete,
   *  never as a field anything checks. */
  it('asks what the KB is for without requiring an answer', async () => {
    await scaffoldKb()
    const agents = (await fs.tryReadFile('AGENTS.md'))!
    expect(agents).toContain('## Purpose')
    expect(agents).toMatch(/leave it blank and the agent will not invent one/i)
    expect(agents.indexOf('## Purpose')).toBeLessThan(agents.indexOf('## Structure'))
  })

  /** A log nobody writes in is the normal state of a new KB — so the file has
   *  to say that, and say it can go. */
  it('starts the log empty and disposable', async () => {
    await scaffoldKb()
    const log = (await fs.tryReadFile('wiki/log.md'))!
    expect(log).toMatch(/## YYYY-MM-DD/)
    expect(log).toMatch(/delete this file/i)
  })
})
