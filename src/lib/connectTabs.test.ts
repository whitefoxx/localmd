import { describe, it, expect } from 'vitest'
import { parseTabs, filterTabs, describeTabs, excludeSelf } from './connectTabs'

/** What the extension actually answers with (shape verified against the real
 *  localmd Connect build): a count, the rows, and tab groups we ignore. */
const REAL = JSON.stringify({
  count: 2,
  tabs: [
    {
      tabId: 331,
      title: 'Issue #42 · foo/bar',
      url: 'https://github.com/foo/bar/issues/42',
      windowId: 1,
      active: true,
      groupId: -1,
      controlled: false,
    },
    {
      tabId: 332,
      title: 'Hacker News',
      url: 'https://news.ycombinator.com/',
      windowId: 1,
      active: false,
      groupId: -1,
      controlled: false,
    },
  ],
  groups: [],
})

describe('parseTabs', () => {
  it('reads the rows out of a real list_tabs result', () => {
    expect(parseTabs(REAL)).toEqual([
      { tabId: 331, title: 'Issue #42 · foo/bar', url: 'https://github.com/foo/bar/issues/42' },
      { tabId: 332, title: 'Hacker News', url: 'https://news.ycombinator.com/' },
    ])
  })

  it('accepts a bare array, and rows under some other key', () => {
    const rows = [{ tabId: 1, title: 'A', url: 'https://a.example' }]
    expect(parseTabs(JSON.stringify(rows))).toHaveLength(1)
    expect(parseTabs(JSON.stringify({ result: rows }))).toHaveLength(1)
  })

  it('takes tab_id / id as spellings of the same field', () => {
    expect(parseTabs(JSON.stringify([{ tab_id: 7, title: 'A', url: 'https://a.example' }]))[0]).toMatchObject({ tabId: 7 })
    expect(parseTabs(JSON.stringify([{ id: 8, title: 'B', url: 'https://b.example' }]))[0]).toMatchObject({ tabId: 8 })
  })

  it('falls back to the URL when a tab has no title, and drops rows with no id', () => {
    const out = parseTabs(
      JSON.stringify([
        { tabId: 1, title: '   ', url: 'https://a.example/x' },
        { title: 'no id at all', url: 'https://b.example' },
      ]),
    )
    expect(out).toEqual([{ tabId: 1, title: 'https://a.example/x', url: 'https://a.example/x' }])
  })

  it('dedupes by tab id', () => {
    const dup = [
      { tabId: 5, title: 'A', url: 'https://a.example' },
      { tabId: 5, title: 'A again', url: 'https://a.example' },
    ]
    expect(parseTabs(JSON.stringify(dup))).toHaveLength(1)
  })

  it('yields nothing for a bridge error, rather than guessing', () => {
    expect(parseTabs('Error: the extension is not connected')).toEqual([])
    expect(parseTabs('')).toEqual([])
  })
})

describe('excludeSelf', () => {
  const tabs = [
    { tabId: 1, title: 'localmd', url: 'http://localhost:5173/?demo=1' },
    { tabId: 2, title: 'localmd (hosted)', url: 'https://localmd.app/' },
    { tabId: 3, title: 'Hacker News', url: 'https://news.ycombinator.com/' },
  ]

  it('drops the tab the app is running in', () => {
    expect(excludeSelf(tabs, 'http://localhost:5173/?demo=1').map((t) => t.tabId)).toEqual([2, 3])
  })

  it('keeps another localmd at a different address', () => {
    expect(excludeSelf(tabs, 'https://localmd.app/').map((t) => t.tabId)).toEqual([1, 3])
  })

  it('ignores the fragment, which is ours to change and not a different page', () => {
    expect(excludeSelf(tabs, 'http://localhost:5173/?demo=1#help').map((t) => t.tabId)).toEqual([
      2, 3,
    ])
  })
})

describe('filterTabs', () => {
  const tabs = parseTabs(REAL)

  it('matches the title before the URL', () => {
    expect(filterTabs(tabs, 'hacker').map((t) => t.tabId)).toEqual([332])
    expect(filterTabs(tabs, 'github').map((t) => t.tabId)).toEqual([331])
  })

  it('lists everything for an empty query', () => {
    expect(filterTabs(tabs, '')).toHaveLength(2)
  })

  it('keeps whatever extra fields the caller carries', () => {
    const withServer = tabs.map((t) => ({ ...t, serverId: 'connect' }))
    expect(filterTabs(withServer, 'hacker')[0].serverId).toBe('connect')
  })
})

describe('describeTabs', () => {
  it('sends addresses, never contents', () => {
    const block = describeTabs(parseTabs(REAL))
    expect(block).toContain('tab_id 331')
    expect(block).toContain('https://github.com/foo/bar/issues/42')
    // The instruction the agent needs: read them yourself, with this id.
    expect(block).toMatch(/get_page_text/)
    expect(block).toMatch(/NOT included/)
  })

  it('is empty when nothing is attached, so no bytes are spent', () => {
    expect(describeTabs([])).toBe('')
  })
})
