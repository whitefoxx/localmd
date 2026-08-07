import { beforeEach, describe, expect, it, vi } from 'vitest'

const fs = { tryReadFile: vi.fn(), writeFile: vi.fn() }
vi.mock('@/lib/fs', () => ({
  tryReadFile: (...a: unknown[]) => fs.tryReadFile(...a),
  writeFile: (...a: unknown[]) => fs.writeFile(...a),
}))

import { ensureIgnored } from './gitignore'

beforeEach(() => {
  fs.tryReadFile.mockReset().mockResolvedValue(null)
  fs.writeFile.mockReset().mockResolvedValue(undefined)
})

describe('ensureIgnored', () => {
  it('creates .gitignore when the KB has none', async () => {
    await ensureIgnored('.trace')
    expect(fs.writeFile).toHaveBeenCalledWith('.gitignore', '.trace/\n')
  })

  it('appends without disturbing what is already there', async () => {
    fs.tryReadFile.mockResolvedValue('node_modules/\n*.log\n')
    await ensureIgnored('.tmp')
    expect(fs.writeFile).toHaveBeenCalledWith('.gitignore', 'node_modules/\n*.log\n.tmp/\n')
  })

  it('adds the missing newline a hand-edited file may lack', async () => {
    fs.tryReadFile.mockResolvedValue('*.log')
    await ensureIgnored('.trace')
    expect(fs.writeFile).toHaveBeenCalledWith('.gitignore', '*.log\n.trace/\n')
  })

  it.each(['.trace/', '.trace', '  .trace/  '])('leaves %o alone — already covered', async (l) => {
    fs.tryReadFile.mockResolvedValue(`# mine\n${l}\n`)
    await ensureIgnored('.trace')
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('does not mistake a longer name for the entry', async () => {
    fs.tryReadFile.mockResolvedValue('.tracer/\n')
    await ensureIgnored('.trace')
    expect(fs.writeFile).toHaveBeenCalledWith('.gitignore', '.tracer/\n.trace/\n')
  })

  it('normalizes the entry, so a trailing slash on the caller changes nothing', async () => {
    await ensureIgnored('.trace/')
    expect(fs.writeFile).toHaveBeenCalledWith('.gitignore', '.trace/\n')
  })
})
