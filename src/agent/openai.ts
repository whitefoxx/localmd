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
import { TOOLS } from './tools'
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
  if (opts.allowSubagent) {
    tools.push({
      type: 'function',
      function: {
        name: 'run_subagent',
        description:
          'Delegate a scoped, self-contained subtask to a subagent with its own fresh context and the same KB tools (it cannot spawn subagents). Use it for work that would flood your context — e.g. surveying many files or summarizing a long document. Give it the full task description; you receive only its final answer.',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'Complete, self-contained task description for the subagent',
            },
          },
          required: ['task'],
        },
      },
    })
  }

  const history: ChatMessage[] = [...opts.messages]

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = await client.chat.completions.create(
      {
        model: opts.profile.model,
        messages: [{ role: 'system', content: opts.system }, ...history],
        tools,
        stream: true,
        stream_options: { include_usage: true },
        ...(opts.profile.maxTokens ? { max_tokens: opts.profile.maxTokens } : {}),
      },
      { signal: opts.signal },
    )

    let text = ''
    const calls: { id: string; name: string; args: string }[] = []

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
      // Reasoning models (DeepSeek etc.) stream their chain of thought in a
      // vendor field — surface it, but never send it back in history.
      const reasoning = (delta as { reasoning_content?: string | null }).reasoning_content
      if (reasoning) opts.onEvent({ type: 'thinking', delta: reasoning })
      if (delta.content) {
        text += delta.content
        opts.onEvent({ type: 'text', delta: delta.content })
      }
      for (const tc of delta.tool_calls ?? []) {
        const slot = (calls[tc.index] ??= { id: '', name: '', args: '' })
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name = tc.function.name
        if (tc.function?.arguments) slot.args += tc.function.arguments
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
      if (call.name === 'view_image' && opts.vision) {
        result = await handleViewImage(call.args, opts.vision, inlineImages, opts)
      } else if (call.name === 'run_subagent' && opts.allowSubagent) {
        result = await handleSubagent(call.args, opts)
      } else {
        const spec = TOOLS.find((t) => t.name === call.name)
        if (!spec) {
          result = `Error: unknown tool ${call.name}`
        } else {
          try {
            const args = JSON.parse(call.args || '{}')
            opts.onEvent({ type: 'tool', name: call.name, detail: spec.describeCall(args) })
            result = await spec.run(args)
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
  let task: string
  try {
    const args = JSON.parse(rawArgs || '{}') as { task?: unknown }
    task = typeof args.task === 'string' ? args.task : ''
  } catch {
    return 'Error: invalid run_subagent arguments'
  }
  if (!task.trim()) return 'Error: task must not be empty'
  opts.onEvent({ type: 'tool', name: 'run_subagent', detail: `subagent: ${task.slice(0, 80)}` })
  try {
    const history = await runOpenAITurn({
      ...opts,
      system: opts.system + SUBAGENT_SYSTEM_SUFFIX,
      messages: [{ role: 'user', content: task }],
      allowSubagent: false,
      onEvent: (e) => {
        // Surface tool activity (indented) and usage; the subagent's text
        // comes back as this tool's result.
        if (e.type === 'tool') {
          opts.onEvent({ type: 'tool', name: e.name, detail: `  ↳ ${e.detail}` })
        } else if (e.type === 'usage') {
          opts.onEvent(e)
        }
      },
    })
    const last = history[history.length - 1]
    const text = typeof last?.content === 'string' ? last.content : ''
    return text || '(subagent returned no text)'
  } catch (err) {
    return `Subagent failed: ${(err as Error).message}`
  }
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
