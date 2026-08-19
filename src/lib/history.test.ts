import { describe, it, expect } from 'vitest'
import {
  trimHistory,
  trimCandidates,
  mergeUserRuns,
  serializeForSizing,
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
    expect((toolParts[0].output as Rec).value).toContain('trimmed')
    const inner = (toolParts[1].output as Rec).value as Rec[]
    expect(inner[0].text).toContain('trimmed')
    expect(inner[1].type).toBe('text') // media replaced with a text stub
    const asst = parts(out[1])
    expect((asst[1].input as Rec).content).toBe('[trimmed]')
    expect((asst[0].input as Rec).path).toBe('a.md') // small input untouched
  })

  it('stubs tool traffic outside the last turn even inside the media window', () => {
    // Default windows: toolKeepTurns=1 < keepTurns=2. The first turn's tool
    // result goes — the assistant reply that follows it is the digest that
    // survives — even though its images/reasoning would still be kept.
    const out = trimHistory(history, { maxChars: 100 })
    expect((parts(out[2])[0].output as Rec).value).toContain('trimmed')
    expect((parts(out[1])[1].input as Rec).content).toBe('[trimmed]')
  })

  it('toolKeepTurns widens the tool window back out', () => {
    const out = trimHistory(history, { keepTurns: 2, toolKeepTurns: 2, maxChars: 100 })
    expect((parts(out[2])[0].output as Rec).value).toBe(BIG)
  })

  it('points the stub at the recall path when the caller stored the result', () => {
    const recallPaths = new Map([['t1', '.trace/tool-results/s/mcp-fetch-1a2b3c4d.txt']])
    const out = trimHistory(history, { maxChars: 100, recallPaths })
    const value = (parts(out[2])[0].output as Rec).value as string
    expect(value).toContain('.trace/tool-results/s/mcp-fetch-1a2b3c4d.txt')
    expect(value).toContain('read_file')
    // The content-array part (t2) has no stored path — generic stub.
    const inner = (parts(out[2])[1].output as Rec).value as Rec[]
    expect(inner[0].text).toContain('call the relevant tool again')
  })

  it('keeps images and reasoning for keepTurns while their tool results go', () => {
    const h: ModelMessage[] = [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '看这张图' },
          { type: 'image', image: 'data:image/png;base64,AAAA' },
        ],
      } as unknown as ModelMessage,
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking about the picture' },
          { type: 'tool-call', toolCallId: 'a2', toolName: 'fetch_url', input: { url: BIG } },
        ],
      } as unknown as ModelMessage,
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'a2', toolName: 'fetch_url', output: { type: 'text', value: BIG } },
        ],
      },
      { role: 'assistant', content: '第二答' },
      { role: 'user', content: '第三问' },
      { role: 'assistant', content: '第三答' },
    ]
    const out = trimHistory(h, { maxChars: 100 })
    // Turn 2 sits between the tool cutoff and the media cutoff: its tool
    // result and oversized input are stubbed, its image and reasoning stay.
    expect(parts(out[2])[1].type).toBe('image')
    expect(parts(out[3]).map((p) => p.type)).toEqual(['reasoning', 'tool-call'])
    expect((parts(out[3])[1].input as Rec).url).toBe('[trimmed]')
    expect((parts(out[4])[0].output as Rec).value).toContain('trimmed')
    // Turn 3 (the last) is untouched.
    expect(out[6].content).toBe('第三问')
  })

  it('does not modify string-content messages', () => {
    const out = trimHistory(history, { keepTurns: 1, maxChars: 100 })
    expect(out[0].content).toBe('第一轮问题')
    expect(out[3].content).toBe('第一轮回答')
  })
})

describe('trimCandidates', () => {
  const history: ModelMessage[] = [
    { role: 'user', content: '第一轮问题' },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 't1', toolName: 'mcp__x__fetch', output: { type: 'text', value: BIG } },
        { type: 'tool-result', toolCallId: 't2', toolName: 'read_file', output: { type: 'text', value: 'small' } },
        {
          type: 'tool-result',
          toolCallId: 't3',
          toolName: 'view_image',
          output: { type: 'content', value: [{ type: 'text', text: BIG }] },
        },
      ],
    },
    { role: 'assistant', content: '第一轮回答' },
    { role: 'user', content: '第二轮问题' },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 't4', toolName: 'mcp__x__fetch', output: { type: 'text', value: BIG } },
      ],
    },
    { role: 'assistant', content: '第二轮回答' },
  ]

  it('names the oversized text results the trim would destroy', () => {
    const out = trimCandidates(history, { maxChars: 100 })
    expect(out).toEqual([{ toolCallId: 't1', toolName: 'mcp__x__fetch', text: BIG }])
  })

  it('spares the last turn, small results, and content-array outputs', () => {
    const ids = trimCandidates(history, { maxChars: 100 }).map((c) => c.toolCallId)
    expect(ids).not.toContain('t2') // under maxChars
    expect(ids).not.toContain('t3') // content-array (built-in media)
    expect(ids).not.toContain('t4') // inside the tool keep window
  })
})

describe('serializeForSizing', () => {
  const size = (v: unknown): number => serializeForSizing(v).length

  it('measures serialized size', () => {
    expect(size([{ a: 'xx' }])).toBeGreaterThan(8)
  })

  it('counts media payloads as a constant, not their base64 length', () => {
    const b64 = 'A'.repeat(300_000)
    const withImage: ModelMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'image', image: `data:image/png;base64,${b64}` },
        ],
      } as unknown as ModelMessage,
    ]
    expect(size(withImage)).toBeLessThan(1000)
    // tool-result file parts carry base64 under data.data
    const toolResult = [
      { type: 'file', data: { type: 'data', data: b64 }, mediaType: 'image/png' },
    ]
    expect(size(toolResult)).toBeLessThan(500)
    // ordinary long text still counts in full
    expect(size([{ type: 'text', text: 'x'.repeat(50_000) }])).toBeGreaterThan(50_000)
  })
})

describe('reasoning stripping', () => {
  it('drops old reasoning parts but never empties a message', () => {
    const h: ModelMessage[] = [
      { role: 'user', content: 'q1' },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'chain of thought ' + BIG },
          { type: 'text', text: 'answer 1' },
        ],
      } as unknown as ModelMessage,
      {
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'only reasoning' }],
      } as unknown as ModelMessage,
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'answer 2' },
    ]
    const out = trimHistory(h, { keepTurns: 1, maxChars: 100 })
    expect(parts(out[1]).map((p) => p.type)).toEqual(['text'])
    // a reasoning-only message keeps its content rather than turning invalid
    expect(parts(out[2]).map((p) => p.type)).toEqual(['reasoning'])
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
    expect(t).toContain('User: 找 bug')
    expect(t).toContain('[call read_file')
    expect(t).toContain('…') // clipped tool result
  })

  it('keeps role alternation valid in the compacted prefix', () => {
    const p = compactedPrefix('摘要内容')
    expect(p.user).toContain('摘要内容')
    expect(p.assistant.length).toBeGreaterThan(0)
  })
})

describe('mergeUserRuns', () => {
  const user = (text: string): ModelMessage => ({ role: 'user', content: text })
  const bot = (text: string): ModelMessage => ({ role: 'assistant', content: text })

  it('leaves an alternating history alone, by identity', () => {
    const h = [user('q1'), bot('a1'), user('q2')]
    expect(mergeUserRuns(h)).toBe(h)
  })

  it('merges the run a failed turn left behind', () => {
    // q2 died with a provider error, so it stayed in the history unanswered;
    // "go on" twice used to append two more user messages behind it.
    const out = mergeUserRuns([user('q1'), bot('a1'), user('q2'), user('go on'), user('go on')])
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(out[2].content).toBe('q2\n\ngo on\n\ngo on')
  })

  it('never lets two user messages end up adjacent', () => {
    const out = mergeUserRuns([user('a'), user('b'), bot('r'), user('c'), user('d')])
    for (let i = 1; i < out.length; i++) {
      expect(out[i].role === 'user' && out[i - 1].role === 'user').toBe(false)
    }
  })

  it('concatenates parts when either side carries images', () => {
    const withImage: ModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'look at this' },
        { type: 'image', image: 'data:...' },
      ],
    }
    const out = mergeUserRuns([withImage, user('and now?')])
    expect(out).toHaveLength(1)
    expect(out[0].content).toEqual([
      { type: 'text', text: 'look at this' },
      { type: 'image', image: 'data:...' },
      { type: 'text', text: 'and now?' },
    ])
  })

  it('is idempotent — re-merging a merged history changes nothing', () => {
    const once = mergeUserRuns([user('q'), user('go on')])
    expect(mergeUserRuns(once)).toBe(once)
  })

  it('does not touch tool messages between assistant turns', () => {
    const h: ModelMessage[] = [
      user('q'),
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: '1', toolName: 't', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: '1', toolName: 't', output: { type: 'text', value: 'r' } }] },
      bot('done'),
    ]
    expect(mergeUserRuns(h)).toBe(h)
  })
})
