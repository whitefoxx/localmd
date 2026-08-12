import { beforeEach, describe, expect, it, vi } from 'vitest'

const fs = { writeFile: vi.fn(), removeDir: vi.fn(), tryReadFile: vi.fn() }
vi.mock('@/lib/fs', () => ({
  writeFile: (...a: unknown[]) => fs.writeFile(...a),
  removeDir: (...a: unknown[]) => fs.removeDir(...a),
  tryReadFile: (...a: unknown[]) => fs.tryReadFile(...a),
}))

import {
  TOOL_RESULTS_DIR,
  clipWithRecall,
  dropToolResults,
  recallPathIn,
  storeToolResult,
  toolResultPath,
} from './toolResults'

const SESSION = '19c1225e-0586-45cb-bf79-77f84645873f'
const TOOL = 'mcp__localmd-connect__generic__run_adapter'

beforeEach(() => {
  fs.writeFile.mockReset().mockResolvedValue(undefined)
  fs.removeDir.mockReset().mockResolvedValue(undefined)
  fs.tryReadFile.mockReset().mockResolvedValue('.trace/\n') // already ignored
})

describe('toolResultPath', () => {
  it('parks results under .trace/, per session, named for the tool', () => {
    const path = toolResultPath(SESSION, TOOL, 'body')
    expect(path.startsWith(`${TOOL_RESULTS_DIR}/`)).toBe(true)
    expect(path).toContain(SESSION)
    expect(path).toContain('run-adapter')
    expect(path.endsWith('.txt')).toBe(true)
  })

  it('is content-addressed, so the same result does not accumulate files', () => {
    expect(toolResultPath(SESSION, TOOL, 'same')).toBe(toolResultPath(SESSION, TOOL, 'same'))
    expect(toolResultPath(SESSION, TOOL, 'a')).not.toBe(toolResultPath(SESSION, TOOL, 'b'))
  })

  it('keeps sessions apart, so deleting one cannot take another with it', () => {
    expect(toolResultPath('aaa', TOOL, 'x')).not.toBe(toolResultPath('bbb', TOOL, 'x'))
  })
})

describe('storeToolResult', () => {
  it('writes the whole result and hands back the path', async () => {
    const text = 'x'.repeat(120_000)
    const path = await storeToolResult(SESSION, TOOL, text)
    expect(path).toBe(toolResultPath(SESSION, TOOL, text))
    expect(fs.writeFile).toHaveBeenCalledWith(path, text)
  })

  it('reports failure instead of throwing — a full disk must not fail the call', async () => {
    fs.writeFile.mockRejectedValue(new Error('QuotaExceededError'))
    await expect(storeToolResult(SESSION, TOOL, 'body')).resolves.toBeNull()
  })

  it("keeps what it parks out of the user's repo", async () => {
    fs.tryReadFile.mockResolvedValue('') // nothing ignored yet
    await storeToolResult(SESSION, TOOL, 'body')
    expect(fs.writeFile).toHaveBeenCalledWith('.gitignore', '.trace/\n')
  })
})

describe('dropToolResults', () => {
  it('removes the session directory', async () => {
    await dropToolResults(SESSION)
    expect(fs.removeDir).toHaveBeenCalledWith(`${TOOL_RESULTS_DIR}/${SESSION}`)
  })

  it('is quiet when the session never stored anything', async () => {
    fs.removeDir.mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotFoundError' }))
    await expect(dropToolResults(SESSION)).resolves.toBeUndefined()
  })
})

describe('clipWithRecall', () => {
  it('leaves a result that fits completely alone', () => {
    expect(clipWithRecall('short', 4000, 'p.txt')).toBe('short')
  })

  it('points at the file and the offset to continue from', () => {
    const out = clipWithRecall('y'.repeat(50_000), 40_000, '.trace/tool-results/s/t-1234abcd.txt')
    expect(out.slice(0, 40_000)).toBe('y'.repeat(40_000))
    expect(out).toContain('.trace/tool-results/s/t-1234abcd.txt')
    expect(out).toContain('offset=40000')
    // The whole point: it must not send the agent back to the tool.
    expect(out).toContain('rather than calling this tool again')
    expect(out).toContain('50000')
  })

  it('falls back to the plain budget note when the result could not be saved', () => {
    const text = 'z'.repeat(50_000)
    expect(clipWithRecall(text, 40_000, null)).toBe(
      `${'z'.repeat(40_000)}\n\n[truncated: 50000 chars total]`,
    )
  })

  it('recommends digesting via run_subagent when the remainder is large', () => {
    const out = clipWithRecall('y'.repeat(105_000), 40_000, '.trace/tool-results/s/t-1234abcd.txt')
    expect(out.slice(0, 40_000)).toBe('y'.repeat(40_000))
    expect(out).toContain('run_subagent')
    expect(out).toContain('.trace/tool-results/s/t-1234abcd.txt')
    // The inline continuation stays available for targeted extraction.
    expect(out).toContain('offset=40000')
  })
})

describe('recallPathIn', () => {
  it('finds the stored path inside a clip note', () => {
    const path = '.trace/tool-results/s/t-1234abcd.txt'
    expect(recallPathIn(clipWithRecall('y'.repeat(50_000), 40_000, path))).toBe(path)
    expect(recallPathIn(clipWithRecall('y'.repeat(105_000), 40_000, path))).toBe(path)
  })

  it('returns null when the text never mentions a stored result', () => {
    expect(recallPathIn('an ordinary tool result')).toBeNull()
    expect(recallPathIn(clipWithRecall('y'.repeat(50_000), 40_000, null))).toBeNull()
  })
})
