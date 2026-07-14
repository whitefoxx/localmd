/**
 * Deterministic mock provider for E2E tests — no network, no keys. A profile
 * with provider 'mock' routes here. The last user message is a tiny script:
 *
 *   echo <text>              stream <text> back (chunked)
 *   write <path> <content>   run the real write_file tool, then confirm
 *   plan                     exercise update_plan (3 steps, all done)
 *   anything else            stream a fixed reply
 *
 * History uses the OpenAI message shape so session persistence just works.
 */
import type OpenAI from 'openai'
import { TOOLS } from './tools'
import type { AgentEventHandler } from './types'

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

export interface MockTurnOptions {
  system: string
  messages: ChatMessage[]
  sessionId: string
  onEvent: AgentEventHandler
  signal: AbortSignal
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
  opts.onEvent({ type: 'tool', name, detail: spec.describeCall(args) })
  return await spec.run(args, { sessionId: opts.sessionId, emit: opts.onEvent })
}

export async function runMockTurn(opts: MockTurnOptions): Promise<ChatMessage[]> {
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

  opts.onEvent({ type: 'usage', input: 100, output: 20, cacheRead: 0 })

  let reply: string
  const writeMatch = /^write\s+(\S+)\s+([\s\S]+)$/.exec(script)
  if (script.startsWith('echo ')) {
    reply = script.slice(5)
    await streamText(reply, opts.onEvent)
  } else if (writeMatch) {
    const result = await runTool('write_file', { path: writeMatch[1], content: writeMatch[2] }, opts)
    reply = `完成:${result}`
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
    reply = `已生成 artifact:${title}`
    await streamText(reply, opts.onEvent)
  } else if (script === 'plan') {
    await runTool(
      'update_plan',
      {
        items: [
          { text: '第一步', status: 'done' },
          { text: '第二步', status: 'done' },
          { text: '第三步', status: 'in_progress' },
        ],
      },
      opts,
    )
    reply = '计划已更新'
    await streamText(reply, opts.onEvent)
  } else {
    reply = 'mock 回复:' + script.slice(0, 40)
    await streamText(reply, opts.onEvent)
  }

  history.push({ role: 'assistant', content: reply })
  return history
}
