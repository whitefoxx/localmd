import { describe, expect, it } from 'vitest'
import { stepCountIs, streamText, tool, type ModelMessage } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createGuardedChat } from 'psj-ai-sdk'
import { z } from 'zod'

// run.test.ts pins retained tool history using a mock LanguageModel. These
// authored responses also exercise the installed HTTP/SSE provider parser on
// SDK upgrades. No provider, browser, filesystem or application tool is called.
const PAYLOAD = 'x'.repeat(12_000)
const chunk = (delta: object, finish_reason: string | null = null) => ({
  id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }],
})
const call = (index: number, id: string, args = '{}') => ({
  index, id, type: 'function', function: { name: 'fetch_page', arguments: args },
})
const sse = (events: object[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
const answer = sse([chunk({ content: 'The pages are about X.' }), chunk({}, 'stop')])

async function run(guarded: boolean, kind: 'complete' | 'duplicate' | 'invalid' = 'complete') {
  const requests: { messages: { role: string; tool_call_id?: string; content: string }[] }[] = []
  const executed: string[] = []
  const first = sse([
    chunk({ role: 'assistant', tool_calls: [call(0, 'c1'), call(1, kind === 'duplicate' ? 'c1' : 'c2', kind === 'invalid' ? '{' : '{}')] }),
    chunk({}, 'tool_calls'),
  ])
  const settings = {
    name: 'offline-regression', baseURL: 'https://fixture.invalid/v1',
    fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)))
      if (requests.length > 2) throw new Error('Unexpected fixture request')
      return new Response(requests.length === 1 ? first : answer, { headers: { 'content-type': 'text/event-stream' } })
    },
  }
  const tools = {
    fetch_page: tool({ inputSchema: z.object({}).strict(), execute: async (_input, { toolCallId }) => {
      executed.push(toolCallId)
      return PAYLOAD
    } }),
  }
  const common = { tools, messages: [{ role: 'user', content: 'Read both pages' }] as ModelMessage[], stopWhen: stepCountIs(3), onError: () => {} }
  const result = guarded
    ? createGuardedChat(settings)({ ...common, model: 'fixture' })
    : streamText({ ...common, model: createOpenAICompatible(settings).chatModel('fixture'), maxRetries: 0 })
  await result.consumeStream()
  return { requests, executed, result }
}

describe('original response and retained history across SDK upgrades', () => {
  for (const guarded of [false, true]) it(`${guarded ? 'guarded' : 'native'} complete turn keeps full results and matching IDs`, async () => {
    const { requests, executed, result } = await run(guarded)
    expect(executed).toEqual(['c1', 'c2'])
    expect(requests).toHaveLength(2)
    const returned = requests[1]!.messages.filter(message => message.role === 'tool')
    expect(returned.map(message => message.tool_call_id)).toEqual(['c1', 'c2'])
    expect(returned.map(message => message.content)).toEqual([PAYLOAD, PAYLOAD])
    const history = (await result.steps).flatMap(step => step.response.messages)
    const parts = history.flatMap(message => typeof message.content === 'string' ? [] : message.content as { type: string }[])
    expect(parts.filter(part => part.type === 'tool-call')).toHaveLength(2)
    expect(parts.filter(part => part.type === 'tool-result')).toHaveLength(2)
    expect(await result.text).toBe('The pages are about X.')
  })

  for (const kind of ['duplicate', 'invalid'] as const) it(`${kind} original batch has no callbacks or follow-up request`, async () => {
    const { requests, executed } = await run(true, kind)
    expect(executed).toEqual([])
    expect(requests).toHaveLength(1)
  })
})
