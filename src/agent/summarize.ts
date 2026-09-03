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
    model: await toLanguageModel(profile),
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
      model: await toLanguageModel(profile),
      // Six words need no thinking, and asking for it silently killed the
      // feature: the profile's `reasoning` sizes an Anthropic thinking budget
      // off the MODEL's output ceiling, not off the cap set here, so any effort
      // above 'minimal' sends budget_tokens > max_tokens — a 400 this
      // fire-and-forget catch swallows. On an adaptive/effort model there is no
      // budget to compare, and a small cap is simply spent thinking: the reply
      // comes back empty. Sending nothing takes the provider's default, and the
      // cap is sized for a model that thinks whether asked to or not.
      maxOutputTokens: 3000,
      messages: [{ role: 'user', content: prompt }],
      abortSignal: AbortSignal.timeout(30_000),
    })
    return cleanTitle(text)
  } catch {
    return null
  }
}

/** Strip the quoting and trailing punctuation models add, and reject anything
 *  that came back as a sentence rather than a title. The cap is generous on
 *  purpose: six English words routinely run past forty characters, and a
 *  tighter one rejects a perfectly good title in favour of the raw first
 *  message — which is worse than the thing it was guarding against. */
export function cleanTitle(raw: string): string | null {
  const t = raw
    .trim()
    .split('\n')[0]
    .replace(/^["'“”《【]+|["'“”》】。.]+$/g, '')
    .trim()
  return t && t.length <= 60 ? t : null
}
