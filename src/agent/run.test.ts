import { describe, expect, it } from 'vitest'
import { type ModelMessage, stepCountIs, streamText, tool } from 'ai'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test'
import { z } from 'zod'

/**
 * What a finished turn contributes to the wire history.
 *
 * runTurn persists `[...messages, ...steps.flatMap(s => s.response.messages)]`.
 * The tempting one-liner — `(await result.response).messages` — looks like the
 * same thing and is not: it resolves to the LAST step only. A turn that called
 * a tool and then answered would persist the answer alone, silently dropping
 * the tool call and its result, so the next turn could not see what the agent
 * had read and lib/history.ts's tool-result trimming would never fire.
 *
 * These tests pin the difference against the SDK, which is where it can change
 * under us on an upgrade.
 */

const PAYLOAD = 'x'.repeat(12_000)

/** One mocked step: the given parts, then a finish chunk. */
function step(parts: LanguageModelV3StreamPart[]) {
  const isToolCall = parts.some((p) => p.type === 'tool-call')
  return convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] },
    ...parts,
    {
      type: 'finish',
      finishReason: { unified: isToolCall ? 'tool-calls' : 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    },
  ])
}

/** A two-step turn: call `fetch_page`, then answer from its result. */
function twoStepTurn() {
  let call = 0
  const model = new MockLanguageModelV3({
    doStream: async () => {
      call++
      return call === 1
        ? {
            stream: step([
              { type: 'tool-input-start', id: 'c1', toolName: 'fetch_page' },
              { type: 'tool-input-delta', id: 'c1', delta: '{}' },
              { type: 'tool-input-end', id: 'c1' },
              { type: 'tool-call', toolCallId: 'c1', toolName: 'fetch_page', input: '{}' },
            ]),
          }
        : {
            stream: step([
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: 'The page is about X.' },
              { type: 'text-end', id: 't1' },
            ]),
          }
    },
  })

  return streamText({
    model,
    messages: [{ role: 'user', content: 'read it' }] as ModelMessage[],
    tools: {
      fetch_page: tool({
        description: 'fetch a page',
        inputSchema: z.object({}),
        execute: async () => PAYLOAD,
      }),
    },
    stopWhen: [stepCountIs(25)],
  })
}

/** Content parts are read structurally — the union is wide and irrelevant here. */
function contentParts(m: ModelMessage): { type: string }[] {
  return typeof m.content === 'string' ? [{ type: 'text' }] : (m.content as { type: string }[])
}

function partTypes(messages: ModelMessage[]): string[] {
  return messages.flatMap((m) => contentParts(m).map((p) => p.type))
}

describe('wire history for a finished turn', () => {
  it('keeps the tool call and its full result, not just the closing text', async () => {
    const result = twoStepTurn()
    await result.consumeStream()

    const steps = await result.steps
    const contributed = steps.flatMap((s) => s.response.messages)

    expect(steps).toHaveLength(2)
    expect(partTypes(contributed)).toEqual(['tool-call', 'tool-result', 'text'])

    // The result reaches history whole — the 4k cap in stores/chat.ts is a
    // transcript preview and must never be what the model replays.
    const toolResult = contributed
      .flatMap(contentParts)
      .find((p) => p.type === 'tool-result') as { output?: { value?: string } } | undefined
    expect(toolResult?.output?.value).toHaveLength(PAYLOAD.length)
  })

  it('documents why response.messages cannot be used for this', async () => {
    const result = twoStepTurn()
    await result.consumeStream()

    // Last step only: the answer, with the tool phase missing entirely.
    const response = await result.response
    expect(partTypes(response.messages)).toEqual(['text'])
  })
})
