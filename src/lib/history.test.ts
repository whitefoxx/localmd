import { describe, it, expect } from 'vitest'
import {
  trimHistory,
  estimateChars,
  splitForCompaction,
  renderTranscript,
  compactedPrefix,
} from './history'
import type { ModelMessage } from 'ai'

const BIG = 'x'.repeat(5000)

// Loosely-typed accessors — the AI SDK part unions are validated at the call
// boundary; the trimmer treats them structurally.
type Rec = Record<string, unknown>
const parts = (m: ModelMessage): Rec[] => m.content as unknown as Rec[]

describe('trimHistory', () => {
  const history: ModelMessage[] = [
    { role: 'user', content: '第一轮问题' },
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 't1', toolName: 'read_file', input: { path: 'a.md' } },
        { type: 'tool-call', toolCallId: 't2', toolName: 'write_file', input: { path: 'b.md', content: BIG } },
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 't1', toolName: 'read_file', output: { type: 'text', value: BIG } },
        {
          type: 'tool-result',
          toolCallId: 't2',
          toolName: 'view_image',
          output: {
            type: 'content',
            value: [
              { type: 'text', text: BIG },
              { type: 'file', data: { type: 'data', data: BIG }, mediaType: 'image/png' },
            ],
          },
        },
      ],
    },
    { role: 'assistant', content: '第一轮回答' },
    { role: 'user', content: '第二轮问题' },
    { role: 'assistant', content: '第二轮回答' },
  ]

  it('stubs old large tool results, images, and tool-call inputs', () => {
    const out = trimHistory(history, { keepTurns: 1, maxChars: 100 })
    const toolParts = parts(out[2])
    expect((toolParts[0].output as Rec).value).toContain('已修剪')
    const inner = (toolParts[1].output as Rec).value as Rec[]
    expect(inner[0].text).toContain('已修剪')
    expect(inner[1].type).toBe('text') // media replaced with a text stub
    const asst = parts(out[1])
    expect((asst[1].input as Rec).content).toBe('[已修剪]')
    expect((asst[0].input as Rec).path).toBe('a.md') // small input untouched
  })

  it('keeps the last keepTurns real user turns untouched', () => {
    // keepTurns=2 → cutoff at the first user turn → nothing before it to trim.
    const out = trimHistory(history, { keepTurns: 2, maxChars: 100 })
    expect((parts(out[2])[0].output as Rec).value).toBe(BIG)
  })

  it('does not modify string-content messages', () => {
    const out = trimHistory(history, { keepTurns: 1, maxChars: 100 })
    expect(out[0].content).toBe('第一轮问题')
    expect(out[3].content).toBe('第一轮回答')
  })
})

describe('estimateChars', () => {
  it('measures serialized size', () => {
    expect(estimateChars([{ a: 'xx' }])).toBeGreaterThan(8)
  })
})

describe('compaction helpers', () => {
  it('splits at the keep-turns boundary and refuses when nothing is old', () => {
    const h: ModelMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
      { role: 'user', content: 'e' },
    ]
    const split = splitForCompaction(h, 2)!
    expect(split.old.map((m) => m.content)).toEqual(['a', 'b'])
    expect(split.recent.map((m) => m.content)).toEqual(['c', 'd', 'e'])
    expect(splitForCompaction(h.slice(2), 2)).toBeNull()
  })

  it('renders transcripts with tool calls clipped', () => {
    const t = renderTranscript([
      { role: 'user', content: '找 bug' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: '1', toolName: 'read_file', input: { path: 'a.md' } },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: '1', toolName: 'read_file', output: { type: 'text', value: 'y'.repeat(500) } },
        ],
      },
    ])
    expect(t).toContain('用户: 找 bug')
    expect(t).toContain('[调用 read_file')
    expect(t).toContain('…') // clipped tool result
  })

  it('keeps role alternation valid in the compacted prefix', () => {
    const p = compactedPrefix('摘要内容')
    expect(p.user).toContain('摘要内容')
    expect(p.assistant.length).toBeGreaterThan(0)
  })
})
