import { describe, expect, it } from 'vitest'
import {
  presentCall,
  presentResult,
  hasArgs,
  formatDuration,
  STOPPED_RESULT,
  SYNTHETIC_TOOL_ROWS,
} from './present'
import { TOOLS, RUNNER_TOOL_NAMES } from '@/agent/tools'
import type { MessagePart } from '@/stores/chat'

type ToolPart = Extract<MessagePart, { type: 'tool' }>

function call(over: Partial<ToolPart> = {}): ToolPart {
  return { type: 'tool', name: 'read_file', detail: 'read wiki/a.md', ...over }
}

/**
 * The reason this file exists: the glyph table used to live inside ChatPanel,
 * where nothing connected it to the tool list. Fourteen of thirty tools had
 * quietly fallen off it and rendered as an anonymous wrench. Adding a tool now
 * fails here instead.
 */
describe('the glyph table and the toolbox stay in lockstep', () => {
  const everyRow = [...TOOLS.map((t) => t.name), ...RUNNER_TOOL_NAMES, ...SYNTHETIC_TOOL_ROWS]

  it('gives every tool a glyph of its own', () => {
    const anonymous = everyRow.filter(
      (name) => presentCall(call({ name, status: 'done', result: 'x' })).icon === 'codicon-pass',
    )
    expect(anonymous).toEqual([])
  })

  it('gives no two unrelated tools a confusingly shared glyph by accident', () => {
    // write_file and edit_file share one on purpose (both are "the agent
    // changed this file"); nothing else may.
    const byIcon = new Map<string, string[]>()
    for (const name of everyRow) {
      const { icon } = presentCall(call({ name, status: 'done', result: 'x' }))
      byIcon.set(icon, [...(byIcon.get(icon) ?? []), name])
    }
    const shared = [...byIcon.values()].filter((names) => names.length > 1)
    expect(shared).toEqual([['write_file', 'edit_file']])
  })
})

describe('presentResult', () => {
  it('reports a running call as pending, whatever it has so far', () => {
    expect(presentResult(call({ status: 'running', result: 'partial' })).kind).toBe('pending')
  })

  it('carries a failure’s own first line, without the Error: prefix', () => {
    const r = presentResult(
      call({ status: 'error', result: 'Error: no such file: wiki/gone.md\n  at read_file' }),
    )
    expect(r).toEqual({ kind: 'failed', message: 'no such file: wiki/gone.md' })
  })

  it('caps a rambling failure rather than letting it push the row apart', () => {
    const r = presentResult(call({ status: 'error', result: `Error: ${'x'.repeat(500)}` }))
    expect(r.message).toHaveLength(121) // 120 + the ellipsis
    expect(r.message?.endsWith('…')).toBe(true)
  })

  it('says nothing when a failure said nothing', () => {
    expect(presentResult(call({ status: 'error', result: '' }))).toEqual({ kind: 'failed' })
  })

  it('tells a user-pressed stop apart from a failure', () => {
    // A stop is the user getting what they asked for; painting it red says the
    // app broke.
    expect(presentResult(call({ status: 'error', result: STOPPED_RESULT })).kind).toBe('stopped')
  })

  it('says so when a finished call returned nothing at all', () => {
    expect(presentResult(call({ status: 'done', result: '' })).kind).toBe('empty')
    expect(presentResult(call({ status: 'done', result: '   \n ' })).kind).toBe('empty')
  })

  it('stays quiet about a call that returned something', () => {
    expect(presentResult(call({ status: 'done', result: 'ok' })).kind).toBe('ok')
  })

  it('claims nothing about an untracked call', () => {
    // Nested subagent rows carry no status: "returned nothing" would be a
    // statement the part cannot support.
    expect(presentResult(call()).kind).toBe('ok')
  })
})

describe('presentCall', () => {
  it('spins while running, whatever tool it is', () => {
    expect(presentCall(call({ name: 'git_push', status: 'running' })).icon).toContain(
      'codicon-modifier-spin',
    )
    expect(presentCall(call({ status: 'running' })).tone).toBe('running')
  })

  it('marks a failure and mutes a stop', () => {
    expect(presentCall(call({ status: 'error', result: 'Error: boom' })).tone).toBe('failed')
    expect(presentCall(call({ status: 'error', result: STOPPED_RESULT })).tone).toBe('stopped')
  })

  it('falls back to a check for an external tool it has never heard of', () => {
    const p = call({ name: 'mcp__notion__search', status: 'done', result: '{}' })
    expect(presentCall(p).icon).toBe('codicon-pass')
  })

  it('passes the tool’s own summary through as the label', () => {
    expect(presentCall(call({ detail: 'read wiki/a.md @40' })).label).toBe('read wiki/a.md @40')
  })

  it('is expandable exactly when there is something behind the chevron', () => {
    expect(presentCall(call()).expandable).toBe(false)
    expect(presentCall(call({ result: 'x' })).expandable).toBe(true)
    expect(presentCall(call({ args: { path: 'a.md' } })).expandable).toBe(true)
    // An empty args object is not something to inspect.
    expect(presentCall(call({ args: {} })).expandable).toBe(false)
  })

  it('renders a reloaded part exactly as it rendered live', () => {
    // The whole reason these are pure: a session read back from disk has only
    // the persisted part, and must not look different for it.
    const live = call({ name: 'git_commit', status: 'done', result: 'committed 3 files' })
    const reloaded: ToolPart = JSON.parse(JSON.stringify(live))
    expect(presentCall(reloaded)).toEqual(presentCall(live))
  })
})

describe('hasArgs', () => {
  it('ignores absent and empty argument objects', () => {
    expect(hasArgs(call())).toBe(false)
    expect(hasArgs(call({ args: {} }))).toBe(false)
    expect(hasArgs(call({ args: { q: 'x' } }))).toBe(true)
  })
})

describe('formatDuration', () => {
  it('keeps tenths while they mean something', () => {
    expect(formatDuration(1234)).toBe('1.2s')
    expect(formatDuration(0)).toBe('0.0s')
  })

  it('drops them once the number is big enough not to need them', () => {
    expect(formatDuration(10_000)).toBe('10s')
    expect(formatDuration(94_400)).toBe('94s')
  })
})
