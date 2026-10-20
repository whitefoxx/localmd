// As in sourceBytes.test.ts, the app deliberately omits Node types. These
// built-ins are confined to Vitest's Node runtime; do not widen browser types.
// @ts-expect-error node types are intentionally not installed
import * as nodeFiles from 'node:fs/promises'
// @ts-expect-error node types are intentionally not installed
import { tmpdir as nodeTmpdir } from 'node:os'
// @ts-expect-error node types are intentionally not installed
import * as nodePath from 'node:path'
import { describe, expect, it } from 'vitest'
import { stepCountIs, tool } from 'ai'
import { createGuardedChat, type GuardCapture } from 'psj-ai-sdk'
import { createFileRecorder, replayRecording } from 'psj-ai-sdk/recording'
import { z } from 'zod'

const { mkdtemp, readFile, readdir, rm } = nodeFiles as {
  mkdtemp(prefix: string): Promise<string>
  readFile(path: string, encoding: 'utf8'): Promise<string>
  readdir(path: string): Promise<string[]>
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>
}
const { dirname, join } = nodePath as { dirname(path: string): string; join(...paths: string[]): string }
const tmpdir = nodeTmpdir as () => string

// Node-only development checks. No application/KB tool, live endpoint or key.
const chunk = (delta: object, finish_reason: string | null = null) => ({
  id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }],
})
const frame = (event: object) => `data: ${JSON.stringify(event)}\n\n`
const final = frame(chunk({ content: 'The page is about X.' })) + frame(chunk({}, 'stop')) + 'data: [DONE]\n\n'
const calls = (finish = 'tool_calls') => frame(chunk({ tool_calls: [{
  index: 0, id: 'c1', type: 'function', function: { name: 'fetch_page', arguments: '{}' },
}] })) + frame(chunk({}, finish)) + 'data: [DONE]\n\n'

function runner(first: () => Response, onCapture: (capture: GuardCapture) => Promise<void>) {
  const requests: { messages: { role: string; tool_call_id?: string; content: string }[] }[] = []
  const executed: string[] = []
  const chat = createGuardedChat({
    name: 'offline-recording', baseURL: 'https://fixture.invalid/v1', onCapture,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      if (requests.length > 2) throw new Error('Unexpected fixture request')
      return requests.length === 1 ? first() : response(final)
    },
  })
  const tools = { fetch_page: tool({ inputSchema: z.object({}).strict(), execute: async (_input, { toolCallId }) => {
    executed.push(toolCallId)
    return 'Page about X.'
  } }) }
  return { chat, tools, requests, executed }
}
const response = (body: string | ReadableStream<Uint8Array>) => new Response(body, { headers: { 'content-type': 'text/event-stream' } })

describe('streaming and local incident evidence across SDK upgrades', () => {
  it('displays text before EOF while callbacks and results wait for validation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'localmd-stream-'))
    const abort = new AbortController()
    let source!: ReadableStreamDefaultController<Uint8Array>
    let displayed!: () => void
    const firstText = new Promise<void>(resolve => { displayed = resolve })
    const r = runner(() => response(new ReadableStream({ start(controller) {
      source = controller
      controller.enqueue(new TextEncoder().encode(frame(chunk({ content: 'Reading the page.' }))))
    } })), createFileRecorder({ directory }))
    const result = r.chat({ model: 'fixture', tools: r.tools, prompt: 'Read a page', stopWhen: stepCountIs(3),
      abortSignal: abort.signal, onError: () => {}, onChunk: ({ chunk }) => { if (chunk.type === 'text-delta') displayed() } })
    const consuming = Promise.resolve(result.consumeStream())
    try {
      await firstText
      expect(r.executed).toEqual([])
      expect(r.requests).toHaveLength(1)
      source.enqueue(new TextEncoder().encode(calls()))
      // Even terminal + DONE cannot release a tool while the body stays open.
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(r.executed).toEqual([])
      source.close()
      await consuming
      expect(r.executed).toEqual(['c1'])
      expect(r.requests[1]!.messages.filter(message => message.role === 'tool').map(message => message.tool_call_id)).toEqual(['c1'])
      expect(await result.text).toBe('The page is about X.')
      expect(await readdir(directory)).toEqual([]) // Refused-only recording is the default.
    } finally {
      abort.abort()
      await consuming.catch(() => {})
      await rm(directory, { recursive: true, force: true })
    }
  })

  for (const interrupted of [false, true]) it(`${interrupted ? 'interrupted' : 'token-limited'} response is recorded and stays ineligible on offline replay`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'localmd-recording-'))
    const saved: string[] = []
    const body = calls(interrupted ? 'tool_calls' : 'length')
    let sent = false
    const r = runner(() => interrupted ? response(new ReadableStream({ pull(controller) {
      if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode(body)) }
      else controller.error(new Error('Authored transport interruption'))
    } })) : response(body), createFileRecorder({ directory, onSaved: path => { saved.push(path) } }))
    try {
      const result = r.chat({ model: 'fixture', tools: r.tools, prompt: 'Read a page', onError: () => {} })
      await result.consumeStream()
      expect(r.executed).toEqual([])
      expect(r.requests).toHaveLength(1)
      expect(saved).toHaveLength(1)
      expect(await readFile(join(dirname(saved[0]!), 'response.sse'), 'utf8')).toBe(body)
      const replay = await replayRecording(saved[0]!)
      expect(replay.scope).toBe('wire-policy-only')
      expect(replay.bodyComplete).toBe(!interrupted)
      expect(replay.recorded.status).toBe('refused')
      expect(replay.replayed.status).toBe('refused')
      expect(replay.replayed.toolCalls).toBe(0)
      if (interrupted) expect(replay.replayed.reason).toBe('incomplete_recording')
      else expect(replay.replayed.reason).toBe(replay.recorded.reason)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
