/**
 * `sampling/createMessage` — the extension asking THIS app to run a completion.
 *
 * localmd Connect has no API key and no model. Its in-page quick actions
 * (Translate / Explain on the selection bar) are therefore not a second little
 * agent inside the extension; they are a question posted down the same MCP
 * connection in the direction nothing used before, answered by whichever model
 * the user configured here. One place holds the key, one place holds the bill.
 *
 * Consent: the request is only reachable from an extension the user installed
 * and an origin they authorised, and it is only ever sent because they pressed
 * a button on a page. That press is the approval — a second confirmation in a
 * tab they are not looking at would arrive after the thing it is meant to gate.
 * What this module does instead is BOUND the request: one non-streaming call,
 * a capped prompt and a capped answer, no tools, no history, nothing written.
 */
import { generateText } from 'ai'
import { toLanguageModel } from '@/agent/model'
import type { LlmProfile } from '@/stores/settings'

export const SAMPLING_METHOD = 'sampling/createMessage'

/** Ceilings on what one such request may spend, whatever it asks for. */
const MAX_PROMPT_CHARS = 24_000
const MAX_TOKENS_CEILING = 4_000
const DEFAULT_MAX_TOKENS = 1_200
const CALL_TIMEOUT_MS = 90_000

export interface SamplingAsk {
  /** The user turns, already flattened to text. */
  prompt: string
  system?: string
  maxTokens: number
}

/** What a `sampling/createMessage` result looks like on the wire. */
export interface SamplingReply {
  role: 'assistant'
  content: { type: 'text'; text: string }
  model: string
  stopReason: 'endTurn'
}

function textOfContent(content: unknown): string {
  const blocks = Array.isArray(content) ? content : [content]
  return blocks
    .map((b) => {
      const block = (b ?? {}) as { type?: unknown; text?: unknown }
      return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Params → the one question to ask. Throws on anything unusable, which becomes
 * an error reply the extension shows in its popover — better than a blank
 * answer that looks like the model had nothing to say.
 *
 * Only USER turns are read. The spec's message list can carry assistant turns
 * for a multi-turn sampling exchange; nothing sends one here, and quietly
 * folding one into the prompt would be inventing a conversation.
 */
export function parseSamplingAsk(params: unknown): SamplingAsk {
  const p = (params ?? {}) as {
    messages?: unknown
    systemPrompt?: unknown
    maxTokens?: unknown
  }
  const messages = Array.isArray(p.messages) ? p.messages : []
  const prompt = messages
    .map((m) => {
      const msg = (m ?? {}) as { role?: unknown; content?: unknown }
      return msg.role === 'user' ? textOfContent(msg.content) : ''
    })
    .filter(Boolean)
    .join('\n\n')
    .trim()
  if (!prompt) throw new Error('sampling/createMessage carried no user text')
  const asked = typeof p.maxTokens === 'number' && p.maxTokens > 0 ? Math.floor(p.maxTokens) : 0
  return {
    prompt: prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) + '…' : prompt,
    ...(typeof p.systemPrompt === 'string' && p.systemPrompt ? { system: p.systemPrompt } : {}),
    maxTokens: Math.min(asked || DEFAULT_MAX_TOKENS, MAX_TOKENS_CEILING),
  }
}

/** The message shown when there is no model to answer with. Written for
 *  somebody looking at a popover on a web page, not at this app. */
export const NO_MODEL_MESSAGE =
  'No model is configured in localmd — open it and add one under Settings → Models.'

/**
 * Run one bounded completion on the primary profile.
 *
 * Deliberately `generateText` and not the agent loop: no tools, no session, no
 * history, nothing written to the knowledge base. The same shape as
 * agent/summarize — a one-shot on the profile the user already chose.
 */
export async function runSampling(
  profile: LlmProfile | null,
  ask: SamplingAsk,
  signal?: AbortSignal,
): Promise<SamplingReply> {
  if (!profile) throw new Error(NO_MODEL_MESSAGE)
  const { text } = await generateText({
    model: await toLanguageModel(profile),
    maxOutputTokens: ask.maxTokens,
    ...(ask.system ? { system: ask.system } : {}),
    messages: [{ role: 'user', content: ask.prompt }],
    abortSignal: signal ?? AbortSignal.timeout(CALL_TIMEOUT_MS),
  })
  const out = text?.trim() ?? ''
  if (!out) throw new Error('the model returned no text')
  return {
    role: 'assistant',
    content: { type: 'text', text: out },
    model: profile.model,
    stopReason: 'endTurn',
  }
}

/** The whole handler: params in, MCP result out. Bound to the relay client in
 *  stores/mcp, which is where the configured profile is known. */
export async function handleSampling(
  profileOf: () => LlmProfile | null,
  params: unknown,
): Promise<SamplingReply> {
  return runSampling(profileOf(), parseSamplingAsk(params))
}
