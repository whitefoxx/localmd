/**
 * Deterministic mock provider for E2E tests — no network, no keys. A profile
 * with provider 'mock' routes here. The last user message is a tiny script:
 *
 *   echo <text>              stream <text> back (chunked)
 *   think <text>             stream <text> as a thinking trail, then reply
 *   think xN <text>          …with <text> repeated N times, no pacing delay
 *                            (a long thought, at a rate a real provider
 *                            reaches — for responsiveness probes)
 *   hang [ms]                a tool call that ignores the abort signal (stop tests)
 *   write <path> <content>   run the real write_file tool, then confirm
 *   delete <path>            run the real delete_path tool (recursive)
 *   index <path>             run the real index_document tool
 *   health                   run the real kb_health tool and reply with it
 *   plan                     exercise update_plan (3 steps, all done)
 *   anything else            stream a fixed reply
 *
 * History uses the AI SDK ModelMessage shape so session persistence just works.
 */
import type { ModelMessage } from 'ai'
import { TOOLS } from './tools'
import type { AgentEventHandler } from './types'

export interface MockTurnOptions {
  system: string
  messages: ModelMessage[]
  sessionId: string
  onEvent: AgentEventHandler
  signal: AbortSignal
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let mockToolSeq = 0

async function streamText(text: string, onEvent: AgentEventHandler): Promise<void> {
  for (const chunk of text.match(/.{1,8}/gs) ?? []) {
    onEvent({ type: 'text', delta: chunk })
    await sleep(10)
  }
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  opts: MockTurnOptions,
): Promise<string> {
  const spec = TOOLS.find((t) => t.name === name)
  if (!spec) return `Error: unknown tool ${name}`
  const id = mockToolSeq++
  opts.onEvent({ type: 'tool', name, detail: spec.describeCall(args), id })
  let ok = false
  let out = ''
  try {
    const result = await spec.run(args, {
      sessionId: opts.sessionId,
      emit: opts.onEvent,
      signal: opts.signal,
    })
    ok = !(typeof result === 'string' && result.startsWith('Error'))
    out = typeof result === 'string' ? result : JSON.stringify(result)
    return result
  } finally {
    opts.onEvent({ type: 'tool_result', id, ok, result: out })
  }
}

export async function runMockTurn(opts: MockTurnOptions): Promise<ModelMessage[]> {
  const history = [...opts.messages]
  const last = history[history.length - 1]
  const text =
    typeof last?.content === 'string'
      ? last.content
      : ((last?.content as Array<{ type: string; text?: string }> | undefined)
          ?.find((p) => p.type === 'text')
          ?.text ?? '')
  // Scripts operate on the raw user line (before attachment/mention notes).
  const script = text.split('\n')[0].trim()

  opts.onEvent({ type: 'usage', input: 100, output: 20, cacheRead: 0, cacheWrite: 0 })

  let reply: string
  const writeMatch = /^write\s+(\S+)\s+([\s\S]+)$/.exec(script)
  if (script.startsWith('echo ')) {
    reply = script.slice(5)
    await streamText(reply, opts.onEvent)
  } else if (writeMatch) {
    const result = await runTool('write_file', { path: writeMatch[1], content: writeMatch[2] }, opts)
    reply = `Done: ${result}`
    await streamText(reply, opts.onEvent)
  } else if (script.startsWith('think ')) {
    const body = script.slice('think '.length)
    // `think x400 …` repeats the trail to reach a length a real reasoning model
    // produces, and drops the pacing delay so the probe runs in seconds instead
    // of minutes. Every chunk still lands in its own task, which is what the
    // per-delta cost is measured against.
    const rep = /^x(\d+)\s+([\s\S]+)$/.exec(body)
    const thought = rep ? (rep[2] + ' ').repeat(Number(rep[1])) : body
    for (const chunk of thought.match(/.{1,8}/gs) ?? []) {
      opts.onEvent({ type: 'thinking', delta: chunk })
      await sleep(rep ? 0 : 20)
    }
    reply = 'Done thinking'
    await streamText(reply, opts.onEvent)
  } else if (script.startsWith('hang')) {
    // Stands in for the tools that cannot be cancelled — a push already in
    // flight, a document index mid-parse: it keeps going after the abort, and
    // the UI must not wait for it.
    const id = mockToolSeq++
    opts.onEvent({ type: 'tool', name: 'hang', detail: 'uncancellable work', id })
    await sleep(Number(script.slice('hang'.length).trim()) || 5_000)
    opts.onEvent({ type: 'tool_result', id, ok: true, result: 'done' })
    reply = 'Finished the slow thing'
    await streamText(reply, opts.onEvent)
  } else if (script.startsWith('delete ')) {
    const target = script.slice('delete '.length).trim()
    const result = await runTool('delete_path', { path: target, recursive: true }, opts)
    reply = `Done: ${result}`
    await streamText(reply, opts.onEvent)
  } else if (script === 'health') {
    // The report itself is the reply, so a browser test can read what the
    // agent was handed rather than trusting that the tool returned something.
    reply = await runTool('kb_health', {}, opts)
    await streamText(reply, opts.onEvent)
  } else if (script.startsWith('index ')) {
    const target = script.slice('index '.length).trim()
    const result = await runTool('index_document', { path: target }, opts)
    reply = `Done: ${result}`
    await streamText(reply, opts.onEvent)
  } else if (script.startsWith('artifact ')) {
    const title = script.slice('artifact '.length).trim() || 'artifact'
    await runTool(
      'create_artifact',
      {
        title,
        html: `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1><p>mock artifact</p>`,
      },
      opts,
    )
    reply = `Generated artifact: ${title}`
    await streamText(reply, opts.onEvent)
  } else if (script === 'plan') {
    await runTool(
      'update_plan',
      {
        items: [
          { text: 'Step one', status: 'done' },
          { text: 'Step two', status: 'done' },
          { text: 'Step three', status: 'in_progress' },
        ],
      },
      opts,
    )
    reply = 'Plan updated'
    await streamText(reply, opts.onEvent)
  } else {
    reply = 'mock reply: ' + script.slice(0, 40)
    await streamText(reply, opts.onEvent)
  }

  history.push({ role: 'assistant', content: reply })
  return history
}
