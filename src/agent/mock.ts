/**
 * Deterministic mock provider for E2E tests — no network, no keys. A profile
 * with provider 'mock' routes here. The last user message is a tiny script:
 *
 *   echo <text>              stream <text> back (chunked)
 *   think <text>             stream <text> as a thinking trail, then reply
 *   write <path> <content>   run the real write_file tool, then confirm
 *   delete <path>            run the real delete_path tool (recursive)
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
    const result = await spec.run(args, { sessionId: opts.sessionId, emit: opts.onEvent })
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
    for (const chunk of script.slice('think '.length).match(/.{1,8}/gs) ?? []) {
      opts.onEvent({ type: 'thinking', delta: chunk })
      await sleep(20)
    }
    reply = 'Done thinking'
    await streamText(reply, opts.onEvent)
  } else if (script.startsWith('delete ')) {
    const target = script.slice('delete '.length).trim()
    const result = await runTool('delete_path', { path: target, recursive: true }, opts)
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
