import { describe, it, expect } from 'vitest'
import { describeQuote } from './quoteContext'
import { hasLoneSurrogate } from './wellFormed'
import type { QuoteScope } from './quoteContext'
import type { UiMessage } from '@/stores/chat'
import type { SelectionRef } from '@/stores/composer'

const MESSAGES: UiMessage[] = [
  { id: 1, role: 'user', parts: [{ type: 'text', text: '今天有什么 AI 新闻' }] },
  {
    id: 2,
    role: 'assistant',
    parts: [
      { type: 'thinking', text: 'internal' },
      { type: 'tool', name: 'web_search', detail: 'hn front page' },
      { type: 'text', text: '今天的头条:\n#3 Open-weight AI is having a moment' },
    ],
  },
  { id: 3, role: 'user', parts: [{ type: 'text', text: '第一条呢' }] },
  { id: 4, role: 'assistant', parts: [{ type: 'text', text: '第一条讲的是……' }] },
]

const scope = (o: Partial<QuoteScope> = {}): QuoteScope => ({
  sessionId: 's1',
  messages: MESSAGES,
  ...o,
})

const ref = (o: Partial<SelectionRef>): SelectionRef => ({
  id: 'r1',
  text: '#3 Open-weight AI is having a moment',
  pinned: false,
  ...o,
})

describe('describeQuote — file passages', () => {
  it('names the file, its page and its section', () => {
    const s = ref({ file: 'raw/papers/a.pdf', from: { page: 12 } })
    expect(describeQuote(s, scope())).toBe('Text the user selected in raw/papers/a.pdf (page 12)')

    const md = ref({ file: 'wiki/notes.md', from: { heading: 'Results' } })
    expect(describeQuote(md, scope())).toBe(
      'Text the user selected in wiki/notes.md (under the heading “Results”)',
    )
  })

  it('marks the file as the one on screen only when it still is', () => {
    const s = ref({ file: 'wiki/notes.md' })
    expect(describeQuote(s, scope({ viewing: 'wiki/notes.md' }))).toContain('the file open on screen')
    expect(describeQuote(s, scope({ viewing: 'wiki/other.md' }))).toBe(
      'Text the user selected in wiki/notes.md',
    )
  })
})

describe('describeQuote — reply passages', () => {
  it('says how far back the reply was and how it opened', () => {
    const s = ref({ from: { sessionId: 's1', messageId: 2 } })
    const out = describeQuote(s, scope())
    expect(out).toContain('the reply before your most recent one')
    expect(out).toContain('今天的头条') // the anchor, skipping thinking/tool parts
    expect(out).toContain('re-read that reply')
  })

  it('recognises the latest reply', () => {
    const s = ref({ from: { sessionId: 's1', messageId: 4 } })
    expect(describeQuote(s, scope())).toContain('your most recent reply')
  })

  it('counts replies, not messages, further back', () => {
    const messages: UiMessage[] = [
      { id: 10, role: 'assistant', parts: [{ type: 'text', text: 'a' }] },
      { id: 11, role: 'user', parts: [{ type: 'text', text: 'b' }] },
      { id: 12, role: 'assistant', parts: [{ type: 'text', text: 'c' }] },
      { id: 13, role: 'user', parts: [{ type: 'text', text: 'd' }] },
      { id: 14, role: 'assistant', parts: [{ type: 'text', text: 'e' }] },
    ]
    const s = ref({ from: { sessionId: 's1', messageId: 10 } })
    expect(describeQuote(s, scope({ messages }))).toContain('2 replies back')
  })

  it('warns when the quote was carried into another chat tab', () => {
    const s = ref({ from: { sessionId: 's0', messageId: 2 } })
    expect(describeQuote(s, scope())).toContain('DIFFERENT chat session')
  })

  it('falls back to the vague wording without usable provenance', () => {
    expect(describeQuote(ref({}), scope())).toBe(
      'A passage the user quoted from an earlier reply of yours in this conversation',
    )
    // id of a message that is gone (or was a user turn) — never mislabel it
    expect(describeQuote(ref({ from: { sessionId: 's1', messageId: 3 } }), scope())).toBe(
      'A passage the user quoted from an earlier reply of yours in this conversation',
    )
  })
})

describe('describeQuote — the opening anchor is safe to serialize', () => {
  /* The reply that broke a session: a markdown table whose header ends
   * "| ⭐ 分 | 💬 评论 |". The 60-unit anchor cut lands inside 💬 (U+1F4AC),
   * and the surviving half rode into the user message as `\ud83d`, which
   * DeepSeek's JSON parser refused for every later turn of that session:
   * "messages[10].content: unexpected end of hex escape". */
  const REPLY =
    '今天（2026-08-19）HN 前 30 热点，按热度排序如下：\n\n| # | 标题 | 看点/领域 | ⭐ 分 | 💬 评论 |\n|---|---|---|---|---|'
  const messages: UiMessage[] = [
    { id: 1, role: 'user', parts: [{ type: 'text', text: '总结今天 hn 热点' }] },
    { id: 2, role: 'assistant', parts: [{ type: 'text', text: REPLY }] },
  ]

  it('never leaves half a character in the anchor', () => {
    const out = describeQuote(ref({ from: { sessionId: 's1', messageId: 2 } }), {
      sessionId: 's1',
      messages,
    })
    expect(out).toContain('that reply began:')
    expect(hasLoneSurrogate(out)).toBe(false)
  })

  it('drops the emoji it cannot fit rather than half of it', () => {
    const out = describeQuote(ref({ from: { sessionId: 's1', messageId: 2 } }), {
      sessionId: 's1',
      messages,
    })
    expect(out).toContain('⭐ 分 | …”)')
    expect(out).not.toContain('💬')
  })
})
