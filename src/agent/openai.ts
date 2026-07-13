/**
 * OpenAI-compatible provider: a thin manual tool-use loop over the Chat
 * Completions API. Chat Completions (not Responses) is deliberate — it's the
 * lingua franca implemented by OpenAI-compatible endpoints (DeepSeek, Moonshot,
 * Qwen, Ollama, …), so one loop covers them all via a custom baseURL.
 *
 * Vision (web-agent pattern): a view_image tool is offered when the vision
 * slot is configured. If the vision profile IS the primary (multimodal
 * primary), the loop injects the images as a follow-up user message; otherwise
 * it sub-calls the vision model and returns its description as the tool result.
 */
import OpenAI from 'openai'
import { z } from 'zod'
import { TOOLS, externalToolSpecs } from './tools'
import { mapLimit } from '@/lib/async'
import { loadKbImage, toDataUrl, imageUrlForProvider, visionDescribe, type KbImage } from './vision'
import type { LlmProfile } from '@/stores/settings'
import type { AgentEventHandler } from './types'

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

export interface OpenAITurnOptions {
  profile: LlmProfile
  system: string
  /** Conversation history including the newest user message (no system msg). */
  messages: ChatMessage[]
  /** Vision slot: undefined = no image understanding; inline = the primary is
   *  multimodal (vision profile === primary). */
  vision?: { profile: LlmProfile; inline: boolean }
  /** Chat session this turn belongs to — scopes tool side effects (writes,
   *  plan, deferred-tool activation) so concurrent sessions stay isolated. */
  sessionId: string
  onEvent: AgentEventHandler
  signal: AbortSignal
  /** Offer the run_subagent tool (disabled inside subagents — depth 1 only). */
  allowSubagent?: boolean
}

const SUBAGENT_SYSTEM_SUFFIX = `

You are running as a SUBAGENT on one scoped task. Work autonomously with the tools; do not ask the user questions. Your final message is returned verbatim to the main agent as a tool result — make it a complete, self-contained answer. You cannot spawn further subagents.`

const MAX_ITERATIONS = 25
const MAX_IMAGES_PER_CALL = 5

const VIEW_IMAGE_PARAMS = {
  type: 'object',
  properties: {
    paths: {
      type: 'array',
      items: { type: 'string' },
      description: 'KB-relative image paths, e.g. ["raw/images/chart.png"]',
    },
    purpose: { type: 'string', description: 'What you want to know about the images' },
  },
  required: ['paths'],
} as const

/** Runs one agent turn; returns the updated conversation history. */
export async function runOpenAITurn(opts: OpenAITurnOptions): Promise<ChatMessage[]> {
  const client = new OpenAI({
    apiKey: opts.profile.apiKey,
    baseURL: opts.profile.baseUrl || undefined,
    dangerouslyAllowBrowser: true,
  })

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOLS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: z.toJSONSchema(t.schema) as Record<string, unknown>,
    },
  }))
  if (opts.vision) {
    tools.push({
      type: 'function',
      function: {
        name: 'view_image',
        description:
          '查看知识库中图片文件的实际内容(视觉理解)。传 KB 相对路径,如 ["raw/images/capture-123.png"]。仅当需要分析图片内容时调用。',
        parameters: VIEW_IMAGE_PARAMS as unknown as Record<string, unknown>,
      },
    })
  }
  // Remote MCP tools — raw JSON schemas pass straight through. Rebuilt per
  // request iteration so enable_tools activation lands within the same turn.
  let external = externalToolSpecs(opts.sessionId)
  const requestTools = (): OpenAI.Chat.Completions.ChatCompletionTool[] => {
    external = externalToolSpecs(opts.sessionId)
    return [
      ...tools,
      ...external.map((ext) => ({
        type: 'function' as const,
        function: { name: ext.name, description: ext.description, parameters: ext.jsonSchema },
      })),
    ]
  }

  if (opts.allowSubagent) {
    tools.push({
      type: 'function',
      function: {
        name: 'run_subagent',
        description:
          'Delegate scoped, self-contained subtasks to subagents with fresh contexts and the same KB tools (they cannot spawn subagents). Use it for work that would flood your context — surveying many files, summarizing long documents. INDEPENDENT tasks run in parallel — pass them together in one call. Each task description must be complete and self-contained; you receive only the final answers.',
        parameters: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: 5,
              description: '1-5 self-contained subtask descriptions; independent tasks run concurrently',
            },
          },
          required: ['tasks'],
        },
      },
    })
  }

  const history: ChatMessage[] = [...opts.messages]
  // Monotonic id per turn, correlating a tool's start event with its result so
  // the UI can time it. Subagents run with a wrapped onEvent that strips ids,
  // so their ids never collide with this turn's.
  let toolSeq = 0

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let text = ''
    const calls: { id: string; name: string; args: string }[] = []

    // The SDK already retries failures BEFORE the stream opens; this loop
    // additionally retries a MID-STREAM drop, but only when nothing has been
    // emitted to the UI yet (a clean retry — no duplicated output).
    for (let attempt = 0; ; attempt++) {
      let emitted = false
      try {
        const stream = await client.chat.completions.create(
          {
            model: opts.profile.model,
            messages: [{ role: 'system', content: opts.system }, ...history],
            tools: requestTools(),
            stream: true,
            stream_options: { include_usage: true },
            ...(opts.profile.maxTokens ? { max_tokens: opts.profile.maxTokens } : {}),
          },
          { signal: opts.signal },
        )

        for await (const chunk of stream) {
          if (chunk.usage) {
            const details = chunk.usage.prompt_tokens_details as
              | { cached_tokens?: number }
              | undefined
            // DeepSeek reports cache hits in a vendor field.
            const dsCache = (chunk.usage as { prompt_cache_hit_tokens?: number })
              .prompt_cache_hit_tokens
            opts.onEvent({
              type: 'usage',
              input: chunk.usage.prompt_tokens ?? 0,
              output: chunk.usage.completion_tokens ?? 0,
              cacheRead: details?.cached_tokens ?? dsCache ?? 0,
            })
          }
          const delta = chunk.choices[0]?.delta
          if (!delta) continue
          // Reasoning models (DeepSeek etc.) stream their chain of thought in
          // a vendor field — surface it, but never send it back in history.
          const reasoning = (delta as { reasoning_content?: string | null }).reasoning_content
          if (reasoning) {
            emitted = true
            opts.onEvent({ type: 'thinking', delta: reasoning })
          }
          if (delta.content) {
            emitted = true
            text += delta.content
            opts.onEvent({ type: 'text', delta: delta.content })
          }
          for (const tc of delta.tool_calls ?? []) {
            emitted = true
            const slot = (calls[tc.index] ??= { id: '', name: '', args: '' })
            if (tc.id) slot.id = tc.id
            if (tc.function?.name) slot.name = tc.function.name
            if (tc.function?.arguments) slot.args += tc.function.arguments
          }
        }
        break // stream completed
      } catch (err) {
        const aborted =
          (err as Error).name === 'AbortError' || (err as Error).name === 'APIUserAbortError'
        if (aborted || emitted || attempt >= 1) throw err
        await new Promise((r) => setTimeout(r, 1500))
      }
    }

    if (!calls.length) {
      history.push({ role: 'assistant', content: text })
      return history
    }

    history.push({
      role: 'assistant',
      content: text || null,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.args },
      })),
    })

    // Images a view_image call asked to inject inline (multimodal primary):
    // buffered until after ALL tool results, then appended as a user message —
    // tool messages themselves are text-only in Chat Completions.
    const inlineImages: KbImage[] = []

    for (const call of calls) {
      let result: string
      const ext = external.find((t) => t.name === call.name)
      if (ext) {
        let id: number | undefined
        try {
          const args = JSON.parse(call.args || '{}') as Record<string, unknown>
          id = toolSeq++
          opts.onEvent({ type: 'tool', name: call.name, detail: ext.describeCall(args), id })
          result = await ext.run(args)
          opts.onEvent({ type: 'tool_result', id, ok: !result.startsWith('Error') })
        } catch (err) {
          result = `Error: ${(err as Error).message}`
          if (id != null) opts.onEvent({ type: 'tool_result', id, ok: false })
        }
      } else if (call.name === 'view_image' && opts.vision) {
        result = await handleViewImage(call.args, opts.vision, inlineImages, opts)
      } else if (call.name === 'run_subagent' && opts.allowSubagent) {
        result = await handleSubagent(call.args, opts)
      } else {
        const spec = TOOLS.find((t) => t.name === call.name)
        if (!spec) {
          // Self-healing for deferred tools: the model called one directly by
          // its catalog name — activate it and ask for a retry (its arguments
          // were guessed without the schema, so we don't execute them).
          const { useMcpStore } = await import('@/stores/mcp')
          const mcp = useMcpStore()
          if (mcp.deferredToolsFor(opts.sessionId).some((t) => t.qualifiedName === call.name)) {
            mcp.activate(opts.sessionId, [call.name])
            opts.onEvent({ type: 'tool', name: 'enable_tools', detail: `auto-enable ${call.name}` })
            result = `${call.name} was deferred and is NOW ENABLED with its full schema. Check the schema and call it again.`
          } else {
            result = `Error: unknown tool ${call.name}`
          }
        } else {
          try {
            const args = JSON.parse(call.args || '{}')
            opts.onEvent({ type: 'tool', name: call.name, detail: spec.describeCall(args) })
            result = await spec.run(args, { sessionId: opts.sessionId })
          } catch (err) {
            result = `Error: ${(err as Error).message}`
          }
        }
      }
      history.push({ role: 'tool', tool_call_id: call.id, content: result })
    }

    if (inlineImages.length) {
      history.push({
        role: 'user',
        content: [
          { type: 'text', text: '(view_image 请求的图片如下)' },
          ...inlineImages.map((img) => ({
            type: 'image_url' as const,
            image_url: { url: imageUrlForProvider(opts.profile, toDataUrl(img)) },
          })),
        ],
      })
    }
  }

  history.push({ role: 'assistant', content: '[Stopped: too many tool iterations]' })
  return history
}

async function handleSubagent(rawArgs: string, opts: OpenAITurnOptions): Promise<string> {
  let tasks: string[]
  try {
    const args = JSON.parse(rawArgs || '{}') as { tasks?: unknown; task?: unknown }
    tasks = Array.isArray(args.tasks)
      ? args.tasks.filter((t): t is string => typeof t === 'string' && !!t.trim())
      : typeof args.task === 'string' && args.task.trim()
        ? [args.task] // tolerate the legacy single-task shape
        : []
  } catch {
    return 'Error: invalid run_subagent arguments'
  }
  if (!tasks.length) return 'Error: tasks must contain at least one non-empty task'
  tasks = tasks.slice(0, 5)
  opts.onEvent({
    type: 'tool',
    name: 'run_subagent',
    detail: tasks.length === 1 ? `subagent: ${tasks[0].slice(0, 80)}` : `subagents ×${tasks.length}`,
  })
  const results = await mapLimit(tasks, 3, async (task, i) => {
    const tag = tasks.length > 1 ? `[${i + 1}]` : ''
    const history = await runOpenAITurn({
      ...opts,
      system: opts.system + SUBAGENT_SYSTEM_SUFFIX,
      messages: [{ role: 'user', content: task }],
      allowSubagent: false,
      onEvent: (e) => {
        // Surface tool activity (indented) and usage; the subagent's text
        // comes back as this tool's result.
        if (e.type === 'tool') {
          opts.onEvent({ type: 'tool', name: e.name, detail: `  ↳${tag} ${e.detail}` })
        } else if (e.type === 'usage') {
          opts.onEvent(e)
        }
      },
    })
    const last = history[history.length - 1]
    const text = typeof last?.content === 'string' ? last.content : ''
    return text || '(subagent returned no text)'
  })
  if (tasks.length === 1) {
    const r = results[0]
    return r instanceof Error ? `Subagent failed: ${r.message}` : r
  }
  return tasks
    .map((t, i) => {
      const r = results[i]
      const body = r instanceof Error ? `(failed: ${r.message})` : r
      return `## 子任务 ${i + 1}: ${t.slice(0, 60)}\n\n${body}`
    })
    .join('\n\n')
}

async function handleViewImage(
  rawArgs: string,
  vision: { profile: LlmProfile; inline: boolean },
  inlineImages: KbImage[],
  opts: OpenAITurnOptions,
): Promise<string> {
  let paths: string[]
  let purpose = ''
  try {
    const args = JSON.parse(rawArgs || '{}') as { paths?: unknown; purpose?: unknown }
    paths = Array.isArray(args.paths) ? args.paths.filter((p): p is string => typeof p === 'string') : []
    if (typeof args.purpose === 'string') purpose = args.purpose
  } catch {
    return 'Error: invalid view_image arguments'
  }
  opts.onEvent({ type: 'tool', name: 'view_image', detail: `view ${paths.join(', ')}` })

  const images: KbImage[] = []
  const missing: string[] = []
  for (const p of paths.slice(0, MAX_IMAGES_PER_CALL)) {
    const img = await loadKbImage(p)
    if (img) images.push(img)
    else missing.push(p)
  }
  if (!images.length) {
    return `Error: no readable images (not found or unsupported format): ${missing.join(', ')}`
  }
  const note = missing.length ? `(unreadable, skipped: ${missing.join(', ')})` : ''

  if (vision.inline) {
    inlineImages.push(...images)
    return `已接收 ${images.length} 张图片,将作为图像呈现给你查看。${note}`
  }
  try {
    const desc = await visionDescribe(vision.profile, images, purpose, opts.signal)
    return `${desc}${note ? `\n\n${note}` : ''}`
  } catch (err) {
    return `视觉模型(${vision.profile.model})调用失败:${(err as Error).message}`
  }
}
