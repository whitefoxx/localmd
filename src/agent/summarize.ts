/**
 * One-shot conversation summarization for history compaction and short session
 * titles — single non-streaming requests to the primary profile's model via the
 * AI SDK (same provider abstraction as the main loop).
 */
import { generateText } from 'ai'
import { toLanguageModel } from './model'
import type { LlmProfile } from '@/stores/settings'

const PROMPT =
  '你是对话压缩器。把下面的 agent 对话历史压缩成结构化摘要,必须保留:用户的目标与明确指示、已完成的操作(含涉及的文件路径)、关键发现与决定、尚未完成的事项。用要点列表,总长不超过 600 字。只输出摘要本身。'

export async function summarize(
  profile: LlmProfile,
  transcript: string,
  signal?: AbortSignal,
): Promise<string> {
  const { text } = await generateText({
    model: toLanguageModel(profile),
    maxOutputTokens: 3000, // headroom for reasoning-model thinking
    messages: [{ role: 'user', content: `${PROMPT}\n\n<对话历史>\n${transcript}\n</对话历史>` }],
    abortSignal: signal,
  })
  if (!text) throw new Error('summarizer returned no content')
  return text
}

/** One-shot session title (≤16 chars) from the first exchange. Returns null on
 *  any failure — the caller keeps the sliced-text fallback. */
export async function generateTitle(
  profile: LlmProfile,
  userText: string,
  assistantText: string,
): Promise<string | null> {
  if (profile.provider === 'mock') return null
  const prompt = `给下面这段对话起一个简短的标题,不超过 16 个字,只输出标题本身,不要引号和句号。\n\n用户: ${userText.slice(0, 500)}\n助手: ${assistantText.slice(0, 500)}`
  try {
    const { text } = await generateText({
      model: toLanguageModel(profile),
      maxOutputTokens: 500, // reasoning models spend tokens thinking before answering
      messages: [{ role: 'user', content: prompt }],
      abortSignal: AbortSignal.timeout(15_000),
    })
    return cleanTitle(text)
  } catch {
    return null
  }
}

function cleanTitle(raw: string): string | null {
  const t = raw
    .trim()
    .split('\n')[0]
    .replace(/^["'“”《【]+|["'“”》】。.]+$/g, '')
    .trim()
  return t && t.length <= 30 ? t : null
}
