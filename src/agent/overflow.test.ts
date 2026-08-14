import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { ModelMessage } from 'ai'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test'

/**
 * Context-overflow recovery inside a turn.
 *
 * The failure this exists for: a turn ingests several large tool results, the
 * request stops fitting in the window partway through, and today the whole
 * turn dies with the provider's raw error. The repair is to drop the bulk the
 * turn accumulated and ask again — but only when that actually frees
 * something, and only for an error that really says "too big".
 */

globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
} as unknown as Storage

// The model is the only thing worth faking here; everything else is the real
// runTurn, so the tool registration and per-step gating are exercised too.
const doStream = vi.fn()
vi.mock('./model', () => ({
  toLanguageModel: () => new MockLanguageModelV3({ doStream: (...a: unknown[]) => doStream(...a) }),
}))

const { runTurn } = await import('./run')

function finish(): LanguageModelV3StreamPart {
  return {
    type: 'finish',
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
  }
}

/** A step that answers with text. */
function textStep(text: string) {
  return {
    stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: text },
      { type: 'text-end', id: 't1' },
      finish(),
    ]),
  }
}

/** A step that fails the way `err` describes, the way the SDK surfaces it. */
function errorStep(err: unknown) {
  return {
    stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
      { type: 'stream-start', warnings: [] },
      { type: 'error', error: err },
      finish(),
    ]),
  }
}

const BIG = 'x'.repeat(40_000)

/** History holding an oversized tool result that a prune can reclaim. */
function historyWithBulk(): ModelMessage[] {
  return [
    { role: 'user', content: 'read those files' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'read_file', input: {} }],
    } as unknown as ModelMessage,
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'read_file',
          output: { type: 'text', value: BIG },
        },
      ],
    } as unknown as ModelMessage,
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'c2', toolName: 'read_file', input: {} }],
    } as unknown as ModelMessage,
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'c2',
          toolName: 'read_file',
          output: { type: 'text', value: BIG },
        },
      ],
    } as unknown as ModelMessage,
  ]
}

const OVERFLOW = { message: 'prompt is too long: 209431 tokens > 200000 maximum' }

function run(messages: ModelMessage[], over: Record<string, unknown> = {}) {
  const events: { type: string; name?: string }[] = []
  return {
    events,
    promise: runTurn({
      profile: { id: 'p', provider: 'deepseek', model: 'm', apiKey: 'k' } as never,
      system: { stable: 'S', dynamic: '' },
      messages,
      sessionId: 's1',
      onEvent: (e) => events.push(e as { type: string; name?: string }),
      signal: new AbortController().signal,
      ...over,
    }),
  }
}

describe('context-overflow recovery', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    doStream.mockReset()
  })

  it('prunes the accumulated bulk and retries, and the retry succeeds', async () => {
    doStream
      .mockResolvedValueOnce(errorStep(OVERFLOW))
      .mockResolvedValueOnce(textStep('done after pruning'))

    const { promise, events } = run(historyWithBulk())
    const history = await promise

    expect(doStream).toHaveBeenCalledTimes(2)
    // The user is told, rather than watching a turn stall silently.
    expect(events.filter((e) => e.type === 'tool' && e.name === 'compact')).toHaveLength(1)
    // The persisted history is the PRUNED one — keeping the oversized version
    // would put the very next turn straight back over the window. The first
    // pass spares the newest call/result pair on purpose, so the older result
    // is a stub and the newest survives.
    expect(JSON.stringify(history)).toContain('trimmed')
    expect(JSON.stringify(history).length).toBeLessThan(
      JSON.stringify(historyWithBulk()).length,
    )
  })

  it('sends a smaller request the second time', async () => {
    doStream
      .mockResolvedValueOnce(errorStep(OVERFLOW))
      .mockResolvedValueOnce(textStep('ok'))

    await run(historyWithBulk()).promise

    const sizeOf = (call: number) => JSON.stringify(doStream.mock.calls[call][0].prompt).length
    expect(sizeOf(1)).toBeLessThan(sizeOf(0))
  })

  it('does NOT retry an error that is not an overflow', async () => {
    // Retrying a bad key or a malformed request wastes a turn and buries the
    // real message.
    doStream.mockResolvedValueOnce(errorStep({ message: 'Incorrect API key provided' }))

    await expect(run(historyWithBulk()).promise).rejects.toMatchObject({
      message: expect.stringContaining('API key'),
    })
    expect(doStream).toHaveBeenCalledTimes(1)
  })

  it('gives up instead of looping when pruning cannot free anything', async () => {
    // One oversized user message is not repairable by trimming tool results;
    // re-sending it unchanged would burn the retry budget for nothing.
    doStream.mockImplementation(async () => errorStep(OVERFLOW))

    const unprunable: ModelMessage[] = [{ role: 'user', content: BIG }]
    await expect(run(unprunable).promise).rejects.toMatchObject({
      message: expect.stringContaining('too long'),
    })
    expect(doStream).toHaveBeenCalledTimes(1)
  })

  it('stops after the retry cap when every attempt overflows', async () => {
    doStream.mockImplementation(async () => errorStep(OVERFLOW))

    await expect(run(historyWithBulk()).promise).rejects.toMatchObject({
      message: expect.stringContaining('too long'),
    })
    // Initial attempt + at most MAX_OVERFLOW_RECOVERIES retries, and it must
    // terminate rather than prune-and-retry forever.
    expect(doStream.mock.calls.length).toBeLessThanOrEqual(3)
    expect(doStream.mock.calls.length).toBeGreaterThan(1)
  })

  it('offers the doomed results to the caller so their stubs can be recalled', async () => {
    const stash = vi.fn().mockResolvedValue(new Map([['c1', '.trace/tool-results/s1/a.txt']]))
    doStream.mockResolvedValueOnce(errorStep(OVERFLOW)).mockResolvedValueOnce(textStep('ok'))

    const history = await run(historyWithBulk(), { stashTrimmable: stash }).promise

    expect(stash).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(history)).toContain('.trace/tool-results/s1/a.txt')
  })

  it('leaves a turn that never overflows byte-identical to before', async () => {
    doStream.mockResolvedValueOnce(textStep('plain answer'))

    const messages = historyWithBulk()
    const history = await run(messages).promise

    expect(doStream).toHaveBeenCalledTimes(1)
    // Nothing pruned, nothing announced: the recovery path is inert.
    expect(JSON.stringify(history)).toContain(BIG)
    expect(history.slice(0, messages.length)).toEqual(messages)
  })
})
