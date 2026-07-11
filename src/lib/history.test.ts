import { describe, it, expect } from 'vitest'
import { trimAnthropicHistory, trimOpenAIHistory, estimateChars } from './history'
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta'
import type OpenAI from 'openai'

const BIG = 'x'.repeat(5000)

describe('trimAnthropicHistory', () => {
  const history: BetaMessageParam[] = [
    { role: 'user', content: '第一轮问题' },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a.md' } },
        { type: 'tool_use', id: 't2', name: 'write_file', input: { path: 'b.md', content: BIG } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: BIG },
        {
          type: 'tool_result',
          tool_use_id: 't2',
          content: [
            { type: 'text', text: BIG },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: BIG } },
          ],
        },
      ],
    },
    { role: 'assistant', content: '第一轮回答' },
    { role: 'user', content: '第二轮问题' },
    { role: 'assistant', content: '第二轮回答' },
  ]

  it('stubs old large tool results, images, and tool inputs', () => {
    const out = trimAnthropicHistory(history, { keepTurns: 1, maxChars: 100 })
    const toolMsg = out[2]
    const blocks = toolMsg.content as unknown as Array<Record<string, unknown>>
    expect(blocks[0].content).toContain('已修剪')
    const inner = blocks[1].content as unknown as Array<Record<string, unknown>>
    expect(inner[0].text).toContain('已修剪')
    expect(inner[1].type).toBe('text') // image replaced
    const assistant = out[1].content as unknown as Array<Record<string, unknown>>
    expect((assistant[1].input as Record<string, unknown>).content).toBe('[已修剪]')
    expect((assistant[0].input as Record<string, unknown>).path).toBe('a.md') // small input untouched
  })

  it('keeps the last keepTurns real user turns untouched', () => {
    const recent: BetaMessageParam[] = [
      ...history.slice(0, 4),
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: BIG }] },
    ]
    // keepTurns=2 → cutoff at the FIRST user turn → nothing before it trimmed… so use keepTurns=1
    const out = trimAnthropicHistory(recent, { keepTurns: 1, maxChars: 100 })
    // the trailing tool_result comes after the last real user turn? No — the only real
    // user turn is index 0, so cutoff=0 and nothing is trimmed.
    const last = out[4].content as unknown as Array<Record<string, unknown>>
    expect(last[0].content).toBe(BIG)
  })

  it('does not modify string-content messages', () => {
    const out = trimAnthropicHistory(history, { keepTurns: 1, maxChars: 100 })
    expect(out[0].content).toBe('第一轮问题')
    expect(out[3].content).toBe('第一轮回答')
  })
})

describe('trimOpenAIHistory', () => {
  type M = OpenAI.Chat.Completions.ChatCompletionMessageParam
  const history: M[] = [
    { role: 'user', content: '第一轮' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'write_file', arguments: BIG } },
      ],
    },
    { role: 'tool', tool_call_id: 'c1', content: BIG },
    {
      role: 'user',
      content: [
        { type: 'text', text: '(view_image 请求的图片如下)' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    },
    { role: 'assistant', content: '回答一' },
    { role: 'user', content: '第二轮' },
  ]

  it('stubs old tool results, image parts, and big tool_call arguments', () => {
    const out = trimOpenAIHistory(history, { keepTurns: 1, maxChars: 100 })
    expect(out[2].content).toContain('已修剪')
    const injected = out[3].content as unknown as Array<Record<string, unknown>>
    expect(injected[1].type).toBe('text')
    const calls = (out[1] as M & { tool_calls: Array<{ function: { arguments: string } }> }).tool_calls
    expect(calls[0].function.arguments).toContain('trimmed')
  })

  it('injected image messages do not count as real user turns', () => {
    // keepTurns=2: real turns are 第二轮 (idx5) and 第一轮 (idx0) → cutoff 0 → nothing trimmed
    const out = trimOpenAIHistory(history, { keepTurns: 2, maxChars: 100 })
    expect(out[2].content).toBe(BIG)
  })
})

describe('estimateChars', () => {
  it('measures serialized size', () => {
    expect(estimateChars([{ a: 'xx' }])).toBeGreaterThan(8)
  })
})
