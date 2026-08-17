/**
 * The tab janitor for localmd Connect: a background tab a call opened is closed
 * when the turn ends, a page shown to the user is not, and one session's reap
 * never touches another's.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  openedTabFromResult,
  noteOpenedTab,
  reapOpenedTabs,
  __resetOpenedTabs,
} from './connectJanitor'

beforeEach(() => {
  __resetOpenedTabs()
})

/** What open_url answers with, as the extension serializes it. */
function opened(tabId: number, active = false): string {
  return JSON.stringify({ tabId, created_tab: true, url: 'https://example.com/', active })
}

/** Collect what a reap tried to close. */
function closer(): {
  close: (serverId: string, tabId: number) => Promise<void>
  calls: [string, number][]
} {
  const calls: [string, number][] = []
  return {
    calls,
    close: async (serverId, tabId) => {
      calls.push([serverId, tabId])
    },
  }
}

describe('openedTabFromResult', () => {
  it('takes the tab a background open created', () => {
    expect(openedTabFromResult(opened(7))).toBe(7)
  })

  it('takes a tab from any tool that marks created_tab', () => {
    // get_page_text {keep_open: true} — no `active`, no url.
    expect(openedTabFromResult(JSON.stringify({ tabId: 9, created_tab: true }))).toBe(9)
  })

  it('leaves a page opened in front of the user alone', () => {
    expect(openedTabFromResult(opened(7, true))).toBeNull()
  })

  it('ignores a result that created no tab', () => {
    // A read of a tab the user attached, and a one-shot read that closed its own.
    expect(openedTabFromResult(JSON.stringify({ tabId: 7, text: 'hi' }))).toBeNull()
    expect(openedTabFromResult(JSON.stringify({ tabId: 7, tab_closed: true }))).toBeNull()
  })

  it('ignores anything that is not a JSON object', () => {
    expect(openedTabFromResult('Error: not connected')).toBeNull()
    expect(openedTabFromResult('[{"created_tab":true,"tabId":7}]')).toBeNull()
  })
})

describe('reapOpenedTabs', () => {
  it('closes what the turn opened, once each', () => {
    noteOpenedTab('s1', 'srv', opened(7))
    noteOpenedTab('s1', 'srv', opened(8))
    noteOpenedTab('s1', 'srv', opened(7)) // same tab reported twice
    const { close, calls } = closer()
    return reapOpenedTabs('s1', close).then((n) => {
      expect(n).toBe(2)
      expect(calls).toEqual([
        ['srv', 7],
        ['srv', 8],
      ])
    })
  })

  it('forgets what it closed, so a second turn closes nothing', async () => {
    noteOpenedTab('s1', 'srv', opened(7))
    await reapOpenedTabs('s1', closer().close)
    const { close, calls } = closer()
    expect(await reapOpenedTabs('s1', close)).toBe(0)
    expect(calls).toEqual([])
  })

  it('leaves another session’s tabs alone', async () => {
    noteOpenedTab('s1', 'srv', opened(7))
    noteOpenedTab('s2', 'srv', opened(8))
    const { close, calls } = closer()
    await reapOpenedTabs('s1', close)
    expect(calls).toEqual([['srv', 7]])
    const second = closer()
    await reapOpenedTabs('s2', second.close)
    expect(second.calls).toEqual([['srv', 8]])
  })

  it('forgets a tab whose close failed — the usual reason is it is already gone', async () => {
    noteOpenedTab('s1', 'srv', opened(7))
    noteOpenedTab('s1', 'srv', opened(8))
    const calls: number[] = []
    const closed = await reapOpenedTabs('s1', async (_srv, tabId) => {
      calls.push(tabId)
      if (tabId === 7) throw new Error('no tab with id 7')
    })
    expect(calls).toEqual([7, 8])
    expect(closed).toBe(1) // 8 only
    // Neither is retried: a dead tab is not a job left undone.
    const again = closer()
    expect(await reapOpenedTabs('s1', again.close)).toBe(0)
  })

  it('keeps a tab recorded while the reap was running', async () => {
    noteOpenedTab('s1', 'srv', opened(7))
    const calls: number[] = []
    await reapOpenedTabs('s1', async (_srv, tabId) => {
      calls.push(tabId)
      // A tool still in flight answers mid-reap.
      if (tabId === 7) noteOpenedTab('s1', 'srv', opened(9))
    })
    expect(calls).toEqual([7])
    const next = closer()
    await reapOpenedTabs('s1', next.close)
    expect(next.calls).toEqual([['srv', 9]])
  })

  it('routes each tab to the server that opened it', async () => {
    noteOpenedTab('s1', 'a', opened(7))
    noteOpenedTab('s1', 'b', opened(7)) // same id, different browser
    const { close, calls } = closer()
    expect(await reapOpenedTabs('s1', close)).toBe(2)
    expect(calls).toEqual([
      ['a', 7],
      ['b', 7],
    ])
  })
})
