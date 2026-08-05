/**
 * One-shot conversation summarization for history compaction and short session
 * titles — single non-streaming requests to the primary profile's model via the
 * AI SDK (same provider abstraction as the main loop).
 */
import { generateText } from 'ai'
import { toLanguageModel } from './model'
import type { LlmProfile } from '@/stores/settings'

const PROMPT =
  'You are a conversation compactor. Compress the agent conversation history below into a structured summary. You MUST preserve: the user\'s goals and explicit instructions, actions already completed (including the file paths involved), key findings and decisions, and outstanding items. Use a bullet list, no more than 600 words total. Output only the summary itself.'

export async function summarize(
  profile: LlmProfile,
  transcript: string,
  signal?: AbortSignal,
): Promise<string> {
  const { text } = await generateText({
    model: toLanguageModel(profile),
    maxOutputTokens: 3000, // headroom for reasoning-model thinking
    reasoning: profile.reasoning,
    messages: [{ role: 'user', content: `${PROMPT}\n\n<conversation-history>\n${transcript}\n</conversation-history>` }],
    abortSignal: signal,
  })
  if (!text) throw new Error('summarizer returned no content')
  return text
}

/** One-shot session title (short, ≤6 words) from the first exchange. Returns
 *  null on any failure — the caller keeps the sliced-text fallback. */
export async function generateTitle(
  profile: LlmProfile,
  userText: string,
  assistantText: string,
): Promise<string | null> {
  if (profile.provider === 'mock') return null
  const prompt = `Write a short title for the conversation below, no more than 6 words. Output only the title itself, with no quotes or trailing period.\n\nUser: ${userText.slice(0, 500)}\nAssistant: ${assistantText.slice(0, 500)}`
  try {
    const { text } = await generateText({
      model: toLanguageModel(profile),
      maxOutputTokens: 500, // reasoning models spend tokens thinking before answering
      reasoning: profile.reasoning,
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
